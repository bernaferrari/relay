import type { RecordingPathContext } from "./types.js";

/** Preserve the optional App Map path that gives a recording its semantic origin. */
export function recordingPathContext(input: RecordingPathContext): RecordingPathContext {
  return {
    ...(input.sourceScreenId ? { sourceScreenId: input.sourceScreenId } : {}),
    ...(input.pendingConnectionId ? { pendingConnectionId: input.pendingConnectionId } : {}),
    ...(input.group ? { group: input.group } : {}),
    ...(input.debugOrigin ? { debugOrigin: structuredClone(input.debugOrigin) } : {}),
  };
}
