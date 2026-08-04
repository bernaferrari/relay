import type { EvidenceChannelRecord } from "@relay/protocol";

/** Controls and result-level empty states only make sense when a collector ran.
 * Unsupported, denied, and failed channels are already fully explained by the
 * channel banner and should not pretend they contain searchable evidence. */
export function evidenceChannelIsInspectable(
  channel: EvidenceChannelRecord | undefined,
  entryCount: number,
  loading = false,
): boolean {
  if (loading || entryCount > 0) return true;
  return channel?.status === "captured" || channel?.status === "partial";
}

export function evidenceChannelNote(
  channel: EvidenceChannelRecord | undefined,
  note?: string,
): string {
  if (!channel) return note ?? "This collector did not report a result for the run.";
  if (channel.status === "captured" || channel.status === "partial") {
    return (
      note ??
      `${channel.entries} entr${channel.entries === 1 ? "y" : "ies"} captured${channel.status === "partial" ? "; collection was incomplete" : ""}`
    );
  }
  if (channel.message) return channel.message;
  if (note) return note;
  const defaults: Record<EvidenceChannelRecord["status"], string> = {
    captured: "Evidence captured.",
    partial: "Some evidence was captured.",
    unsupported: "This target does not support this collector.",
    denied: "Workspace policy did not allow this evidence.",
    failed: "The collector could not complete for this run.",
    redacted: "This evidence was removed by the run's privacy policy.",
  };
  return defaults[channel.status];
}
