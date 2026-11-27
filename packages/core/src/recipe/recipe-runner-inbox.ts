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
  extractEmailLink,
  EmailSecretExtractionError,
  type ExtractedEmailCode,
  type ExtractedEmailLink,
} from "../sign-in/email-secret-extraction.js";
import { resolveTestInbox, TestInboxResolutionError } from "../sign-in/test-inbox-resolution.js";
import { inboxKeyForSavedSignIn } from "../sign-in/test-inboxes.js";
import { INBOX_CODE_REFERENCE, INBOX_LINK_REFERENCE } from "../sign-in/secret-references.js";
import { MAX_WAIT_MS } from "./recipe-runner-support.js";
import type { Device } from "../device/device.js";
import { openUrl } from "../device/device.js";
import { InputOutcomeUnknownError } from "../device/input-not-dispatched.js";
import { invalidateVerifiedScreen, type RecipeStepContext } from "./recipe-runner-context.js";
import { runInboxCodeActStep, type ActScreenObserver } from "./recipe-runner-act.js";

const DEFAULT_INBOX_TIMEOUT_MS = 60_000;
const CLOCK_SKEW_MS = 30_000;

type InboxAction = Extract<RecipeStep, { kind: "inbox" }>["action"];

export class TestInboxStepError extends Error {
  constructor(
    readonly classification: "blocked" | "harness",
    readonly reason:
      | "missing-inbox"
      | "revoked-inbox"
      | "no-email"
      | "timeout"
      | "ambiguous-code"
      | "no-code"
      | "ambiguous-link"
      | "no-link"
      | "imap"
      | "act"
      | "open",
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
  reason:
    | "missing-inbox"
    | "revoked-inbox"
    | "no-email"
    | "timeout"
    | "ambiguous-code"
    | "no-code"
    | "ambiguous-link"
    | "no-link",
  message: string,
): TestInboxStepError {
  return new TestInboxStepError("blocked", reason, `inbox blocked: ${message}`);
}

type InboxExtraction =
  | { action: "type-code"; extracted: ExtractedEmailCode }
  | { action: "open-link"; extracted: ExtractedEmailLink };

function extractForAction(action: InboxAction, messages: TestInboxMessage[]): InboxExtraction {
  return action === "type-code"
    ? { action, extracted: extractEmailCode(messages) }
    : { action, extracted: extractEmailLink(messages) };
}

function extractionFailure(action: InboxAction, error: unknown): "missing" | "terminal" | "other" {
  if (!(error instanceof EmailSecretExtractionError)) return "other";
  if (action === "type-code") {
    if (error.code === "ambiguous-code") return "terminal";
    return error.code === "no-code" ? "missing" : "other";
  }
  if (error.code === "ambiguous-link") return "terminal";
  return error.code === "no-link" ? "missing" : "other";
}

function registerSensitiveInput(
  job: NonNullable<RecipeStepContext["job"]>,
  name: string,
  value: string,
): void {
  job.resolvedInputs ??= {};
  job.resolvedInputs[name] = value;
  job.sensitiveInputNames = [...new Set([...(job.sensitiveInputNames ?? []), name])];
}

function scrubSecretText(value: string, secret: string, reference: string): string {
  return value.split(secret).join(reference);
}

async function openExtractedLink(input: {
  device: Device;
  ctx: RecipeStepContext;
  step: Extract<RecipeStep, { kind: "inbox" }>;
  inboxKey: string;
  mailbox: string;
  extracted: ExtractedEmailLink;
  timeoutMs: number;
}): Promise<void> {
  const { ctx, extracted, inboxKey } = input;
  const job = ctx.job!;
  const inputName = `inbox.${inboxKey}.link`;
  registerSensitiveInput(job, inputName, extracted.url);
  job.artifacts?.push({
    kind: "inbox-link",
    capturedAt: Date.now(),
    data: {
      ...(input.step.id ? { recipeStepId: input.step.id } : {}),
      inboxKey,
      mailbox: input.mailbox,
      uid: extracted.message.uid,
      internalDateMs: extracted.message.internalDateMs,
      deadlineMs: input.timeoutMs,
      urlReference: INBOX_LINK_REFERENCE,
    },
  });

  try {
    await openUrl(input.device, extracted.url);
  } catch (error) {
    if (error instanceof Error && error.name === "JobCancelledError") throw error;
    if (error instanceof InputOutcomeUnknownError) {
      throw new TestInboxStepError(
        "harness",
        "open",
        "Input outcome unknown: the sign-in link may already have opened. Relay stopped rather than opening it again.",
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new TestInboxStepError(
      "harness",
      "open",
      `The sign-in link could not be opened: ${scrubSecretText(message, extracted.url, INBOX_LINK_REFERENCE)}`,
    );
  }
  invalidateVerifiedScreen(ctx);
  ctx.log("Opened the sign-in link from the email");
}

/** Fetch the newest email secret on demand. Polling is scoped to this step and
 * leaves no daemon behind. Code entry then uses the ordinary act loop; link
 * opening is a direct navigation and never involves a model decision. */
export async function runInboxStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "inbox" }>,
  ctx: RecipeStepContext,
  runConcrete: (concrete: RecipeStep) => Promise<void>,
  observeScreen?: ActScreenObserver,
): Promise<void> {
  if (step.action !== "type-code" && step.action !== "open-link") {
    throw new Error(`inbox: unsupported action ${String((step as { action?: unknown }).action)}`);
  }
  const active = ctx.runtime?.activeSignIn;
  if (!active) {
    throw blocked(
      "missing-inbox",
      "the test inbox step requires an earlier successful saved sign-in in the same run",
    );
  }
  const inboxKey = step.inboxKey ?? inboxKeyForSavedSignIn(active.accountKey, active.inboxKey);
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
  let extracted: InboxExtraction | undefined;
  let sawMatchingMessage = false;
  let sawMissingSecret: "no-code" | "no-link" | undefined;
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
      if (matching.length) sawMatchingMessage = true;
      try {
        extracted = extractForAction(step.action, matching);
        break;
      } catch (error) {
        const failure = extractionFailure(step.action, error);
        if (failure === "terminal") {
          const reason = step.action === "type-code" ? "ambiguous-code" : "ambiguous-link";
          throw blocked(reason, (error as Error).message);
        }
        if (failure === "missing") {
          sawMissingSecret = step.action === "type-code" ? "no-code" : "no-link";
        } else if (failure === "other") {
          throw error;
        }
      }
      await raceCancel(delay(Math.min(INBOX_POLL_MS, Math.max(1, deadline - Date.now()))), job.id);
    }
  } finally {
    await client.close().catch(() => undefined);
  }
  if (!extracted) {
    if (step.action === "open-link") {
      if (sawMatchingMessage && sawMissingSecret === "no-link") {
        throw blocked("no-link", "The newest matching email did not contain a usable sign-in link");
      }
      throw blocked(
        "timeout",
        `No sign-in email arrived within ${Math.ceil(timeoutMs / 1000)} seconds`,
      );
    }
    throw blocked("no-email", `no matching email arrived within ${Math.ceil(timeoutMs / 1000)}s`);
  }

  if (extracted.action === "open-link") {
    await openExtractedLink({
      device,
      ctx,
      step,
      inboxKey,
      mailbox: resolved.mailbox,
      extracted: extracted.extracted,
      timeoutMs,
    });
    return;
  }

  const inputName = `inbox.${inboxKey}.code`;
  registerSensitiveInput(job, inputName, extracted.extracted.code);
  ctx.runtime.activeInboxCode = Object.freeze({
    inboxKey,
    code: extracted.extracted.code,
    uid: extracted.extracted.message.uid,
    internalDateMs: extracted.extracted.message.internalDateMs,
  });
  job.artifacts?.push({
    kind: "inbox-code",
    capturedAt: Date.now(),
    data: {
      ...(step.id ? { recipeStepId: step.id } : {}),
      inboxKey,
      mailbox: resolved.mailbox,
      uid: extracted.extracted.message.uid,
      internalDateMs: extracted.extracted.message.internalDateMs,
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
      `inbox: could not enter the email code: ${scrubSecretText(message, extracted.extracted.code, INBOX_CODE_REFERENCE)}`,
    );
  }
}
