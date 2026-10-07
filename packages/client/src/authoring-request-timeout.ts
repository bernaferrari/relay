import type { AuthoringInteraction, OperationId, OperationInput } from "@relay/protocol";

/** Recording executes authored waits before acknowledging the command. The
 * HTTP deadline must cover those declared durations plus the normal budget
 * for execution setup and evidence. This never retries or changes a step. */
export function authoringRequestTimeout(
  id: OperationId,
  input: unknown,
  acknowledgementMs: number,
): number | undefined {
  let interaction: AuthoringInteraction | undefined;
  if (id === "authoring.session.interact") {
    interaction = (input as OperationInput<"authoring.session.interact">).interaction;
  } else if (id === "workflow.transition") {
    const transition = input as OperationInput<"workflow.transition">;
    if (transition.action === "authoring-record") interaction = transition.interaction;
  }
  if (interaction?.kind !== "steps") return undefined;
  const declaredMs = interaction.steps.reduce((total, step) => {
    const duration =
      step.kind === "sleep" ? step.ms : "timeoutMs" in step ? (step.timeoutMs ?? 0) : 0;
    return total + duration;
  }, 0);
  return declaredMs > 0 ? declaredMs + acknowledgementMs : undefined;
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
