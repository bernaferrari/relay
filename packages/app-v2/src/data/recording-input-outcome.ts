export type RecordingInputOutcome =
  | { kind: "confirmed" }
  | { kind: "not-dispatched"; message: string }
  | { kind: "refresh-failed"; message: string }
  | { kind: "unknown"; message: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyDispatchFailure(error: unknown): RecordingInputOutcome {
  const message = errorText(error);
  if (
    /not ready|still connecting|not ready to record|no session|is not ready|live view is still connecting/iu.test(
      message,
    )
  ) {
    return { kind: "not-dispatched", message };
  }
  return { kind: "unknown", message };
}

export function recordingInputRecoveryMessage(outcome: RecordingInputOutcome): string | undefined {
  if (outcome.kind === "confirmed") return undefined;
  if (outcome.kind === "not-dispatched") {
    return "The last interaction was not sent. Try it again before stopping.";
  }
  if (outcome.kind === "refresh-failed") {
    return "The interaction reached the app, but Relay could not refresh the recording. Refresh the steps instead of tapping again.";
  }
  return "Relay could not confirm whether the last interaction reached the app. Observe the app before sending more input.";
}

/** Dispatch and evidence refresh are separate outcomes. A refresh failure must
 * not be treated as "the tap never happened." */
export async function dispatchRecordingInput(input: {
  send: () => Promise<void>;
  refresh: () => Promise<void>;
}): Promise<RecordingInputOutcome> {
  try {
    await input.send();
  } catch (error) {
    return classifyDispatchFailure(error);
  }
  try {
    await input.refresh();
    return { kind: "confirmed" };
  } catch (error) {
    return { kind: "refresh-failed", message: errorText(error) };
  }
}
