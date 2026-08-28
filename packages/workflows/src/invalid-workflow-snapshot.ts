import type { WorkflowRef, WorkflowSnapshot } from "./types.js";

/** Bounded compatibility projection for malformed v1 carriers. */
export function invalidRefSnapshot(ref: WorkflowRef): WorkflowSnapshot {
  return {
    schemaVersion: 1,
    kind: "run-test",
    title: "Relay run",
    phase: "needs-attention",
    version: "invalid-ref",
    ref,
    progress: { label: "The workflow reference is invalid" },
    allowedNextActions: [],
    problems: [
      {
        code: "invalid-workflow-ref",
        title: "Relay cannot inspect this workflow",
        detail: "The opaque workflow reference is malformed or belongs to an unsupported version.",
        recovery: "Use the reference returned by start without editing it.",
        retryable: false,
      },
    ],
    evidenceRefs: [],
  };
}
