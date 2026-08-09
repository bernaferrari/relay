import type { CanvasConnection } from "./app-map-connection-draft";

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

export function connectionStatusLabel(connection: CanvasConnection): string {
  if (connection.state === "needs-recording") return "Needs steps";
  if (connection.review?.status === "verified") return "Works";
  if (connection.review?.status === "failed") return "Needs a fix";
  if (connection.takeId || connection.videoTakeId) return "Ready to try";
  return "Not tried yet";
}
