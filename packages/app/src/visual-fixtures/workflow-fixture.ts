import type {
  ProductRecordingState,
  RecordingProductService,
} from "../data/recording-product-service";
import type { RunProductService } from "../data/run-product-service";
import type { TestEditorProductService } from "../data/test-editor-product-service";
import { createActiveRecordingTarget } from "./active-recording-fixture";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type WorkflowData = {
  stage: "start" | "recording" | "reviewing" | "committed";
  replayAttempts: number;
  runAttempts: number;
  testName: string;
  note: string;
};

const KEY = "relay:visual-workflow-fixture:v1";
const target = {
  kind: "browser" as const,
  platform: "browser" as const,
  targetId: "workflow-browser",
};
const ids = {
  workflowId: "workflow-stateful",
  sessionId: "session-stateful",
  testId: "test-stateful",
  runId: "run-stateful",
};
const initial: WorkflowData = {
  stage: "start",
  replayAttempts: 0,
  runAttempts: 0,
  testName: "Verify checkout totals",
  note: "Captured from the Checkout browser",
};

function load(store: Store): WorkflowData {
  try {
    const value: unknown = JSON.parse(store.getItem(KEY) ?? "null");
    if (!value || typeof value !== "object") return initial;
    const record = value as Partial<WorkflowData>;
    return {
      ...initial,
      ...record,
      stage:
        record.stage === "recording" || record.stage === "reviewing" || record.stage === "committed"
          ? record.stage
          : "start",
      replayAttempts: typeof record.replayAttempts === "number" ? record.replayAttempts : 0,
      runAttempts: typeof record.runAttempts === "number" ? record.runAttempts : 0,
      testName: typeof record.testName === "string" ? record.testName : initial.testName,
      note: typeof record.note === "string" ? record.note : initial.note,
    };
  } catch {
    return initial;
  }
}

export function createWorkflowFixture(store: Store) {
  let data = load(store);
  const save = () => store.setItem(KEY, JSON.stringify(data));
  const state = (): ProductRecordingState => {
    const reviewing = data.stage === "reviewing";
    const committed = data.stage === "committed";
    const replayFailed = data.replayAttempts === 1;
    return {
      status: committed ? "saved" : reviewing ? "reviewing" : "recording",
      targets: [target],
      selectedTarget: target,
      snapshot: {
        schemaVersion: 1,
        kind: "author-test",
        title: data.testName,
        phase: committed ? "succeeded" : "running",
        stage: committed ? "committed" : reviewing ? "reviewing" : "recording",
        version: `workflow-${data.stage}-${data.replayAttempts}`,
        workflow: { workflowId: ids.workflowId, expectedVersion: 1 },
        frozen: {
          title: data.testName,
          actorId: "human:visual-fixture",
          appMapId: "checkout-app",
          appMapRevision: 1,
          target,
        },
        authoring: {
          sessionId: ids.sessionId,
          ...(committed ? { committedTestId: ids.testId } : {}),
        },
        ...(reviewing || committed
          ? {
              review: {
                actionCount: 2,
                currentRevision: 1,
                revisionCount: 1,
                actions: [
                  {
                    id: "workflow-open-cart",
                    intent: "Open the cart",
                    stepCount: 1,
                    proofStatus: "verified" as const,
                    captureProof: "" as const,
                  },
                  {
                    id: "workflow-check-total",
                    intent: "Check the order total",
                    stepCount: 1,
                    proofStatus: replayFailed ? ("unverified" as const) : ("verified" as const),
                    captureProof: replayFailed ? ("" as const) : ("replay-proved" as const),
                  },
                ],
                ...(data.replayAttempts
                  ? {
                      latestReplay: {
                        id: "replay-stateful",
                        takeRevision: 1,
                        outcome: replayFailed ? ("failed" as const) : ("passed" as const),
                      },
                    }
                  : {}),
                replayRequired: data.replayAttempts !== 2,
              },
            }
          : {}),
        progress: { label: committed ? "Saved Test" : reviewing ? "Ready to review" : "Recording" },
        allowedNextActions: committed
          ? []
          : reviewing
            ? data.replayAttempts === 2
              ? ["inspect", "replay", "approve"]
              : ["inspect", "replay"]
            : ["inspect", "record", "stop"],
        problems: replayFailed
          ? [
              {
                code: "replay-failed",
                detail: "The first replay was interrupted.",
                recovery: "Retry replay to continue.",
              },
            ]
          : [],
        evidenceRefs: [],
      },
    } as unknown as ProductRecordingState;
  };
  const productService: RecordingProductService = {
    listApps: async () => [{ id: "checkout-app", name: "Checkout" }],
    connect: async () => ({
      status: "target-selection",
      targets: [target],
      selectedTarget: target,
    }),
    presentTargets: async () => [
      { ...target, name: "Checkout browser", detail: "Managed browser · Ready" },
    ],
    begin: async () => {
      data.stage = "recording";
      save();
      return state();
    },
    inspect: async () => state(),
    getOptimization: async () => ({ proposal: null }),
    getEvidencePreview: async () => null,
    recordCurrent: async () => state(),
    checkpoint: async () => state(),
    stop: async () => {
      data.stage = "reviewing";
      save();
      return state();
    },
    edit: async () => state(),
    replay: async () => {
      data.replayAttempts += 1;
      save();
      return state();
    },
    approve: async (name) => {
      data.testName = name || data.testName;
      data.stage = "committed";
      save();
      return state();
    },
    previewTarget: async () => createActiveRecordingTarget(),
    liveTarget: async () => createActiveRecordingTarget(),
  };
  const test = () => ({
    id: ids.testId,
    name: data.testName,
    appMapId: "checkout-app",
    appName: "Checkout",
    stepCount: 2,
    steps: [
      {
        id: "workflow-open-cart",
        kind: "action",
        intent: "Open the cart",
        binding: { status: "resolved" },
        execution: { status: "ready" },
      },
      {
        id: "workflow-check-total",
        kind: "assertion",
        intent: "Check the order total",
        note: data.note,
        binding: { status: "resolved" },
        execution: { status: "ready" },
      },
    ],
  });
  let runStarted = false;
  let runFailureReads = 0;
  const runState = () =>
    ({
      status: runStarted ? "succeeded" : "queued",
      workflow: { workflowId: "run-workflow-stateful", expectedVersion: 1 },
      run: { jobId: "job-stateful", runId: ids.runId },
      snapshot: {
        schemaVersion: 1,
        kind: "run-test",
        title: data.testName,
        phase: runStarted ? "succeeded" : "queued",
        version: `run-${data.runAttempts}`,
        workflow: { workflowId: "run-workflow-stateful", expectedVersion: 1 },
        target,
        execution: { jobId: "job-stateful", runId: ids.runId },
        progress: {
          label: runStarted ? "Run complete" : "Queued",
          completed: runStarted ? 2 : 0,
          total: 2,
        },
        allowedNextActions: ["inspect"],
        problems: [],
        evidenceRefs: [],
      },
      ...(data.runAttempts === 1 && !runStarted && runFailureReads > 0
        ? {
            recovery: {
              code: "operation-unavailable",
              title: "Run interrupted",
              retryable: true,
              detail: "The first run was interrupted.",
              recovery: "Retry the Run.",
            },
          }
        : {}),
    }) as unknown as Awaited<ReturnType<RunProductService["inspect"]>>;
  const runService: RunProductService = {
    getTest: async () => test() as never,
    listTestRuns: async () => [],
    listTargets: async () => [
      { ...target, name: "Checkout browser", detail: "Managed browser · Ready" },
    ],
    presentTargets: async () => [
      { ...target, name: "Checkout browser", detail: "Managed browser · Ready" },
    ],
    start: async () => {
      data.runAttempts += 1;
      save();
      if (data.runAttempts === 1) {
        runFailureReads = 2;
        return {
          ...runState(),
          run: undefined,
          recovery: {
            code: "operation-unavailable",
            title: "Run interrupted",
            retryable: true,
            detail: "The first run was interrupted.",
            recovery: "Retry the Run.",
          },
        } as never;
      }
      runStarted = true;
      save();
      return runState();
    },
    inspect: async () => {
      if (data.runAttempts === 1 && !runStarted) {
        if (runFailureReads > 0) {
          runFailureReads -= 1;
          return {
            ...runState(),
            run: undefined,
            recovery: {
              code: "operation-unavailable",
              title: "Run interrupted",
              retryable: true,
              detail: "The first run was interrupted.",
              recovery: "Retry the Run.",
            },
          };
        }
        runStarted = true;
        data.runAttempts = 2;
        save();
      }
      return runState();
    },
    watch: async ({ onState } = {}) => {
      onState?.(runState());
      return runState();
    },
    cancel: async () => runState(),
    getReport: async () =>
      ({
        runId: ids.runId,
        title: data.testName,
        outcome: "passed",
        targetName: "Checkout browser",
        durationMs: 1200,
        timeline: [
          {
            id: "workflow-open-cart",
            index: 0,
            title: "Open the cart",
            state: "passed",
            durationMs: 500,
            evidenceCount: 1,
          },
          {
            id: "workflow-check-total",
            index: 1,
            title: "Check the order total",
            state: "passed",
            durationMs: 700,
            evidenceCount: 1,
          },
        ],
        evidence: [
          {
            id: "workflow-evidence",
            title: "Order total",
            items: [{ id: "workflow-frame", label: "Final checkout", kind: "screenshot" }],
          },
        ],
      }) as never,
    getRawEvidence: async () => ({ events: [] }),
  };
  const testEditorService = {
    get: async () => ({
      appMapId: "checkout-app",
      appName: "Checkout",
      revision: 1,
      test: test(),
      history: [],
      repairs: [],
    }),
    edit: async ({ document }: { document: unknown }) => document,
    decideRepair: async ({ document }: { document: unknown }) => document,
  } as unknown as TestEditorProductService;
  return { productService, runService, testEditorService, ids };
}
