import { InputNotDispatchedError } from "./input-not-dispatched.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { currentOperationContext } from "./operation-context.js";
import { currentTargetSupervisorStore, type SupervisedTarget } from "./target-supervisor-store.js";

export type BrowserSupervisionMode = "required" | "test-optional";

const browserSupervisionModes = new AsyncLocalStorage<BrowserSupervisionMode>();

export function runWithBrowserSupervisionMode<T>(
  mode: BrowserSupervisionMode,
  operation: () => T,
): T {
  return browserSupervisionModes.run(mode, operation);
}

export class BrowserSupervisionRequiredError extends Error {
  constructor(readonly targetId: string) {
    super(`Browser mutation for ${targetId} requires a durable supervisor before dispatch`);
    this.name = "BrowserSupervisionRequiredError";
  }
}

export class BrowserMutationOutcomeUnknownError extends Error {
  constructor(
    readonly targetId: string,
    readonly mutationId: string,
    readonly cause: unknown,
  ) {
    super(
      `The browser mutation may already have reached ${targetId}. Relay did not retry it. Capture the current page, review the outcome, then explicitly reconcile it.`,
    );
    this.name = "BrowserMutationOutcomeUnknownError";
  }
}

function mutationId(targetId: string): string {
  const operation = currentOperationContext();
  if (!operation) return `browser-input-${randomUUID()}`;
  const digest = createHash("sha256")
    .update(targetId, "utf8")
    .update("\0")
    .update(operation.actorId, "utf8")
    .update("\0")
    .update(operation.requestId, "utf8")
    .digest("hex");
  return `browser-input-${digest}`;
}

function reason(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 480);
}

/** Persist the browser input intention before dispatch and retain an exact
 * terminal outcome. A failure after the dispatch receipt is always
 * outcome-unknown, even when the underlying browser API reports an error:
 * Relay cannot prove whether the page observed the input. */
export async function runSupervisedBrowserMutation<T>(input: {
  targetId: string;
  intent: string;
  beforeDispatch?: () => Promise<void> | void;
  dispatch: () => Promise<T>;
}): Promise<T> {
  const store = currentTargetSupervisorStore();
  if (!store) {
    if ((browserSupervisionModes.getStore() ?? "required") === "required") {
      throw new BrowserSupervisionRequiredError(input.targetId);
    }
    await input.beforeDispatch?.();
    return input.dispatch();
  }

  const target: SupervisedTarget = { id: input.targetId, kind: "browser" };
  const existing = store.health(target).input;
  if (existing.state === "uncertain" && existing.pendingMutationId) {
    throw new BrowserMutationOutcomeUnknownError(
      input.targetId,
      existing.pendingMutationId,
      new Error(existing.reason ?? "A prior browser mutation has an uncertain outcome"),
    );
  }
  const id = mutationId(input.targetId);
  store.transition(target, {
    kind: "input.intent-persisted",
    mutationId: id,
    intent: input.intent,
  });
  let dispatched = false;
  try {
    await input.beforeDispatch?.();
    store.transition(target, { kind: "input.dispatched", mutationId: id });
    dispatched = true;
    const result = await input.dispatch();
    store.transition(target, { kind: "input.completed", mutationId: id });
    return result;
  } catch (error) {
    if (!dispatched) {
      try {
        store.transition(target, {
          kind: "input.not-dispatched",
          mutationId: id,
          reason: reason(error),
        });
      } catch {
        // The original pre-dispatch failure remains authoritative. A store
        // failure cannot turn it into permission to issue browser input.
      }
      if (error instanceof InputNotDispatchedError) throw error;
      throw new InputNotDispatchedError(reason(error), { cause: error });
    }
    try {
      store.transition(target, {
        kind: "input.outcome-unknown",
        mutationId: id,
        reason: reason(error),
      });
    } catch {
      // The durable dispatched receipt is already enough to block retries.
      // A later store read rehydrates that conservative pending state.
    }
    throw new BrowserMutationOutcomeUnknownError(input.targetId, id, error);
  }
}
