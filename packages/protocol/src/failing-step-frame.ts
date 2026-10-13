/**
 * The screenshot to show for the step where a run stopped. That step is the
 * one a person looks at first, so it should never be blank when Relay kept
 * any picture of that moment. Shared by the run verdict and the run report.
 */
export type StepFrameSource = {
  path: string;
  caption?: string;
  capturedAt?: number;
};

export type FailingStepFrame = {
  path: string;
  /** "failure": captured when the step failed. "during": the last screen
   * captured while the step ran. "before": the last screen before it started. */
  moment: "failure" | "during" | "before";
};

const FAILURE_CAPTION = /^(?:failed|error)(?::|\s·)/iu;

function ordered(frames: readonly StepFrameSource[]): StepFrameSource[] {
  const unique = [...new Map(frames.map((frame) => [frame.path, frame])).values()];
  if (!unique.every((frame) => frame.capturedAt !== undefined)) return unique;
  return unique.sort((left, right) => left.capturedAt! - right.capturedAt!);
}

export function failingStepFrame(input: {
  /** Frames attached to the step's own trace occurrences, internal steps included. */
  stepFrames: readonly StepFrameSource[];
  /** Every frame the run kept, in capture order. */
  runFrames: readonly StepFrameSource[];
  startedAt?: number;
  finishedAt?: number;
}): FailingStepFrame | undefined {
  const { startedAt, finishedAt } = input;
  const known = new Map(input.runFrames.map((frame) => [frame.path, frame]));
  const enrich = (frame: StepFrameSource) => ({ ...known.get(frame.path), ...frame });
  const before = (frame: StepFrameSource) =>
    startedAt !== undefined && frame.capturedAt !== undefined && frame.capturedAt < startedAt;
  const within = (frame: StepFrameSource) =>
    startedAt !== undefined &&
    frame.capturedAt !== undefined &&
    frame.capturedAt >= startedAt &&
    (finishedAt === undefined || frame.capturedAt <= finishedAt);
  const stepFrames = input.stepFrames.map(enrich);
  const during = ordered([
    ...stepFrames.filter((frame) => !before(frame)),
    ...input.runFrames.filter(within),
  ]);
  const failure = during.filter((frame) => FAILURE_CAPTION.test(frame.caption ?? "")).at(-1);
  if (failure) return { path: failure.path, moment: "failure" };
  const last = during.at(-1);
  if (last) return { path: last.path, moment: "during" };
  const earlier = ordered([...stepFrames, ...input.runFrames].filter(before)).at(-1);
  if (earlier) return { path: earlier.path, moment: "before" };
  return undefined;
}
