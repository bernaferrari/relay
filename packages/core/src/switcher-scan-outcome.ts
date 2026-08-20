/**
 * Terminal evidence for a live switcher scan whose iOS navigation command has
 * an unknown outcome. This stays separate from scan execution so every caller
 * can inspect the same durable repair contract without importing a navigator.
 */
import { IosMutationOutcomeUnknownError } from "./ios-mutation-policy.js";
import type { SwitcherKind, SwitcherOption } from "./switcher-profiles.js";

export type SwitcherScanOutcomeUnknownDiagnostic = {
  schemaVersion: 1;
  status: "interrupted";
  reason: "ios-mutation-outcome-unknown";
  message: string;
  app: string;
  kind: SwitcherKind;
  serial: string;
  phase: "open-app" | "entry-path" | "picker-path" | "ensure-picker" | "scan";
  scanPass: 1 | 2;
  picker: {
    /** Relay had read enough semantic evidence to identify the option list. */
    proven: boolean;
    /** Rows collected before the uncertain command, never a speculative reread. */
    partialRows: SwitcherOption[];
    scrollsCompleted: number;
  };
  repair: {
    terminal: true;
    nextAction: "capture-current-screen-before-any-retry";
    blocked: Array<
      "fallback-target" | "retry-launch" | "path-step" | "next-scan-page" | "second-scan-pass"
    >;
  };
};

export type SwitcherScanProgress = {
  phase: SwitcherScanOutcomeUnknownDiagnostic["phase"];
  scanPass: 1 | 2;
  pickerProven: boolean;
  partialRows: Map<string, SwitcherOption>;
  scrollsCompleted: number;
};

const diagnostics = new WeakMap<object, SwitcherScanOutcomeUnknownDiagnostic>();

export function createSwitcherScanProgress(): SwitcherScanProgress {
  return {
    phase: "open-app",
    scanPass: 1,
    pickerProven: false,
    partialRows: new Map(),
    scrollsCompleted: 0,
  };
}

function partialRows(progress: SwitcherScanProgress): SwitcherOption[] {
  return [...progress.partialRows.values()]
    .map((row) => structuredClone(row))
    .sort((left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
    );
}

/** Attach one immutable, reviewable stop result without changing the original error identity. */
export function attachSwitcherScanOutcomeUnknownDiagnostic(
  error: unknown,
  input: { app: string; kind: SwitcherKind; serial: string },
  progress: SwitcherScanProgress,
): void {
  if (!(error instanceof IosMutationOutcomeUnknownError)) return;
  const diagnostic: SwitcherScanOutcomeUnknownDiagnostic = {
    schemaVersion: 1,
    status: "interrupted",
    reason: "ios-mutation-outcome-unknown",
    message:
      "An iOS navigation command may already have reached the device. Relay retained the picker rows it had proven and did not dispatch recovery navigation.",
    app: input.app,
    kind: input.kind,
    serial: input.serial,
    phase: progress.phase,
    scanPass: progress.scanPass,
    picker: {
      proven: progress.pickerProven,
      partialRows: partialRows(progress),
      scrollsCompleted: progress.scrollsCompleted,
    },
    repair: {
      terminal: true,
      nextAction: "capture-current-screen-before-any-retry",
      blocked: [
        "fallback-target",
        "retry-launch",
        "path-step",
        "next-scan-page",
        "second-scan-pass",
      ],
    },
  };
  diagnostics.set(error, diagnostic);
  // Keep a serializable copy for server/MCP error boundaries while retaining
  // the original typed error for exact-once callers.
  try {
    Object.defineProperty(error, "switcherScan", {
      configurable: true,
      enumerable: true,
      value: structuredClone(diagnostic),
    });
  } catch {
    // Frozen third-party errors remain inspectable through the WeakMap.
  }
}

/** Returns the terminal repair package attached to an uncertain live switcher scan. */
export function switcherScanOutcomeUnknownDiagnostic(
  error: unknown,
): SwitcherScanOutcomeUnknownDiagnostic | undefined {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return undefined;
  const diagnostic = diagnostics.get(error);
  return diagnostic ? structuredClone(diagnostic) : undefined;
}
