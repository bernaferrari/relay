import type { CanvasConnection } from "./app-map-connection-draft";

export function checkedTargetsLabel(
  targets: readonly { targetId: string; targetName?: string }[] | undefined,
  status?: NonNullable<CanvasConnection["review"]>["status"],
): string {
  if (!targets?.length) {
    if (status === "verified") return "Last replay reached this screen";
    if (status === "failed") return "Latest replay changed";
    return "Not replayed on a target yet";
  }
  if (targets.length === 1) return `Checked on ${targets[0]!.targetName ?? targets[0]!.targetId}`;
  return `Checked on ${targets.length} targets`;
}

export function connectionStatusLabel(connection: CanvasConnection): string {
  if (connection.state === "needs-recording") return "Planned";
  if (connection.review?.status === "verified") return "Verified";
  if (connection.review?.status === "failed") return "Needs attention";
  if (connection.takeId || connection.videoTakeId) return "Captured";
  return "Not verified";
}
