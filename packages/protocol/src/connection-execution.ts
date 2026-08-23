/** One direct, frozen Connection execution observed inside a completed Test.
 * Only single-edge campaign checks are projected here: a duration spanning
 * several Connections cannot truthfully be assigned to any one edge. */
export type ConnectionExecutionObservation = {
  connectionId: string;
  outcome: "passed" | "failed";
  durationMs: number;
  observedAt: number;
};
