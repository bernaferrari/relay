import type { EvidenceChannel, EvidenceManifest } from "@relay/protocol";
import type { PersistedRun } from "@relay/core";

/** Describe only retained evidence. Upstream diagnostics are not invented as native collectors. */
export function e2eRunEvidence(
  run: Pick<
    PersistedRun,
    "id" | "platform" | "serial" | "startedAt" | "finishedAt" | "frames" | "artifacts"
  >,
): EvidenceManifest {
  const platform = run.platform;
  if (platform !== "browser" && platform !== "android" && platform !== "ios")
    throw new Error("Unknown upstream platform; cannot project a device identity");
  const names: EvidenceChannel[] = [
    "input",
    "screenshot",
    "video",
    "ui-tree",
    "logs",
    "network",
    "performance",
    "crash",
    "audio",
  ];
  const channels = Object.fromEntries(
    names.map((channel) => [
      channel,
      {
        channel,
        status: "unsupported",
        entries: 0,
        bytes: 0,
        dropped: 0,
        redactions: 0,
        message: "This channel is not projected from the upstream archive.",
      },
    ]),
  ) as EvidenceManifest["channels"];
  const missing = run.artifacts.some(
    (artifact) =>
      artifact.kind === "capture-review" &&
      (artifact.data as { status?: string })?.status === "missing",
  );
  if (run.frames.length || missing)
    channels.screenshot = {
      channel: "screenshot",
      status: missing ? "partial" : "captured",
      entries: run.frames.length,
      bytes: run.frames.reduce((sum, frame) => sum + (frame.bytes ?? 0), 0),
      dropped: 0,
      redactions: 0,
      ...(missing ? { message: "Declared screenshots are unavailable." } : {}),
    };
  return {
    schemaVersion: 1,
    runId: run.id,
    target: {
      kind: run.platform === "browser" ? "browser" : "device",
      platform,
      id: run.serial,
    },
    startedAt: run.startedAt ?? 0,
    finishedAt: run.finishedAt,
    channels,
    events: [],
  };
}
