import type { AuthoringInteraction, OperationId, OperationInput } from "@relay/protocol";

const ROUTINE_AUTHORING_ACKNOWLEDGEMENT_MS = 180_000;
const CAPTURE_OPERATIONS: ReadonlySet<OperationId> = new Set([
  "authoring.session.begin",
  "authoring.session.observe",
  "authoring.session.capture",
  "authoring.session.start",
  "authoring.session.interact",
  "authoring.session.stop",
  "authoring.session.cancel",
  "target.interact",
  "target.input.reconcile",
]);

/** Native execution plus durable evidence can exceed the ordinary 20s HTTP
 * deadline. Routine authoring still has one finite 180s acknowledgement cap;
 * only authored waits extend it. A late mutation must be reconciled from its
 * exact receipt, never resent. Explicit caller timeouts remain authoritative. */
export function authoringRequestTimeout(
  id: OperationId,
  input: unknown,
  acknowledgementMs: number,
): number | undefined {
  let interaction: AuthoringInteraction | undefined;
  if (id === "authoring.session.interact") {
    interaction = (input as OperationInput<"authoring.session.interact">).interaction;
  }
  if (id === "workflow.transition") {
    const transition = input as OperationInput<"workflow.transition">;
    switch (transition.action) {
      case "authoring-record":
        interaction = transition.interaction;
        break;
      case "start-authoring":
      case "authoring-checkpoint":
      case "authoring-stop":
      case "authoring-cancel":
      case "authoring-abandon":
        break;
      default:
        return undefined;
    }
  } else if (!CAPTURE_OPERATIONS.has(id)) {
    return undefined;
  }
  return (
    Math.max(ROUTINE_AUTHORING_ACKNOWLEDGEMENT_MS, acknowledgementMs) + authoredWaitMs(interaction)
  );
}

function authoredWaitMs(interaction: AuthoringInteraction | undefined): number {
  if (!interaction || ("applied" in interaction && interaction.applied)) return 0;
  if (interaction.kind === "wait") return interaction.ms;
  if (interaction.kind !== "steps") return 0;
  return interaction.steps.reduce(
    (total, step) =>
      total + (step.kind === "sleep" ? step.ms : "timeoutMs" in step ? (step.timeoutMs ?? 0) : 0),
    0,
  );
}

/** The canonical Take supplies replay waits; captured execution durations do
 * not. Allow normal evidence/setup time for each action without retrying it. */
export function authoringReplayRequestTimeout(session: unknown, acknowledgementMs: number): number {
  const take = (
    session as
      | {
          take?: {
            currentRevision?: number;
            revisions?: Array<{
              revision: number;
              actions?: Array<{
                steps?: Array<{ kind?: string; ms?: number; timeoutMs?: number }>;
              }>;
            }>;
          };
        }
      | undefined
  )?.take;
  const actions =
    take?.revisions?.find((revision) => revision.revision === take.currentRevision)?.actions ?? [];
  const steps = actions.flatMap((action) => action.steps ?? []);
  const declaredMs = steps.reduce(
    (total, step) =>
      total + Math.max(0, step.kind === "sleep" ? (step.ms ?? 0) : (step.timeoutMs ?? 0)),
    0,
  );
  return declaredMs + Math.max(180_000, actions.length * acknowledgementMs);
}
