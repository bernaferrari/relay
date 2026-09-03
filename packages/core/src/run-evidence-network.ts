import type { TestJob } from "./session.js";
import type { AndroidEmulatorNetworkCaptureResult } from "./android-emulator-network-capture.js";

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
  packetIssue?: string,
): unknown {
  if (!packet && !packetIssue) return sessionLog;
  const packetFields = {
    ...(packet ? { androidNetwork: packet.summary } : {}),
    ...(packetIssue ? { androidNetworkIssue: packetIssue } : {}),
  };
  return isRecord(sessionLog)
    ? { ...sessionLog, ...packetFields }
    : { sessionLog, ...packetFields };
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
