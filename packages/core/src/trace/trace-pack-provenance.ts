import {
  parseAndroidPacketCaptureProvenance,
  type AndroidPacketCaptureProvenance,
} from "@relay/protocol";
import type { PersistedRun } from "../run/run-store.js";

export function androidPacketCaptureProvenance(
  run: PersistedRun,
): AndroidPacketCaptureProvenance | undefined {
  for (let index = run.artifacts.length - 1; index >= 0; index -= 1) {
    const artifact = run.artifacts[index]!;
    if (
      artifact.kind !== "network" ||
      !artifact.data ||
      typeof artifact.data !== "object" ||
      Array.isArray(artifact.data)
    ) {
      continue;
    }
    const candidate = (artifact.data as { androidPacketCapture?: unknown }).androidPacketCapture;
    if (candidate === undefined) continue;
    try {
      return parseAndroidPacketCaptureProvenance(candidate);
    } catch {
      // The frozen artifact remains available for forensic inspection, but a
      // malformed value cannot be promoted into the typed TracePack manifest.
    }
  }
  return undefined;
}
