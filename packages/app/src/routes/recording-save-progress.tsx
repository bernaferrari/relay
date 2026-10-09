import { PageLoading, RecordingProblem } from "./recording-shared";

/** Keep saved-test navigation and record-into-test failures in one handoff. */
export function RecordingSaveProgress({
  error,
  intoName,
  onRetry,
  retrying,
}: {
  error?: unknown;
  retrying?: boolean;
  intoName?: string;
  onRetry(): void;
}) {
  return error ? (
    <RecordingProblem className="m-6" error={error} onRetry={onRetry} retrying={retrying} />
  ) : (
    <PageLoading label={intoName ? `Adding steps to ${intoName}…` : "Opening the saved test…"} />
  );
}
