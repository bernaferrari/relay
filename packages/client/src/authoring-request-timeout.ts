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
