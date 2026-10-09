/**
 * What runs actually saw, projected onto an App Map. This is rebuilt from
 * immutable run reports on read; it never changes the reviewed, executable
 * map that Tests compile from.
 */
import type { RunOutcome } from "./run-share.js";

/**
 * - passing: the latest run that reached this screen passed.
 * - failing: the latest run that reached this screen stopped on it.
 * - seen: runs reached it, but the latest one failed somewhere else.
 * - untested: on the map, but no recent run reached it.
 * - new: runs reached a screen the map does not know yet.
 */
export type AppMapObservedStatus = "passing" | "failing" | "seen" | "untested" | "new";

export type AppMapObservedFrame = {
  runId: string;
  /** File name under the run's frames, served at /runs/:runId/frames/:file. */
  file: string;
  capturedAt: number;
};

export type AppMapObservedScreen = {
  /** Map screen id, or `new:<fingerprint>` for a screen the map lacks. */
  key: string;
  screenId?: string;
  title: string;
  status: AppMapObservedStatus;
  /** True when a run added this screen to the map on its own. */
  addedByRuns?: boolean;
  /** When the screen joined the map. */
  addedAt?: number;
  runCount: number;
  lastSeenAt?: number;
  lastRunId?: string;
  lastOutcome?: RunOutcome;
  /** Latest screenshot of this screen from a run. */
  frame?: AppMapObservedFrame;
};

export type AppMapObservedTransition = {
  fromKey: string;
  toKey: string;
  /** What the run did between the two screens, e.g. "Tap Settings". */
  label: string;
  count: number;
  lastOutcome?: RunOutcome;
};

export type AppMapObserved = {
  appMapId: string;
  runsScanned: number;
  screens: AppMapObservedScreen[];
  transitions: AppMapObservedTransition[];
  summary: {
    known: number;
    tested: number;
    failing: number;
    new: number;
  };
};
