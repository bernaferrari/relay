import type {
  AppMapCapturePolicy,
  AppMapEntity,
  AppMapTest,
  CaseExpansionStrategy,
} from "./app-map.js";
import type { ExecutionQueueDurationQuote } from "./execution-queue.js";
import type { RouteVariantConfigurationQuote } from "./route-variant-configuration.js";
import type { ExecutionTargetRef } from "./execution-target.js";

/** Explicit runtime evidence profile for one Test × world cell.
 * Absent a binding, start/preflight inherit a default target profile when the
 * caller supplied a default target and a compatible saved profile exists. */
export type AppMapCombineCellRuntimeProfile = {
  testId: string;
  /** Canonical variable-id → value-id map. Ordering is not identity. */
  values: Record<string, string>;
  targetProfileId: string;
};

/**
 * Explicit execution location for one Test × world cell. This is deliberately
 * separate from `targetProfileId`: a profile proves the frozen evidence Relay
 * compiled against, while this reference says where the accepted work will
 * execute. A Combine run never borrows either one from another cell.
 */
export type AppMapCombineCellTargetBinding = {
  testId: string;
  /** Canonical variable-id → value-id map. Ordering is not identity. */
  values: Record<string, string>;
  target: ExecutionTargetRef;
};

/** Figma-like binding: variables × tests. Extra variables are M×N×O; extra tests run in order. */
export type AppMapCombine = AppMapEntity & {
  name: string;
  variableIds: string[];
  testIds: string[];
  /** Optional value subset per variable. Missing entries mean every saved value. */
  selected?: Record<string, string[]>;
  /** Evidence policy belongs to this run plan, so the same test can be reused
   * by a visual sweep and a fast no-screenshot smoke matrix. */
  captures?: Record<string, AppMapCapturePolicy>;
  strategy?: CaseExpansionStrategy;
  repeatPolicy?: import("./repeat-spec.js").RepeatPolicySpec;
  /** Persisted per-cell target-profile overrides. Missing cells inherit a default. */
  cellRuntimeProfiles?: AppMapCombineCellRuntimeProfile[];
};

export type AppMapCombinePreflightIssue = {
  code:
    | "missing-variable"
    | "missing-test"
    | "empty-selection"
    | "invalid-variable"
    | "invalid-test"
    | "compile-failed"
    | "large-run"
    | "unknown-screenshot-count"
    | "target-missing"
    | "target-not-ready"
    | "missing-binding"
    | "duplicate-binding"
    | "foreign-binding"
    | "extra-binding"
    | "mismatched-binding"
    | "zero-bindings"
    | "missing-target-binding"
    | "duplicate-target-binding"
    | "foreign-target-binding"
    | "extra-target-binding"
    | "mismatched-target-binding"
    | "unsupported-target-binding"
    | "zero-target-bindings"
    | "unsafe-starting-state"
    | "unsafe-execution-queue";
  message: string;
  cellId?: string;
  testId?: string;
  values?: Record<string, string>;
  targetProfileId?: string;
};

export type AppMapCombineCellBindingStatus =
  | "bound"
  | "missing"
  | "foreign"
  | "duplicate"
  | "extra"
  | "mismatched";

export type AppMapCombineCellState = {
  cellId: string;
  testId: string;
  testName: string;
  values: Record<string, string>;
  worldLabel: string;
  targetProfileId?: string;
  /** The explicitly accepted execution location, when the caller supplied one. */
  target?: ExecutionTargetRef;
  binding: AppMapCombineCellBindingStatus;
  preflight?: "ready" | "blocked";
  message?: string;
};

/** Measured serial wall-clock for one Combine shape. Parallel N is unquoted. */
export type AppMapCombineObservedDuration = {
  durationMs: number;
  provenance: "observed-p50" | "observed-p95" | "observed-sample";
  sampleCount: number;
  workItemCount: number;
  campaignIds: string[];
};

/** Exact run-plan projection shared by the canvas, server, and CLI. */
export type AppMapCombinePreflight = {
  ok: boolean;
  appMapId: string;
  combineId: string;
  name: string;
  formula: string;
  strategy: CaseExpansionStrategy;
  variables: Array<{
    id: string;
    name: string;
    selectedCount: number;
    availableCount: number;
  }>;
  tests: Array<{
    id: string;
    name: string;
    kind: AppMapTest["kind"];
    expectedScreenshots?: number;
  }>;
  worlds: number;
  checks: number;
  deviceRuns: number;
  expectedScreenshots?: number;
  estimatedDurationMs?: number;
  /** Wall-clock of completed Plan runs with the same cell count. Never a
   * guessed recipe estimate. Parallel contexts stay unquoted here. */
  observedDuration?: AppMapCombineObservedDuration;
  /** Separate Fast UI / live output / stateful-survival duration targets when
   * members declare a queue. Not a three-minute workbook promise. */
  queueQuotes?: ExecutionQueueDurationQuote[];
  /** Android vs iOS vs web dest-ends as separate configurations. Captions
   * are not one Test covering three platforms by name. */
  routeVariantConfigurations?: RouteVariantConfigurationQuote[];
  blockers: AppMapCombinePreflightIssue[];
  warnings: AppMapCombinePreflightIssue[];
  cells: AppMapCombineCellState[];
  target?: {
    serial: string;
    state: "connected" | "not-ready" | "missing";
  };
};
