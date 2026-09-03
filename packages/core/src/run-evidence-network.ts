import type { AndroidPacketCaptureProvenance } from "@relay/protocol";
import type { TestJob } from "./session.js";
import type { AndroidEmulatorNetworkCaptureResult } from "./android-emulator-network-capture.js";

type CapturedPacketProvenance = Extract<AndroidPacketCaptureProvenance, { status: "captured" }>;
type FailedPacketProvenance = Extract<AndroidPacketCaptureProvenance, { status: "failed" }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function proofApplicationId(job: TestJob): string | undefined {
  for (const artifact of job.artifacts) {
    if (artifact.kind !== "proof-build-provenance" || !isRecord(artifact.data)) continue;
    const value = artifact.data.applicationId;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function combinedNetworkResult(
  sessionLog: unknown,
  packet: AndroidEmulatorNetworkCaptureResult | undefined,
  packetCapture?: AndroidPacketCaptureProvenance,
): unknown {
  if (!packet && !packetCapture) return sessionLog;
  const packetFields = {
    ...(packet ? { androidNetwork: packet.summary } : {}),
    ...(packetCapture ? { androidPacketCapture: packetCapture } : {}),
  };
  return isRecord(sessionLog)
    ? { ...sessionLog, ...packetFields }
    : { sessionLog, ...packetFields };
}

export function capturedPacketProvenance(
  packet: AndroidEmulatorNetworkCaptureResult,
): CapturedPacketProvenance {
  if (
    packet.summary.source.kind !== "emulator-packet" ||
    packet.summary.source.backend === "agent-device-session-log"
  ) {
    throw new TypeError("managed-emulator packet result has non-packet provenance");
  }
  return {
    schemaVersion: 1,
    status: "captured",
    source: { kind: "emulator-packet", backend: packet.summary.source.backend },
    scope: "entire-emulator",
    startedAt: packet.summary.startedAt,
    finishedAt: packet.summary.finishedAt ?? packet.summary.startedAt,
    coverage: packet.summary.coverage,
  };
}

export function failedPacketProvenance(input: {
  stage: "start" | "finalize";
  startedAt: number;
  finishedAt: number;
  message: string;
}): FailedPacketProvenance {
  const message = input.message.trim().slice(0, 512) || "Unknown packet collector failure";
  return {
    schemaVersion: 1,
    status: "failed",
    source: { kind: "emulator-packet", backend: "android-emulator-console" },
    scope: "entire-emulator",
    startedAt: input.startedAt,
    finishedAt: Math.max(input.startedAt, input.finishedAt),
    stage: input.stage,
    message,
  };
}

/** Generic channel status describes whether Relay closed the evidence it
 * attempted to collect. The nested packet coverage separately describes how
 * much emulator traffic that backend can observe, so the console backend's
 * honest `partial` scope does not make every otherwise complete Proof fail. */
export function packetCollectionIsIncomplete(packet: AndroidEmulatorNetworkCaptureResult): boolean {
  return (
    packet.summary.coverage === "interrupted" ||
    packet.summary.dropped > 0 ||
    packet.summary.rawCapture.status === "failed" ||
    packet.summary.rawCapture.status === "truncated"
  );
}
