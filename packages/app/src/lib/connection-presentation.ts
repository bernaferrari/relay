import type { RecipeStep } from "@relay/protocol";
import type { CanvasConnection } from "./app-map-connection-draft";

/** Ordinary single taps and unrecorded routes are already communicated by the
 * path treatment and inspector. Keep labels for behavior that the line alone
 * cannot explain: gestures, waits, and multi-step paths. */
export function connectionLabelMode(
  connection: CanvasConnection,
  steps: readonly RecipeStep[],
): "always" | "hidden" {
  if (connection.state === "needs-recording") return "hidden";
  // The recorder keeps meaningful human pauses as editable sleep steps. They
  // do not turn an otherwise ordinary tap into a visually complex gesture.
  const meaningfulSteps = steps.filter((step) => step.kind !== "sleep");
  if (meaningfulSteps.length !== 1) return "always";
  const step = meaningfulSteps[0];
  if (step?.kind !== "tap") return "always";
  if ((step.gesture ?? "single") !== "single" || (step.tapCount ?? 1) > 1) return "always";
  return "hidden";
}

export function checkedTargetsLabel(
  targets: readonly { targetId: string; targetName?: string }[] | undefined,
  status?: NonNullable<CanvasConnection["review"]>["status"],
): string {
  if (!targets?.length) {
    if (status === "verified") return "Last try reached this screen";
    if (status === "failed") return "Last try didn’t match";
    return "Not tried on a device yet";
  }
  if (targets.length === 1) return `Tried on ${targets[0]!.targetName ?? "this device"}`;
  return `Tried on ${targets.length} devices`;
}

/**
 * The shortest mark in each `--map-edge-dash-*` token, in canvas units.
 *
 * Kept beside the rule that uses it rather than read back out of CSS, so a
 * change to the tokens has to come here too.
 */
const EDGE_DASH_SHORTEST_MARK = { draft: 4, return: 2 } as const;

/**
 * Whether a dashed edge still paints as dashes at this zoom.
 *
 * A dash is only a dash while its marks cover about a screen pixel. Below that
 * the pattern smears into a faint fuzz along the route — a fitted crawl is
 * mostly draft edges, and they paint as dirty rails rather than dashed ones.
 * An unbroken hairline is the better version of the same line there, because
 * at a zoom where no label is legible the rail's whole job is to show which
 * cards a corridor joins: which siblings a fan packed side by side were
 * reached from, rather than from the card to their left. Draft and ready stay
 * apart on colour, which has no minimum size.
 *
 * The two patterns stop resolving at different zooms because a return dash is
 * the finer of the two.
 */
export function edgeDashesRead(
  kind: keyof typeof EDGE_DASH_SHORTEST_MARK,
  viewportScale: number,
): boolean {
  return EDGE_DASH_SHORTEST_MARK[kind] * viewportScale >= 1;
}

export function connectionStatusLabel(connection: CanvasConnection): string {
  if (connection.state === "needs-recording") return "Needs steps";
  if (connection.review?.status === "verified") return "Works";
  if (connection.review?.status === "failed") return "Needs a fix";
  if (connection.takeId || connection.videoTakeId) return "Ready to try";
  return "Not tried yet";
}
