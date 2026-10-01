import type { AuthoringInteraction, AuthoringObservation, StepTarget } from "@relay/protocol";
import { hasCurrentAuthoringSemantics } from "./authoring-observation-proof.js";
import { resolveNamedControlOutcome } from "./device-target-resolution.js";
import type { SnapshotNode } from "./device.js";

const BUSY_NAME = /^(?:stop|cancel) (?:message|response|generation|generating|image|video)$/iu;
const RESULT_NAME =
  /^(?:copy (?:message|response)|download(?: (?:image|video))?|save (?:image|video)|extend(?: video)?|upscale(?: video)?)$/iu;

export function hasAuthoringBusyControl(observation: AuthoringObservation | undefined): boolean {
  return Boolean(
    observation &&
    hasCurrentAuthoringSemantics(observation.proof) &&
    (observation.nodes ?? []).some(
      (node) =>
        node.visibleToUser !== false &&
        node.enabled !== false &&
        typeof node.label === "string" &&
        BUSY_NAME.test(node.label),
    ),
  );
}

/** Learn an executable completion boundary from two current observations.
 * Time between human actions is never replayed. A named busy control must
 * disappear and a new, unique result control must arrive in the same app.
 * Missing trees, cancellation paths, and ambiguous results remain explicit. */
export function inferredAuthoringCompletionWait(
  before: AuthoringObservation | undefined,
  after: AuthoringObservation,
): AuthoringInteraction | undefined {
  if (
    !before?.foregroundApp ||
    before.foregroundApp !== after.foregroundApp ||
    after.capturedAt <= before.capturedAt ||
    !hasCurrentAuthoringSemantics(before.proof) ||
    !hasCurrentAuthoringSemantics(after.proof)
  )
    return undefined;
  const previous = (before.nodes ?? []) as unknown as SnapshotNode[];
  const current = (after.nodes ?? []) as unknown as SnapshotNode[];
  const visible = (node: SnapshotNode) => node.visibleToUser !== false && node.enabled !== false;
  // Keep the submitted prompt/document context. A different conversation in
  // the same app must not teach a completion condition for this submission.
  const context = previous.filter(
    (node) =>
      visible(node) &&
      node.editable !== true &&
      node.bundleId === before.foregroundApp &&
      (node.label?.trim().length ?? 0) >= 24,
  );
  if (
    !context.some((node) =>
      current.some(
        (item) =>
          visible(item) && item.bundleId === after.foregroundApp && item.label === node.label,
      ),
    )
  )
    return undefined;
  const busy = previous.filter((node) => visible(node) && BUSY_NAME.test(node.label ?? ""));
  if (
    busy.length !== 1 ||
    current.some((node) => visible(node) && BUSY_NAME.test(node.label ?? ""))
  )
    return undefined;
  const busyTarget: StepTarget = { label: busy[0]!.label! };
  if (resolveNamedControlOutcome(previous, busyTarget).status !== "resolved") return undefined;
  for (const node of current) {
    const name = node.label?.trim();
    if (!visible(node) || !name || !RESULT_NAME.test(name)) continue;
    const target: StepTarget = { label: name };
    if (previous.some((item) => visible(item) && item.label === name)) continue;
    if (resolveNamedControlOutcome(current, target).status !== "resolved") continue;
    return {
      kind: "steps",
      label: `Wait for result · ${name}`,
      steps: [
        { kind: "expect", target: busyTarget, condition: "gone", timeoutMs: 300_000 },
        { kind: "wait-for", target, timeoutMs: 300_000 },
      ],
    };
  }
  return undefined;
}
