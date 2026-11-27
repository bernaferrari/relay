import type { RecipeStep } from "@relay/protocol";
import { cooperativeCheckpoint, raceCancel } from "../execution/control.js";
import {
  INBOX_MAX_CANDIDATES,
  INBOX_MAX_MESSAGE_BYTES,
  INBOX_POLL_MS,
  createImapTestInboxClient,
  type TestInboxClientFactory,
  type TestInboxMessage,
} from "../sign-in/imap-test-inbox.js";
import {
  extractEmailCode,
  EmailSecretExtractionError,
} from "../sign-in/email-secret-extraction.js";
import { resolveTestInbox, TestInboxResolutionError } from "../sign-in/test-inbox-resolution.js";
import { INBOX_CODE_REFERENCE } from "../sign-in/secret-references.js";
import { MAX_WAIT_MS } from "./recipe-runner-support.js";
import type { Device } from "../device/device.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { runInboxCodeActStep, type ActScreenObserver } from "./recipe-runner-act.js";

const DEFAULT_INBOX_TIMEOUT_MS = 60_000;
const CLOCK_SKEW_MS = 30_000;

export class TestInboxStepError extends Error {
  constructor(
    readonly classification: "blocked" | "harness",
    readonly reason:
      | "missing-inbox"
      | "revoked-inbox"
      | "no-email"
      | "ambiguous-code"
      | "no-code"
      | "imap"
      | "act",
    message: string,
  ) {
    super(message);
    this.name = "TestInboxStepError";
  }
}

let registeredClientFactory: TestInboxClientFactory | undefined;

/** Test seam. Production resolution remains the IMAP adapter; tests fake the
 * narrow message-fetch port without implementing the IMAP wire protocol. */
export function registerTestInboxClientFactory(factory: TestInboxClientFactory): () => void {
  registeredClientFactory = factory;
  return () => {
    if (registeredClientFactory === factory) registeredClientFactory = undefined;
  };
}

function recipientMatches(message: TestInboxMessage, recipient?: string): boolean {
  if (!recipient) return true;
  const expected = recipient.trim().toLowerCase();
  return message.recipients.some((actual) => actual.trim().toLowerCase() === expected);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blocked(
  reason: "missing-inbox" | "revoked-inbox" | "no-email" | "ambiguous-code" | "no-code",
  message: string,
): TestInboxStepError {
  return new TestInboxStepError("blocked", reason, `inbox blocked: ${message}`);
}

/** Fetch the newest email code on demand, then enter it through the ordinary
 * act loop. Polling is scoped to this step and leaves no daemon behind. */
export async function runInboxStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "inbox" }>,
  ctx: RecipeStepContext,
  runConcrete: (concrete: RecipeStep) => Promise<void>,
  observeScreen?: ActScreenObserver,
): Promise<void> {
  if (step.action !== "type-code")
    throw new Error(`inbox: unsupported action ${String((step as { action?: unknown }).action)}`);
  const active = ctx.runtime?.activeSignIn;
  const inboxKey = step.inboxKey ?? active?.inboxKey;
  if (!active) {
    throw blocked(
      "missing-inbox",
      "the test inbox step requires an earlier successful saved sign-in in the same run",
    );
  }
  if (!inboxKey) {
    throw blocked(
      "missing-inbox",
      `saved sign-in "${active.accountKey}" is not connected to a test inbox`,
    );
  }
  if (step.accountKey && step.accountKey !== active.accountKey) {
    throw blocked(
      "missing-inbox",
      `the active sign-in is "${active.accountKey}", not "${step.accountKey}"`,
    );
  }
  const job = ctx.job;
  if (!job?.projectId)
    throw new TestInboxStepError("harness", "imap", "inbox: run has no project scope");
  ctx.runtime ??= {};

  let resolved;
  try {
    resolved = await resolveTestInbox({ projectId: job.projectId, key: inboxKey });
  } catch (error) {
    if (error instanceof TestInboxResolutionError) {
      throw blocked(error.code === "revoked" ? "revoked-inbox" : "missing-inbox", error.message);
    }
    throw error;
  }

  const timeoutMs = Math.min(step.timeoutMs ?? DEFAULT_INBOX_TIMEOUT_MS, MAX_WAIT_MS);
  const deadline = Date.now() + timeoutMs;
  const sinceMs = Math.max(0, active.startedAt - CLOCK_SKEW_MS);
  const factory = registeredClientFactory ?? createImapTestInboxClient;
  let client;
  try {
    client = await raceCancel(factory(resolved, resolved), job.id);
  } catch (error) {
    if (error instanceof Error && error.name === "JobCancelledError") throw error;
    throw new TestInboxStepError("harness", "imap", "inbox: could not connect to the test inbox");
  }
  let extracted;
  try {
    for (;;) {
      await cooperativeCheckpoint(job.id);
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      let messages: TestInboxMessage[];
      try {
        messages = await raceCancel(
          client.fetchMessagesSince({
            sinceMs,
            ...(resolved.recipient ? { recipient: resolved.recipient } : {}),
            maxMessages: INBOX_MAX_CANDIDATES,
            maxMessageBytes: INBOX_MAX_MESSAGE_BYTES,
          }),
          job.id,
        );
      } catch (error) {
        if (error instanceof Error && error.name === "JobCancelledError") throw error;
        throw new TestInboxStepError("harness", "imap", "inbox: message fetch failed");
      }
      const matching = messages
        .filter((message) => message.internalDateMs >= sinceMs)
        .filter((message) => recipientMatches(message, resolved.recipient));
      try {
        extracted = extractEmailCode(matching);
        break;
      } catch (error) {
        if (error instanceof EmailSecretExtractionError && error.code === "ambiguous-code") {
          throw blocked("ambiguous-code", error.message);
        }
      }
      await raceCancel(delay(Math.min(INBOX_POLL_MS, Math.max(1, deadline - Date.now()))), job.id);
    }
  } finally {
    await client.close().catch(() => undefined);
  }
  if (!extracted) {
    throw blocked("no-email", `no matching email arrived within ${Math.ceil(timeoutMs / 1000)}s`);
  }

  const inputName = `inbox.${inboxKey}.code`;
  job.resolvedInputs ??= {};
  job.resolvedInputs[inputName] = extracted.code;
  job.sensitiveInputNames = [...new Set([...(job.sensitiveInputNames ?? []), inputName])];
  ctx.runtime.activeInboxCode = Object.freeze({
    inboxKey,
    code: extracted.code,
    uid: extracted.message.uid,
    internalDateMs: extracted.message.internalDateMs,
  });
  job.artifacts?.push({
    kind: "inbox-code",
    capturedAt: Date.now(),
    data: {
      ...(step.id ? { recipeStepId: step.id } : {}),
      inboxKey,
      mailbox: resolved.mailbox,
      uid: extracted.message.uid,
      internalDateMs: extracted.message.internalDateMs,
      deadlineMs: timeoutMs,
    },
  });

  try {
    await runInboxCodeActStep(
      device,
      {
        kind: "act",
        intent: "Enter the code from the email",
        maxActions: 5,
        ...(step.id ? { id: `${step.id}-entry` } : {}),
      },
      ctx,
      runConcrete,
      inboxKey,
      observeScreen,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "JobCancelledError") throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new TestInboxStepError(
      "harness",
      "act",
      `inbox: could not enter the email code: ${message.split(extracted.code).join(INBOX_CODE_REFERENCE)}`,
    );
  }
}
