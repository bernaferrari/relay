import type { AuthoringInteraction, AuthoringObservation, StepTarget } from "@relay/protocol";
import { hasCurrentAuthoringSemantics } from "./authoring-observation-proof.js";
import { resolveNamedControlOutcome, snapshotLabelMatches } from "./device-target-resolution.js";
import type { SnapshotNode } from "./device.js";

const BUSY_NAME = /^(?:stop|cancel) (?:message|response|generation|generating|image|video)$/iu;
const RESULT_NAME =
  /^(?:copy (?:message|response)|download(?: (?:image|video))?|save (?:image|video)|extend(?: video)?|upscale(?: video)?)$/iu;
const TERMINAL_FAILURE_NAME =
  /^(?:(?:message|response|generation|image|video) (?:cancelled|canceled|failed)|error)(?:[.!:]|$)/iu;

function visibleInApp(node: SnapshotNode, app: string | undefined): boolean {
  return Boolean(
    app && node.bundleId === app && node.visibleToUser !== false && node.enabled !== false,
  );
}

export function hasAuthoringBusyControl(observation: AuthoringObservation | undefined): boolean {
  return Boolean(
    observation &&
    hasCurrentAuthoringSemantics(observation.proof) &&
    (observation.nodes ?? []).some(
      (node) =>
        visibleInApp(node as SnapshotNode, observation.foregroundApp) &&
        typeof node.label === "string" &&
        BUSY_NAME.test(node.label),
    ),
  );
}

/** Suggest a result-control readiness boundary from two current observations.
 * Time between human actions is never replayed. A named busy control must
 * disappear and a new, unique result control must arrive in the same app.
 * This narrow English recognizer is not an answer-quality or success oracle.
 * Missing trees, unsupported labels, cancellation and ambiguous results do
 * not teach a wait; users can author explicit conditions for those cases. */
export function inferredAuthoringCompletionWait(
  before: AuthoringObservation | undefined,
  after: AuthoringObservation,
): AuthoringInteraction | undefined {
  if (
    !before?.foregroundApp ||
    before.foregroundApp !== after.foregroundApp ||
    before.screen.deviceId !== after.screen.deviceId ||
    after.capturedAt <= before.capturedAt ||
    !hasCurrentAuthoringSemantics(before.proof) ||
    !hasCurrentAuthoringSemantics(after.proof)
  )
    return undefined;
  const previous = (before.nodes ?? []) as unknown as SnapshotNode[];
  const current = (after.nodes ?? []) as unknown as SnapshotNode[];
  const visible = (node: SnapshotNode) => visibleInApp(node, before.foregroundApp);
  if (
    current.some(
      (node) =>
        visible(node) &&
        ((node.role ?? node.type)?.toLowerCase() === "alert" ||
          TERMINAL_FAILURE_NAME.test(node.label?.trim() ?? "")),
    )
  )
    return undefined;
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
    // Use the same label matching as replay. Whitespace/case changes must not
    // turn an old result into a supposedly new completion boundary.
    if (previous.some((item) => visible(item) && snapshotLabelMatches(name, item.label))) continue;
    if (resolveNamedControlOutcome(current, target).status !== "resolved") continue;
    return {
      kind: "steps",
      // These two current observations already establish readiness in this
      // recording. Retain the condition for replay without executing it again.
      applied: true,
      label: `Wait for result · ${name}`,
      steps: [
        { kind: "wait-response", target, busyTarget, idleTarget: target, timeoutMs: 120_000 },
      ],
    };
  }
  return undefined;
}
