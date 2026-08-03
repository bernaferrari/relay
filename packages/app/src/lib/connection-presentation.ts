import type { CanvasConnection } from "./app-map-connection-draft";

export function checkedTargetsLabel(
  targets: readonly { targetId: string; targetName?: string }[] | undefined,
): string {
  if (!targets?.length) return "No target evidence recorded";
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
