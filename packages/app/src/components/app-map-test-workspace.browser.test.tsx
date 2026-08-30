import { expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import type {
  AppMap,
  AppMapCompiledTest,
  AppMapScenarioTest,
  AppMapScenarioTestEdit,
  AppMapTest,
  DurableWorkflowRead,
  ExecutionRisk,
  WorkflowJsonValue,
} from "@relay/protocol";
import type { JobInfo } from "../lib/api-types";

const serverMock = vi.hoisted(() => ({ current: undefined as unknown }));
const recorderMock = vi.hoisted(() => ({
  current: {
    recording: () => false,
    arming: () => false,
    authoringNeedsAttention: () => false,
    take: () => null,
  } as unknown,
}));
vi.mock("../context/server", () => ({ useServer: () => serverMock.current }));
vi.mock("../context/recorder", () => ({ useRecorder: () => recorderMock.current }));

import { AppMapTestWorkspace } from "./app-map-test-workspace";

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

/**
 * The workspace measures itself rather than the viewport, so a test drives the
 * layout by reporting a container width instead of stubbing `matchMedia`.
 */
function observeWidth(width: number): () => void {
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
      this.callback(
        [{ contentRect: { width } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  return () => {
    globalThis.ResizeObserver = original;
  };
}

/** The rail footer is one "Add step" menu now, not a permanent select plus button. */
function addStep(root: HTMLElement, kind: string): void {
  const menu = root.querySelector<HTMLElement>("summary[aria-label='Add step']")!;
  menu.click();
  menu
    .closest("details")!
    .querySelector<HTMLButtonElement>(`button[data-step-kind='${kind}']`)!
    .click();
}

function fixture(): AppMap {
  return {
    schemaVersion: 1,
    id: "checkout",
    organizationId: "org",
    projectId: "project",
    name: "Checkout",
    revision: 1,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

const safeExecutionRisk: ExecutionRisk = {
  schemaVersion: 1,
  level: "safe",
  reasons: [],
  externalEffects: [],
  confirmation: "none",
  expectedAppBoundaries: [],
  maximumActions: 1,
  maximumDurationMs: 1_000,
  cleanupRequired: false,
};

function durableRunWorkflow(input: {
  workflowId: string;
  frozenIdentity: WorkflowJsonValue;
  version: number;
  status?: "active" | "needs-attention" | "terminal";
  transition?: string;
  jobId?: string;
}): DurableWorkflowRead {
  return {
    record: {
      schemaVersion: 1,
      workflowId: input.workflowId,
      organizationId: "org",
      projectId: "project",
      kind: "run-test",
      version: input.version,
      status: input.status ?? "active",
      frozenIdentity: input.frozenIdentity,
      ...(input.jobId ? { resource: { kind: "job", id: input.jobId } } : {}),
      createdBy: "human:test",
      lastActorId: "human:test",
      createdAt: 1,
      updatedAt: input.version,
      expiresAt: 100_000,
      lastTransition: input.transition ?? "created",
    },
    audit: [],
  };
}

function repeatCampaign(status: "ready-to-resume" | "running") {
  const remaining = status === "running" ? "queued" : "pending";
  const result = (id: string, value: string, index: number, pilot = false) => ({
    index,
    cellId: id,
    testId: "checkout-locale",
    world: `language=${value}`,
    values: { language: value },
    targetProfileId: "ipad-profile",
    childIntentDigest: `child-${value}`,
    outerIntentDigest: `outer-${value}`,
    wrapperGraphDigest: `wrapper-${value}`,
    staticInputDigest: `input-${value}`,
    phase: pilot ? ("pilot" as const) : ("coverage" as const),
    status: pilot ? ("passed" as const) : remaining,
    ...(pilot ? { jobId: "pilot-job", runId: "pilot-run" } : {}),
  });
  return {
    schemaVersion: 1,
    id: "repeat-1",
    projectId: "project",
    appMapId: "checkout",
    combineId: "generated-repeat",
    sourceRevision: 2,
    latestRevision: 2,
    target: { kind: "device", id: "ipad-1", platform: "ios" },
    status,
    createdAt: 1,
    updatedAt: status === "running" ? 3 : 2,
    cases: [result("result-en", "en", 0, true), result("result-it", "it", 1)],
    lineage: [{ kind: "created", at: 1, appMapRevision: 2 }],
    execution: {
      selected: { language: ["en", "it"] },
      selectedCellIds: ["result-en", "result-it"],
      strategy: "zip",
      seed: 1,
      repeat: {
        schemaVersion: 1,
        requestedAppMapRevision: 1,
        executionAppMapRevision: 2,
        testId: "checkout-locale",
        testPlanDigest: "plan-1",
        rootRecipeId: "repeat-root",
        target: { kind: "device", platform: "ios", targetId: "ipad-1" },
        spec: {
          dimensions: [{ id: "language", values: ["en", "it"] }],
          strategy: "zip",
          pilot: { mode: "representative" },
          resume: "untouched",
        },
        resolved: {
          dimensions: [{ id: "language", valueIds: ["en", "it"] }],
          strategy: "zip",
          pilot: { mode: "representative" },
          resume: "untouched",
        },
        evidence: "visual",
        pilotJobId: "pilot-job",
        selectedCaseIds: ["result-en", "result-it"],
      },
    },
  };
}

function repeatWorkflow(
  version: number,
  transition: string,
  input: WorkflowJsonValue,
  attached = false,
): DurableWorkflowRead {
  return {
    record: {
      schemaVersion: 1,
      workflowId: "repeat-workflow",
      organizationId: "org",
      projectId: "project",
      kind: "repeat-test",
      version,
      status: "active",
      frozenIdentity: input,
      ...(attached ? { resource: { kind: "campaign", id: "repeat-1" } } : {}),
      createdBy: "human:test",
      lastActorId: "human:test",
      createdAt: 1,
      updatedAt: version,
      expiresAt: 100_000,
      lastTransition: transition,
    },
    audit: [],
  };
}

test("a saved App Map Test opens the canonical Combine strip", async () => {
  document.body.replaceChildren();
  window.localStorage.removeItem("relay:repeat:v1:checkout:checkout-locale");
  const root = document.createElement("div");
  document.body.append(root);
  const scenario: AppMapScenarioTest = {
    kind: "scenario",
    id: "checkout-locale",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Checkout locale smoke",
    intentSchemaVersion: 1,
    steps: [
      {
        kind: "script",
        id: "assert-checkout",
        intent: "Check checkout",
        binding: { status: "resolved", kind: "script", source: "return true" },
      },
    ],
    surfaceBindings: [
      {
        screenId: "checkout",
        variantId: "checkout-en",
        captureMode: "full-surface",
        reason: "Checkout is longer than one viewport.",
        compare: "visual-and-semantic",
        repair: "propose-recapture",
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const map = fixture();
  map.tests[scenario.id] = scenario;
  map.variables.language = {
    id: "language",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Language",
    kind: "language",
    apply: {
      kind: "list",
      entryPath: [{ kind: "tap", target: { identifier: "settings.language" } }],
      exitPath: [{ kind: "back" }],
    },
    options: [
      { id: "en", identifier: "locale.en", label: "English" },
      { id: "it", identifier: "locale.it", label: "Italiano" },
    ],
    restoreId: "en",
    createdAt: 1,
    updatedAt: 1,
  };
  let frozenIdentity: Record<string, WorkflowJsonValue> = {};
  let workflowVersion = 1;
  const runAction = vi.fn(async (operationId: string, operationInput?: unknown) => {
    if (operationId === "app-map.get") return { appMap: map };
    if (operationId === "job.combine.campaign.repeat.active") {
      return { campaign: null };
    }
    if (operationId === "app-map.test.compile") {
      return {
        plan: { rootRecipeId: "repeat-root" },
        preflight: {
          executionRisk: safeExecutionRisk,
          schemaVersion: 1,
          mode: "offline-test-preflight",
          appMapId: "checkout",
          appMapRevision: 1,
          testId: scenario.id,
          planDigest: "plan-1",
          summary: { blockers: 0 },
          findings: [],
        },
      };
    }
    if (operationId === "workflow.create") {
      frozenIdentity = (operationInput as { frozenIdentity: Record<string, WorkflowJsonValue> })
        .frozenIdentity;
      return {
        disposition: "created",
        workflow: repeatWorkflow(1, "created", frozenIdentity),
      };
    }
    if (operationId === "workflow.transition") {
      const action = (operationInput as { action: string }).action;
      workflowVersion += 1;
      if (action === "reserve-repeat-pilot") {
        return {
          workflow: repeatWorkflow(2, "repeat-pilot-requested", frozenIdentity),
        };
      }
      const campaign = repeatCampaign(action.includes("resume") ? "running" : "ready-to-resume");
      return {
        workflow: repeatWorkflow(
          workflowVersion,
          action === "reserve-repeat-resume"
            ? "repeat-resume-requested"
            : "repeat-resume-reconciled",
          {
            ...frozenIdentity,
            executionAppMapRevision: 2,
            rootRecipeId: "repeat-root",
          },
          true,
        ),
        campaign,
      };
    }
    if (operationId === "app-map.test.run") {
      throw new Error("pilot response lost");
    }
    if (operationId === "workflow.get") {
      workflowVersion = Math.max(workflowVersion, 3);
      return {
        workflow: repeatWorkflow(
          3,
          "repeat-pilot-reconciled",
          {
            ...frozenIdentity,
            executionAppMapRevision: 2,
            rootRecipeId: "repeat-root",
          },
          true,
        ),
        campaign: repeatCampaign("ready-to-resume"),
      };
    }
    if (operationId === "job.combine.campaign.resume") {
      return { campaign: repeatCampaign("running"), jobs: [], cells: [] };
    }
    return { campaign: repeatCampaign("ready-to-resume") };
  });
  serverMock.current = {
    selectedAppMap: () => map,
    isOffline: () => false,
    health: () => "online",
    devices: () => [
      { serial: "ipad-1", name: "iPad", platform: "ios", connectionState: "connected" },
    ],
    selectedDevice: () => "ipad-1",
    actorId: () => "human:test",
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => null,
    jobs: () => [],
    persistedRuns: () => [],
    pollLiveFrame: async () => undefined,
    loadRunDetail: async () => undefined,
    frameUrlForPersisted: () => "",
    refreshAppMaps: async () => undefined,
    refreshJobs: async () => undefined,
    runAction,
    cancelJob: async () => undefined,
    estimateCampaignDurationCohorts: async () => ({ checkedAt: 1, estimates: [] }),
    preflightLocalCampaignAdmission: async () => ({}),
  };

  let dispose = render(() => <AppMapTestWorkspace testId={scenario.id} />, root);
  try {
    await settle();
    expect(root.textContent).not.toContain("Run this Test across languages");
    expect(root.querySelector("[data-app-map-test-combine-strip]")).not.toBeNull();
    expect(root.textContent).toContain("Whole page");
    expect(root.textContent).toContain("Capture the full scrolling screen.");
    expect(root.textContent).toMatch(
      /Repeat Checkout locale smoke across Language: English · visual evidence/,
    );

    root.querySelector<HTMLButtonElement>("[data-test-combine-value='it']")?.click();
    await settle();
    const pilot = root.querySelector<HTMLButtonElement>("[data-test-repeat-pilot] button");
    expect(pilot?.textContent).toContain("Run pilot");
    expect(root.textContent).toContain("Pilot: English");
    expect(root.textContent).toContain("Device: iPad · iOS");
    expect(root.textContent).toContain("waits for review before the remaining values");

    pilot?.click();
    await settle();
    const runCall = runAction.mock.calls.find(
      ([operationId]) => operationId === "app-map.test.run",
    );
    expect(runCall?.[1]).toEqual(
      expect.objectContaining({
        appMapId: "checkout",
        testId: scenario.id,
        in: { language: ["en", "it"] },
        lens: "visual",
        executionMode: "pilot",
        repeatRecovery: expect.objectContaining({
          schemaVersion: 1,
          testPlanDigest: "plan-1",
          spec: expect.objectContaining({
            dimensions: [{ id: "language", values: ["en", "it"] }],
          }),
          resolved: expect.objectContaining({
            dimensions: [{ id: "language", valueIds: ["en", "it"] }],
          }),
        }),
      }),
    );
    expect(runCall?.[1]).not.toHaveProperty("executionMode", "all");
    expect(runCall?.[1]).not.toHaveProperty("cell");
    expect(runCall?.[1]).not.toHaveProperty("surfaceCapture");
    expect(root.textContent).toContain("Continue remaining 1");
    expect(root.textContent).toContain("View pilot evidence");
    const repeatResults = root.querySelector("[data-test-repeat-results]");
    expect(repeatResults?.textContent).toContain("English");
    expect(repeatResults?.textContent).toContain("Pilot · Passed");
    expect(repeatResults?.textContent).toContain("Italiano");
    expect(repeatResults?.textContent).toContain("Untouched");

    dispose();
    root.replaceChildren();
    dispose = render(() => <AppMapTestWorkspace testId={scenario.id} />, root);
    await settle();
    expect(root.textContent).toContain("Continue remaining 1");
    expect(
      runAction.mock.calls.filter(([operationId]) => operationId === "app-map.test.run"),
    ).toHaveLength(1);
    expect(
      runAction.mock.calls.filter(([operationId]) => operationId === "workflow.get").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      JSON.parse(window.localStorage.getItem("relay:repeat:v2:checkout:checkout-locale") ?? "null"),
    ).toEqual({ workflowId: "repeat-workflow", expectedVersion: 3 });

    const continueButton = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Continue remaining"),
    );
    continueButton?.click();
    await settle();
    const resumeCall = runAction.mock.calls.find(
      ([operationId]) => operationId === "job.combine.campaign.resume",
    );
    expect(resumeCall?.[1]).toEqual(
      expect.objectContaining({
        batchId: "repeat-1",
        expectedAppMapRevision: 2,
        workflowMutation: expect.objectContaining({
          workflowId: "repeat-workflow",
          action: "repeat-resume",
        }),
      }),
    );
  } finally {
    dispose();
    window.localStorage.removeItem("relay:repeat:v1:checkout:checkout-locale");
    window.localStorage.removeItem("relay:repeat:v2:checkout:checkout-locale");
    root.remove();
  }
});

test("Whole page is disabled when the destination has no frozen full-page capture", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const scenario: AppMapScenarioTest = {
    kind: "scenario",
    id: "checkout-locale",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Checkout locale smoke",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "open",
        kind: "instruction",
        intent: "Open checkout",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["open"],
        },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const map = fixture();
  map.tests[scenario.id] = scenario;
  map.connections.open = {
    id: "open",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "checkout" },
    state: "ready",
    actions: [],
    createdAt: 1,
    updatedAt: 1,
  } as AppMap["connections"][string];
  map.variables.language = {
    id: "language",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Language",
    kind: "language",
    apply: {
      kind: "list",
      entryPath: [{ kind: "tap", target: { identifier: "settings.language" } }],
      exitPath: [{ kind: "back" }],
    },
    options: [{ id: "en", identifier: "locale.en", label: "English" }],
    restoreId: "en",
    createdAt: 1,
    updatedAt: 1,
  };
  let singleFrozen: WorkflowJsonValue = {};
  const runAction = vi.fn(async (operationId: string, operationInput?: unknown) => {
    if (operationId === "app-map.get") return { appMap: map };
    if (operationId === "job.combine.campaign.repeat.active") return { campaign: null };
    if (operationId === "app-map.test.compile") {
      return {
        plan: { rootRecipeId: "repeat-root" },
        preflight: {
          executionRisk: safeExecutionRisk,
          schemaVersion: 1,
          mode: "offline-test-preflight",
          appMapId: "checkout",
          appMapRevision: 1,
          testId: scenario.id,
          planDigest: "plan-1",
          summary: { blockers: 0 },
          findings: [],
        },
      };
    }
    if (operationId === "workflow.create") {
      singleFrozen = (operationInput as { frozenIdentity: WorkflowJsonValue }).frozenIdentity;
      return {
        disposition: "created",
        workflow: repeatWorkflow(1, "created", singleFrozen),
      };
    }
    if (operationId === "workflow.transition") {
      return {
        workflow: repeatWorkflow(2, "repeat-pilot-requested", singleFrozen),
      };
    }
    return { job: { id: "combine-cell" } };
  });
  serverMock.current = {
    selectedAppMap: () => map,
    isOffline: () => false,
    health: () => "online",
    devices: () => [
      { serial: "ipad-1", name: "iPad", platform: "ios", connectionState: "connected" },
    ],
    selectedDevice: () => "ipad-1",
    actorId: () => "human:test",
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => null,
    jobs: () => [],
    persistedRuns: () => [],
    pollLiveFrame: async () => undefined,
    loadRunDetail: async () => undefined,
    frameUrlForPersisted: () => "",
    refreshAppMaps: async () => undefined,
    refreshJobs: async () => undefined,
    runAction,
    cancelJob: async () => undefined,
    estimateCampaignDurationCohorts: async () => ({ checkedAt: 1, estimates: [] }),
    preflightLocalCampaignAdmission: async () => ({}),
  };

  const dispose = render(() => <AppMapTestWorkspace testId={scenario.id} />, root);
  try {
    await settle();
    expect(root.textContent).toContain("This destination has no frozen full-page capture.");
    const toggle = root.querySelector<HTMLInputElement>("[data-test-combine-whole-page] input");
    expect(toggle?.disabled).toBe(true);
    toggle?.click();
    await settle();
    root.querySelector<HTMLButtonElement>("[data-test-repeat-pilot] button")?.click();
    await settle();
    const runCall = runAction.mock.calls.find(
      ([operationId]) => operationId === "app-map.test.run",
    );
    expect(runCall).toBeDefined();
    expect(runCall?.[1]).not.toHaveProperty("surfaceCapture");
  } finally {
    dispose();
    root.remove();
  }
});

test("without an applyable Variable the strip tells the operator to create one", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const scenario: AppMapScenarioTest = {
    kind: "scenario",
    id: "checkout-locale",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Checkout locale smoke",
    intentSchemaVersion: 1,
    steps: [
      {
        kind: "script",
        id: "assert-checkout",
        intent: "Check checkout",
        binding: { status: "resolved", kind: "script", source: "return true" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const map = fixture();
  map.tests[scenario.id] = scenario;
  serverMock.current = {
    selectedAppMap: () => map,
    isOffline: () => false,
    health: () => "online",
    devices: () => [],
    selectedDevice: () => null,
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => null,
    jobs: () => [],
    persistedRuns: () => [],
    pollLiveFrame: async () => undefined,
    loadRunDetail: async () => undefined,
    frameUrlForPersisted: () => "",
    refreshAppMaps: async () => undefined,
    refreshJobs: async () => undefined,
    runAction: async () => ({ job: { id: "unused" } }),
    cancelJob: async () => undefined,
    estimateCampaignDurationCohorts: async () => ({ checkedAt: 1, estimates: [] }),
    preflightLocalCampaignAdmission: async () => ({}),
  };

  const openVariables = vi.fn();
  const dispose = render(
    () => <AppMapTestWorkspace testId={scenario.id} onOpenVariables={openVariables} />,
    root,
  );
  try {
    await settle();
    expect(root.textContent).not.toContain("Run this Test across languages");
    expect(root.textContent).not.toMatch(/run across languages/i);
    expect(root.querySelector("[data-app-map-test-combine-strip]")).not.toBeNull();
    const addVariable = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Add a Variable"),
    )!;
    expect(addVariable.disabled).toBe(false);
    addVariable.click();
    expect(openVariables).toHaveBeenCalledOnce();
  } finally {
    dispose();
    root.remove();
  }
});

test("an empty Test workspace leads with recording and keeps blank authoring secondary", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const record = vi.fn();
  serverMock.current = {
    selectedAppMap: () => fixture(),
    isOffline: () => false,
    health: () => "online",
    devices: () => [],
    selectedDevice: () => null,
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => null,
    jobs: () => [],
    persistedRuns: () => [],
    refreshJobs: async () => undefined,
    cancelJob: async () => undefined,
    refreshAppMaps: async () => undefined,
  };

  const dispose = render(() => <AppMapTestWorkspace onRecord={record} />, root);
  await settle();
  expect(root.textContent).toContain("Record test");
  expect(root.textContent).toContain("add checkpoints, review the recording");
  expect(root.textContent).toContain("Start a blank Test");
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("Record test"))
    ?.click();
  expect(record).toHaveBeenCalledOnce();
  dispose();
  root.remove();
});

test("recording review selects immutable action proof in the main Test area", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const pixel = "data:image/png;base64,iVBORw0KGgo=";
  const take = {
    id: "take",
    state: "review" as const,
    platform: "android" as const,
    captureProvenance: {
      schemaVersion: 1 as const,
      mode: "control-and-record" as const,
      origin: "relay-control" as const,
    },
    latestReplay: { outcome: "passed" as const },
    actions: [
      {
        id: "tap",
        source: "captured" as const,
        label: "Open Settings",
        steps: [{ kind: "tap" as const, target: { label: "Settings" } }],
        stepStartIndex: 0,
        entranceEvidenceUrl: pixel,
        exitEvidenceUrl: pixel,
        proof: { source: "replay" as const, status: "verified" as const },
      },
      {
        id: "checkpoint",
        source: "manual" as const,
        label: "Settings checkpoint",
        steps: [],
        stepStartIndex: 1,
        evidenceUrl: pixel,
        entranceEvidenceUrl: pixel,
        exitEvidenceUrl: pixel,
        proof: { source: "recording" as const, status: "verified" as const },
      },
    ],
  };
  recorderMock.current = {
    recording: () => false,
    arming: () => false,
    authoringNeedsAttention: () => false,
    take: () => take,
    canRetireRecordingAttempt: () => false,
    editTake: vi.fn(async () => undefined),
    replayTake: vi.fn(async () => true),
    keepTake: vi.fn(async () => undefined),
    discardTake: vi.fn(async () => undefined),
  };
  serverMock.current = {
    selectedAppMap: () => fixture(),
    isOffline: () => false,
    health: () => "online",
    devices: () => [],
    selectedDevice: () => null,
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => null,
    jobs: () => [],
    persistedRuns: () => [],
    refreshJobs: async () => undefined,
    cancelJob: async () => undefined,
    refreshAppMaps: async () => undefined,
  };

  const dispose = render(() => <AppMapTestWorkspace />, root);
  await settle();
  const evidence = root.querySelector<HTMLElement>('[aria-label="Selected recording evidence"]')!;
  expect(evidence.textContent).toContain("Recorded action proof");
  expect(evidence.textContent).toContain("Open Settings");

  root
    .querySelector<HTMLButtonElement>('[aria-label="Review checkpoint Settings checkpoint"]')!
    .click();
  await settle();
  expect(evidence.textContent).toContain("Checkpoint evidence");
  expect(evidence.textContent).toContain("Settings checkpoint");

  dispose();
  root.remove();
  recorderMock.current = {
    recording: () => false,
    arming: () => false,
    authoringNeedsAttention: () => false,
    take: () => null,
  };
});

test("Source edits the open canonical Test and invalid YAML cannot queue a save", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const map = fixture();
  map.screens.home = {
    id: "home",
    organizationId: "org",
    projectId: "project",
    appMapId: map.id,
    title: "Home",
    identity: { schemaVersion: 1, fingerprint: "home" },
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  map.screens.settings = {
    id: "settings",
    organizationId: "org",
    projectId: "project",
    appMapId: map.id,
    title: "Settings",
    identity: { schemaVersion: 1, fingerprint: "settings" },
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  map.connections.open = {
    id: "open",
    organizationId: "org",
    projectId: "project",
    appMapId: map.id,
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "settings" },
    state: "ready",
    actions: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const scenario: AppMapScenarioTest = {
    id: "settings-test",
    organizationId: "org",
    projectId: "project",
    appMapId: map.id,
    name: "Settings path",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "open-settings",
        kind: "instruction",
        intent: "Open Settings",
        capture: true,
        binding: { status: "resolved", kind: "connections", connectionIds: ["open"] },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  map.tests[scenario.id] = scenario;
  const commitSource = vi.fn(async (_id: unknown, _input: unknown) => ({
    appMap: { revision: 2 },
  }));
  serverMock.current = {
    selectedAppMap: () => map,
    isOffline: () => false,
    health: () => "online",
    devices: () => [],
    selectedDevice: () => null,
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => null,
    jobs: () => [],
    persistedRuns: () => [],
    refreshJobs: async () => undefined,
    cancelJob: async () => undefined,
    refreshAppMaps: async () => undefined,
    runAction: commitSource,
  };

  const dispose = render(() => <AppMapTestWorkspace testId={scenario.id} />, root);
  await settle();
  const sourceButton = root.querySelector<HTMLElement>("summary[aria-label='Test options']")!;
  sourceButton.click();
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === "Edit Source")!
    .click();
  await settle();
  const editor = root.querySelector<HTMLTextAreaElement>("#test-source-editor")!;
  expect(editor.value).toContain("kind: authoring-intent");
  expect(editor.value).toContain("path:\n      - open");
  expect(editor.value).toContain("checkpoint: Settings");
  expect(editor.value).toContain("appMap: Checkout");
  expect(document.activeElement).toBe(editor);
  const validSource = editor.value;

  editor.value = "steps: [";
  editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("Bind and apply"))!
    .click();
  await settle();
  expect(root.querySelector("#test-source-error")?.textContent).toContain("not applied");
  expect(commitSource.mock.calls.filter(([id]) => id === "app-map.commit")).toHaveLength(0);

  editor.value = validSource.replace("Open Settings", "Open app settings");
  editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("Bind and apply"))!
    .click();
  await settle();
  const commitCalls = commitSource.mock.calls.filter(([id]) => id === "app-map.commit");
  expect(commitCalls).toHaveLength(1);
  expect(JSON.stringify(commitCalls[0]?.[1])).toContain("Open app settings");
  expect(root.querySelector("[role='dialog']")).toBeNull();
  expect(document.activeElement).toBe(sourceButton);
  dispose();
  root.remove();
});

test("Source keeps advanced steps intact and directs authors back to the advanced editor", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const map = fixture();
  const advanced: AppMapScenarioTest = {
    id: "advanced",
    organizationId: "org",
    projectId: "project",
    appMapId: map.id,
    name: "Advanced test",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "decision",
        kind: "decision",
        intent: "Choose a branch",
        binding: {
          status: "resolved",
          kind: "condition",
          input: "account",
          operator: "exists",
        },
        thenSteps: [],
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  map.tests[advanced.id] = advanced;
  const editTest = vi.fn();
  serverMock.current = {
    selectedAppMap: () => map,
    isOffline: () => false,
    health: () => "online",
    devices: () => [],
    selectedDevice: () => null,
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => null,
    jobs: () => [],
    persistedRuns: () => [],
    refreshJobs: async () => undefined,
    cancelJob: async () => undefined,
    refreshAppMaps: async () => undefined,
    editTest,
  };

  const dispose = render(() => <AppMapTestWorkspace testId={advanced.id} />, root);
  await settle();
  root.querySelector<HTMLElement>("summary[aria-label='Test options']")!.click();
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === "Edit Source")!
    .click();
  await settle();
  expect(root.textContent).toContain("Use the advanced Test editor");
  expect(root.textContent).toContain("Nothing has changed");
  expect(root.querySelector("#test-source-editor")).toBeNull();
  expect(editTest).not.toHaveBeenCalled();
  dispose();
  root.remove();
});

test("scenario editor creates and edits stable intent without inventing a runnable binding", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const [map, setMap] = createSignal(fixture());
  const saves: AppMapTest[] = [];
  const editBatches: AppMapScenarioTestEdit[][] = [];
  serverMock.current = {
    selectedAppMap: map,
    isOffline: () => false,
    health: () => "online",
    devices: () => [],
    selectedDevice: () => null,
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => null,
    jobs: () => [],
    persistedRuns: () => [],
    pollLiveFrame: async () => undefined,
    loadRunDetail: async () => undefined,
    frameUrlForPersisted: () => "",
    saveTest: async ({ test }: { test: AppMapTest }) => {
      saves.push(structuredClone(test));
      const next = {
        ...map(),
        revision: map().revision + 1,
        tests: { ...map().tests, [test.id]: test },
      };
      setMap(next);
      return { appMap: { revision: next.revision } };
    },
    editTest: async ({ edits }: { edits: AppMapScenarioTestEdit[] }) => {
      editBatches.push(structuredClone(edits));
      return { appMap: { revision: map().revision + editBatches.length } };
    },
    refreshAppMaps: async () => undefined,
    runAction: async () => {
      throw new Error("An unresolved test must not compile");
    },
  };

  const dispose = render(() => <AppMapTestWorkspace />, root);
  const desktopLayout = root.querySelector<HTMLElement>("[data-test-workspace-layout]")!;
  expect(desktopLayout.getAttribute("data-layout-mode")).toMatch(/wide|medium|narrow|compact/);
  expect(desktopLayout.style.gridTemplateColumns.split(" ").length).toBe(3);
  expect(root.textContent).not.toContain("Open map");
  const create = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Create Test"),
  )!;
  create.click();
  await settle();
  expect(root.textContent).toContain("Test 1");
  root.querySelector<HTMLElement>("summary[aria-label='Test options']")!.click();
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("Duplicate Test"))!
    .click();
  await settle();
  expect(saves).toHaveLength(2);
  expect(root.textContent).toContain("Test 1 copy");

  addStep(root, "instruction");
  await settle();
  expect(root.textContent).toContain("Instruction");
  expect(root.textContent).toContain("issue to fix");

  const intent = root.querySelector<HTMLTextAreaElement>("textarea[id^='test-step-intent-']")!;
  intent.value = "Open the reviewed cart";
  intent.dispatchEvent(new InputEvent("input", { bubbles: true }));
  intent.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  await settle();
  expect(
    editBatches
      .flat()
      .some((edit) => edit.kind === "step.patch" && edit.patch.intent === "Open the reviewed cart"),
  ).toBe(true);
  const blockerAction = root.querySelector<HTMLButtonElement>("button[data-test-run-primary]")!;
  expect(blockerAction.disabled).toBe(false);
  expect(blockerAction.textContent).toContain("Review Test");

  addStep(root, "decision");
  await settle();

  const branch = [...root.querySelectorAll<HTMLElement>("summary[aria-label='Add to Then']")].at(
    -1,
  )!;
  branch.click();
  branch
    .closest("details")!
    .querySelector<HTMLButtonElement>("button[data-step-kind='instruction']")!
    .click();
  await settle();
  expect(root.querySelector("button[aria-label^='Then 1: Instruction']")).not.toBeNull();

  root.querySelector<HTMLButtonElement>("button[aria-label='Duplicate Then 1']")!.click();
  await settle();
  expect(root.querySelector("button[aria-label^='Then 2: Instruction']")).not.toBeNull();

  root.querySelector<HTMLButtonElement>("button[aria-label='Delete Then 1']")!.click();
  await settle();
  expect(root.querySelector("button[aria-label^='Then 2: Instruction']")).toBeNull();
  expect(root.querySelector("button[aria-label^='Then 1: Instruction']")).not.toBeNull();
  expect(root.textContent).toContain("Deleted Describe what the person should do");

  const undo = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Undo",
  )!;
  undo.click();
  await settle();
  expect(root.querySelector("button[aria-label^='Then 2: Instruction']")).not.toBeNull();
  expect(editBatches.flat().some((edit) => edit.kind === "step.add")).toBe(true);

  dispose();
  document.body.replaceChildren();
});

test("revision conflict keeps the local Test draft and retries as semantic edits", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const scenario: AppMapScenarioTest = {
    kind: "scenario",
    id: "checkout-scenario",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Checkout",
    intentSchemaVersion: 1,
    steps: [
      {
        kind: "instruction",
        id: "open-cart",
        intent: "Open cart",
        binding: { status: "unresolved", reason: "Needs mapping" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const initial = fixture();
  initial.tests[scenario.id] = scenario;
  const [map, setMap] = createSignal(initial);
  const editBatches: AppMapScenarioTestEdit[][] = [];
  let attempts = 0;
  serverMock.current = {
    selectedAppMap: map,
    isOffline: () => false,
    health: () => "online",
    devices: () => [],
    selectedDevice: () => null,
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => null,
    jobs: () => [],
    persistedRuns: () => [],
    pollLiveFrame: async () => undefined,
    loadRunDetail: async () => undefined,
    frameUrlForPersisted: () => "",
    editTest: async ({ edits }: { edits: AppMapScenarioTestEdit[] }) => {
      editBatches.push(structuredClone(edits));
      attempts += 1;
      if (attempts === 1) throw new Error("Revision conflict: expected 1, current 2");
      return { appMap: { revision: 3 } };
    },
    refreshAppMaps: async () => {
      if (attempts === 1) setMap({ ...map(), revision: 2 });
      if (attempts === 2) {
        setMap({
          ...map(),
          revision: 3,
          tests: {
            ...map().tests,
            [scenario.id]: {
              ...scenario,
              steps: [{ ...scenario.steps[0]!, intent: "Open the reviewed cart safely" }],
            },
          },
        });
      }
    },
    runAction: async () => {
      throw new Error("An unresolved test must not compile");
    },
  };

  const dispose = render(() => <AppMapTestWorkspace testId="checkout-scenario" />, root);
  await settle();
  const intent = root.querySelector<HTMLTextAreaElement>("#test-step-intent-open-cart")!;
  intent.value = "Open the reviewed cart";
  intent.dispatchEvent(new InputEvent("input", { bubbles: true }));
  intent.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  await settle();

  expect(root.textContent).toContain("Revision conflict");
  expect(intent.value).toBe("Open the reviewed cart");
  intent.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  await settle();
  expect(root.textContent).toContain("Revision conflict");
  intent.value = "Open the reviewed cart safely";
  intent.dispatchEvent(new InputEvent("input", { bubbles: true }));
  intent.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  await settle();
  expect(root.textContent).toContain("Revision conflict");
  const retry = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Retry save"),
  )!;
  retry.click();
  await settle();

  expect(attempts).toBe(2);
  expect(root.textContent).not.toContain("Revision conflict");
  expect(editBatches[1]).toEqual([
    {
      kind: "step.patch",
      stepId: "open-cart",
      patch: { intent: "Open the reviewed cart safely" },
    },
  ]);
  expect(root.querySelector<HTMLTextAreaElement>("#test-step-intent-open-cart")?.value).toBe(
    "Open the reviewed cart safely",
  );

  dispose();
  document.body.replaceChildren();
});

test("a saved semantic edit settles after its projection refresh recovers", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const scenario: AppMapScenarioTest = {
    kind: "scenario",
    id: "checkout-refresh",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Checkout refresh",
    intentSchemaVersion: 1,
    steps: [
      {
        kind: "instruction",
        id: "open-cart-refresh",
        intent: "Open cart",
        binding: { status: "unresolved", reason: "Needs mapping" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const initial = fixture();
  initial.tests[scenario.id] = scenario;
  const [map, setMap] = createSignal(initial);
  let editCalls = 0;
  let refreshCalls = 0;
  serverMock.current = {
    selectedAppMap: map,
    isOffline: () => false,
    health: () => "online",
    devices: () => [],
    selectedDevice: () => null,
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => null,
    jobs: () => [],
    persistedRuns: () => [],
    pollLiveFrame: async () => undefined,
    loadRunDetail: async () => undefined,
    frameUrlForPersisted: () => "",
    editTest: async () => {
      editCalls += 1;
      return { appMap: { revision: 2 } };
    },
    refreshAppMaps: async () => {
      refreshCalls += 1;
      if (refreshCalls === 1) throw new Error("Projection unavailable");
      setMap({
        ...map(),
        revision: 2,
        tests: {
          ...map().tests,
          [scenario.id]: {
            ...scenario,
            steps: [{ ...scenario.steps[0]!, intent: "Open the reviewed cart" }],
          },
        },
      });
    },
    runAction: async () => {
      throw new Error("An unresolved test must not compile");
    },
  };

  const dispose = render(() => <AppMapTestWorkspace testId="checkout-refresh" />, root);
  await settle();
  const intent = root.querySelector<HTMLTextAreaElement>("#test-step-intent-open-cart-refresh")!;
  intent.value = "Open the reviewed cart";
  intent.dispatchEvent(new InputEvent("input", { bubbles: true }));
  intent.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  await settle();
  expect(root.textContent).toContain("Projection unavailable");

  const retry = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Retry save"),
  )!;
  retry.click();
  await settle();

  expect(editCalls).toBe(1);
  expect(refreshCalls).toBe(2);
  expect(root.textContent).not.toContain("Projection unavailable");
  expect(root.textContent).toContain("1 issue to fix");
  expect(
    root.querySelector<HTMLTextAreaElement>("#test-step-intent-open-cart-refresh")?.value,
  ).toBe("Open the reviewed cart");

  dispose();
  document.body.replaceChildren();
});

test("the primary Test action compiles, runs, cancels, and opens its exact result", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const restoreWidth = observeWidth(320);
  const scenario: AppMapScenarioTest = {
    kind: "scenario",
    id: "checkout-run",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Checkout run",
    intentSchemaVersion: 1,
    steps: [
      {
        kind: "script",
        id: "prepare-cart",
        intent: "Prepare cart",
        binding: { status: "resolved", kind: "script", source: "return true" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const initial = fixture();
  initial.tests[scenario.id] = scenario;
  initial.screenVariants = {
    "checkout-en": {
      id: "checkout-en",
      organizationId: "org",
      projectId: "project",
      appMapId: "checkout",
      screenId: "checkout",
      targetProfile: {
        id: "ipad-en-US",
        targetId: "ipad-1",
        source: "device",
        platform: "ios",
        name: "Design iPad · English",
        capabilities: [],
        observedAt: 1,
      },
      evidenceIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
    "checkout-pt": {
      id: "checkout-pt",
      organizationId: "org",
      projectId: "project",
      appMapId: "checkout",
      screenId: "checkout",
      targetProfile: {
        id: "ipad-pt-BR",
        targetId: "ipad-1",
        source: "device",
        platform: "ios",
        name: "Design iPad · Portuguese",
        capabilities: [],
        observedAt: 1,
      },
      evidenceIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
  };
  const rootRecipeId = "app-map:checkout:test:checkout-run:root:r1";
  const plan: AppMapCompiledTest = {
    schemaVersion: 1,
    appMapId: "checkout",
    appMapRevision: 1,
    test: {
      id: scenario.id,
      name: scenario.name,
      kind: "scenario",
      intentSchemaVersion: 1,
    },
    rootRecipeId,
    performance: {
      executableOperations: 1,
      moduleCalls: 0,
      operationCounts: { script: 1 },
      screenshotCount: 0,
      destinationProofCount: 0,
    },
    startup: { mode: "cold" },
    recipes: {
      [rootRecipeId]: {
        id: rootRecipeId,
        title: scenario.name,
        parameters: [],
        steps: [{ kind: "script", source: "return true" }],
      },
    },
    stepProvenance: [],
  };
  const [jobs, setJobs] = createSignal<JobInfo[]>([]);
  const calls: string[] = [];
  const opened: string[] = [];
  let releaseEnglishCompile!: () => void;
  const englishCompileGate = new Promise<void>((resolve) => (releaseEnglishCompile = resolve));
  let englishCompileStarted!: () => void;
  const waitingForEnglishCompile = new Promise<void>(
    (resolve) => (englishCompileStarted = resolve),
  );
  let finishRun!: () => void;
  const runGate = new Promise<void>((resolve) => (finishRun = resolve));
  let runInput: Record<string, unknown> | undefined;
  let durableIdentity: WorkflowJsonValue;
  let durableWorkflowId = "";
  const compileInputs: Record<string, unknown>[] = [];
  serverMock.current = {
    selectedAppMap: () => initial,
    isOffline: () => false,
    health: () => "online",
    devices: () => [
      { serial: "ipad-1", name: "Design iPad", platform: "ios", connectionState: "connected" },
    ],
    selectedDevice: () => "ipad-1",
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => ({ setup: {}, checks: [] }),
    jobs,
    persistedRuns: () => [],
    pollLiveFrame: async () => undefined,
    loadRunDetail: async () => undefined,
    frameUrlForPersisted: () => "",
    refreshAppMaps: async () => undefined,
    refreshJobs: async () => ({ ok: true }),
    runAction: async (id: string, input: Record<string, unknown>) => {
      calls.push(id);
      if (id === "app-map.test.compile") {
        compileInputs.push(input);
        if (input.targetProfileId === "ipad-en-US") {
          englishCompileStarted();
          await englishCompileGate;
        }
        return {
          plan,
          preflight: {
            executionRisk: safeExecutionRisk,
            schemaVersion: 1,
            mode: "offline-test-preflight",
            appMapId: "checkout",
            appMapRevision: 1,
            testId: scenario.id,
            planDigest: "compiled-before-device",
            summary: {
              recipes: 1,
              checkedSelectors: 1,
              resolvedSelectors: 1,
              unknownCursorTransitions: 1,
              reviewRequiredReturns: 0,
              blockers: 0,
              warnings: 0,
            },
            selectors: [
              {
                recipeId: "root",
                recipeStepId: "open-checkout",
                stepKind: "tap",
                target: { label: "Checkout" },
                status: "resolved",
                evidence: {
                  kind: "screen-observation",
                  references: ["screen:checkout:observation"],
                },
              },
            ],
            cursorTimeline: [
              {
                recipeId: "root",
                recipeStepId: "open-checkout",
                stepIndex: 0,
                state: "unknown",
                reason: "A later screen expectation must prove this transition at runtime.",
              },
            ],
            returns: [],
            findings: [],
          },
        };
      }
      if (id === "workflow.create") {
        durableWorkflowId = input.workflowId as string;
        durableIdentity = input.frozenIdentity as WorkflowJsonValue;
        return {
          disposition: "created",
          workflow: durableRunWorkflow({
            workflowId: durableWorkflowId,
            frozenIdentity: durableIdentity,
            version: 1,
          }),
        };
      }
      if (id === "workflow.get") {
        return {
          workflow: durableRunWorkflow({
            workflowId: durableWorkflowId,
            frozenIdentity: { ...(durableIdentity as object), rootRecipeId },
            version: 2,
            transition: "run-attached",
            jobId: "job-exact",
          }),
          job: jobs()[0],
        };
      }
      if (id === "workflow.transition" && input.action === "cancel-run") {
        const cancelled = {
          ...jobs()[0]!,
          status: "cancelled" as const,
          finishedAt: 3,
        };
        setJobs([cancelled]);
        return {
          workflow: durableRunWorkflow({
            workflowId: durableWorkflowId,
            frozenIdentity: { ...(durableIdentity as object), rootRecipeId },
            version: 4,
            status: "terminal",
            transition: "run-cancelled",
            jobId: "job-exact",
          }),
          job: cancelled,
        };
      }
      if (id === "workflow.transition") {
        return {
          workflow: durableRunWorkflow({
            workflowId: durableWorkflowId,
            frozenIdentity: { ...(durableIdentity as object), rootRecipeId },
            version: 2,
            transition: "run-attached",
            jobId: "job-exact",
          }),
          job: jobs()[0],
        };
      }
      if (id !== "app-map.test.run") throw new Error(`Unexpected operation ${id}`);
      runInput = input;
      await runGate;
      setJobs([
        {
          id: "job-exact",
          action: rootRecipeId,
          status: "queued",
          queuedAt: 2,
          logs: [],
        },
      ]);
      return {
        plan,
        planIdentity: {
          appMapId: plan.appMapId,
          appMapRevision: plan.appMapRevision,
          testId: plan.test.id,
          rootRecipeId,
        },
        job: { id: "job-exact", action: rootRecipeId, status: "queued", queuedAt: 2 },
      };
    },
    cancelJob: async () => undefined,
  };

  const dispose = render(
    () => <AppMapTestWorkspace testId={scenario.id} onOpenRun={(id) => opened.push(id)} />,
    root,
  );
  await settle();
  expect(root.textContent).toContain("Ready to run");
  const runtimeProfile = root.querySelector<HTMLSelectElement>("[data-test-runtime-profile]")!;
  expect(root.querySelector<HTMLElement>("[data-test-workspace-bar]")?.className).not.toContain(
    "flex-wrap",
  );
  expect(runtimeProfile.closest("label")?.className).toContain("min-h-11");
  expect(runtimeProfile.value).toBe("");
  const offlineCheck = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Check offline"),
  )!;
  runtimeProfile.value = "ipad-en-US";
  runtimeProfile.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  offlineCheck.click();
  await waitingForEnglishCompile;
  expect(runtimeProfile.disabled).toBe(true);
  // A UI control is disabled while checking, but an external selection change
  // must still invalidate the stale English intent before its response lands.
  runtimeProfile.value = "ipad-pt-BR";
  runtimeProfile.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  releaseEnglishCompile();
  await settle();
  expect(compileInputs).toEqual([
    { appMapId: "checkout", testId: "checkout-run", targetProfileId: "ipad-en-US" },
  ]);
  expect(root.textContent).not.toContain("Offline check passed");
  expect(root.textContent).not.toContain("Plan compiled-bef");
  calls.length = 0;
  compileInputs.length = 0;

  runtimeProfile.value = "ipad-pt-BR";
  runtimeProfile.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  expect(runtimeProfile.value).toBe("ipad-pt-BR");

  const primary = () =>
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      /Run test|Preparing run|Cancel queued run|Open result/.test(button.textContent ?? ""),
    )!;
  expect(primary().textContent).toContain("Run test");
  offlineCheck.click();
  await settle();
  expect(compileInputs).toEqual([
    { appMapId: "checkout", testId: "checkout-run", targetProfileId: "ipad-pt-BR" },
  ]);
  expect(root.textContent).toContain("Offline check passed");
  expect(root.textContent).toContain("1 of 1 selectors resolve from frozen evidence");
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("Inspect plan"))!
    .click();
  await settle();
  expect(root.textContent).toContain("1 / 1 resolved");
  expect(root.textContent).toContain("1 unknown");
  expect(root.textContent).toContain("Plan compiled-bef…");
  primary().click();
  await settle();

  expect(primary().textContent).toContain("Preparing run");
  expect(primary().getAttribute("aria-busy")).toBe("true");
  finishRun();
  await settle();

  expect(calls).toEqual([
    "app-map.test.compile",
    "app-map.test.compile",
    "workflow.create",
    "app-map.test.run",
    "workflow.transition",
  ]);
  expect(compileInputs).toEqual([
    { appMapId: "checkout", testId: "checkout-run", targetProfileId: "ipad-pt-BR" },
    { appMapId: "checkout", testId: "checkout-run", targetProfileId: "ipad-pt-BR" },
  ]);
  expect(runInput).toEqual({
    appMapId: "checkout",
    testId: "checkout-run",
    expectedRevision: 1,
    target: { kind: "device", platform: "ios", targetId: "ipad-1" },
    targetProfileId: "ipad-pt-BR",
    startup: { mode: "cold" },
    workflowRequestId: expect.any(String),
  });
  expect(primary().textContent).toContain("Cancel queued run");
  expect(root.textContent).toContain("Queued on the selected target");
  primary().click();
  await settle();

  expect(calls).toContain("workflow.get");
  expect(calls.filter((id) => id === "workflow.transition")).toHaveLength(2);
  expect(primary().textContent).toContain("Open result");
  primary().click();
  expect(opened).toEqual(["job-exact"]);

  dispose();
  restoreWidth();
  document.body.replaceChildren();
});

test("keeps a sole foreign evidence profile visible at compact width", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const restoreWidth = observeWidth(320);
  const scenario: AppMapScenarioTest = {
    kind: "scenario",
    id: "foreign-evidence",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Foreign evidence",
    intentSchemaVersion: 1,
    steps: [
      {
        kind: "script",
        id: "prepare",
        intent: "Prepare",
        binding: { status: "resolved", kind: "script", source: "return true" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const initial = fixture();
  initial.tests[scenario.id] = scenario;
  initial.screenVariants["checkout-ipad"] = {
    id: "checkout-ipad",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    screenId: "checkout",
    targetProfile: {
      id: "ipad-en-US",
      targetId: "ipad-1",
      source: "device",
      platform: "ios",
      name: "Design iPad · English",
      capabilities: [],
      observedAt: 1,
    },
    evidenceIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  serverMock.current = {
    selectedAppMap: () => initial,
    isOffline: () => false,
    health: () => "online",
    devices: () => [
      { serial: "pixel-1", name: "Pixel", platform: "android", connectionState: "connected" },
    ],
    selectedDevice: () => "pixel-1",
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => null,
    jobs: () => [],
    persistedRuns: () => [],
    pollLiveFrame: async () => undefined,
    loadRunDetail: async () => undefined,
    frameUrlForPersisted: () => "",
    refreshAppMaps: async () => undefined,
    refreshJobs: async () => undefined,
    runAction: async () => {
      throw new Error("foreign evidence must block before compile or run");
    },
    cancelJob: async () => undefined,
  };

  const dispose = render(() => <AppMapTestWorkspace testId={scenario.id} />, root);
  await settle();

  const profile = root.querySelector<HTMLSelectElement>("[data-test-runtime-profile]");
  expect(profile).not.toBeNull();
  expect(profile?.closest("label")?.className).toContain("min-h-11");
  expect([...profile!.options].map((option) => option.textContent)).toContain(
    "Design iPad · English · ipad-en-US",
  );
  expect(root.querySelector("[data-test-runtime-profile-notice]")?.textContent).toContain(
    "Evidence only: Design iPad · English · ipad-en-US",
  );
  expect(root.textContent).toContain("No saved evidence profile matches this target");
  expect(root.querySelector<HTMLElement>("[data-test-workspace-bar]")?.className).not.toContain(
    "flex-wrap",
  );

  dispose();
  restoreWidth();
  document.body.replaceChildren();
});

test("a verified checkpoint is compiled offline and sent unchanged to the exact run", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const scenario: AppMapScenarioTest = {
    kind: "scenario",
    id: "settings-warm",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Settings warm",
    intentSchemaVersion: 1,
    steps: [
      {
        kind: "script",
        id: "check-settings",
        intent: "Check Settings",
        binding: { status: "resolved", kind: "script", source: "return true" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const initial = fixture();
  initial.tests[scenario.id] = scenario;
  initial.screens.settings = {
    id: "settings",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    title: "Settings",
    variantIds: [],
    identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
    createdAt: 1,
    updatedAt: 1,
  };
  const rootRecipeId = "app-map:checkout:test:settings-warm:root:r1";
  const coldPlan: AppMapCompiledTest = {
    schemaVersion: 1,
    appMapId: "checkout",
    appMapRevision: 1,
    test: {
      id: scenario.id,
      name: scenario.name,
      kind: "scenario",
      intentSchemaVersion: 1,
    },
    rootRecipeId,
    performance: {
      executableOperations: 1,
      moduleCalls: 0,
      operationCounts: { script: 1 },
      screenshotCount: 0,
      destinationProofCount: 0,
    },
    startup: { mode: "cold" },
    recipes: {
      [rootRecipeId]: {
        id: rootRecipeId,
        title: scenario.name,
        parameters: [],
        steps: [{ kind: "script", source: "return true" }],
      },
    },
    stepProvenance: [],
  };
  const warmPlan: AppMapCompiledTest = {
    ...coldPlan,
    startup: { mode: "verified-checkpoint", screenId: "settings" },
  };
  const compileInputs: Record<string, unknown>[] = [];
  let runInput: Record<string, unknown> | undefined;
  let durableIdentity: WorkflowJsonValue;
  let durableWorkflowId = "";
  serverMock.current = {
    selectedAppMap: () => initial,
    isOffline: () => false,
    health: () => "online",
    devices: () => [
      { serial: "ipad-1", name: "Design iPad", platform: "ios", connectionState: "connected" },
    ],
    selectedDevice: () => "ipad-1",
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => ({ setup: {}, checks: [] }),
    jobs: () => [],
    persistedRuns: () => [],
    pollLiveFrame: async () => undefined,
    loadRunDetail: async () => undefined,
    frameUrlForPersisted: () => "",
    refreshAppMaps: async () => undefined,
    refreshJobs: async () => undefined,
    runAction: async (id: string, input: Record<string, unknown>) => {
      if (id === "app-map.test.compile") {
        compileInputs.push(input);
        return {
          plan: input.entryCheckpointScreenId === "settings" ? warmPlan : coldPlan,
          preflight: {
            executionRisk: safeExecutionRisk,
            schemaVersion: 1,
            mode: "offline-test-preflight",
            appMapId: "checkout",
            appMapRevision: 1,
            testId: scenario.id,
            planDigest: "settings-warm",
            summary: {
              recipes: 1,
              checkedSelectors: 0,
              resolvedSelectors: 0,
              unknownCursorTransitions: 0,
              reviewRequiredReturns: 0,
              blockers: 0,
              warnings: 0,
            },
            selectors: [],
            cursorTimeline: [],
            returns: [],
            findings: [],
          },
        };
      }
      if (id === "workflow.create") {
        durableWorkflowId = input.workflowId as string;
        durableIdentity = input.frozenIdentity as WorkflowJsonValue;
        return {
          disposition: "created",
          workflow: durableRunWorkflow({
            workflowId: durableWorkflowId,
            frozenIdentity: durableIdentity,
            version: 1,
          }),
        };
      }
      if (id === "workflow.transition") {
        return {
          workflow: durableRunWorkflow({
            workflowId: durableWorkflowId,
            frozenIdentity: { ...(durableIdentity as object), rootRecipeId },
            version: 2,
            transition: "run-attached",
            jobId: "warm-job",
          }),
          job: { id: "warm-job", action: rootRecipeId, status: "queued", queuedAt: 2 },
        };
      }
      if (id !== "app-map.test.run") throw new Error(`Unexpected operation ${id}`);
      runInput = input;
      return {
        plan: warmPlan,
        planIdentity: {
          appMapId: "checkout",
          appMapRevision: 1,
          testId: scenario.id,
          rootRecipeId,
        },
        job: { id: "warm-job", action: rootRecipeId, status: "queued", queuedAt: 2 },
      };
    },
    cancelJob: async () => undefined,
  };

  const dispose = render(() => <AppMapTestWorkspace testId={scenario.id} />, root);
  await settle();
  const startup = root.querySelector<HTMLSelectElement>("[data-test-startup-policy]")!;
  expect(startup.value).toBe("cold");
  startup.value = "checkpoint:settings";
  startup.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  expect(startup.value).toBe("checkpoint:settings");

  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("Check offline"))!
    .click();
  await settle();
  expect(compileInputs).toEqual([
    { appMapId: "checkout", testId: "settings-warm", entryCheckpointScreenId: "settings" },
  ]);
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === "Device")
    ?.click();
  await settle();
  expect(root.textContent).toContain("Verified · Settings");
  expect(root.textContent).toContain(
    "Mismatch stops for review. Relay never falls back to a cold relaunch.",
  );

  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("Run test"))!
    .click();
  await settle();
  expect(compileInputs).toHaveLength(2);
  expect(runInput).toEqual({
    appMapId: "checkout",
    testId: "settings-warm",
    expectedRevision: 1,
    target: { kind: "device", platform: "ios", targetId: "ipad-1" },
    startup: { mode: "verified-checkpoint", screenId: "settings" },
    workflowRequestId: expect.any(String),
  });

  dispose();
  document.body.replaceChildren();
});

test("offline preflight blocks device control but leaves an inspectable repair report", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const scenario: AppMapScenarioTest = {
    kind: "scenario",
    id: "checkout-preflight",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Checkout preflight",
    intentSchemaVersion: 1,
    steps: [
      {
        kind: "script",
        id: "prepare-cart",
        intent: "Prepare cart",
        binding: { status: "resolved", kind: "script", source: "return true" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const map = fixture();
  map.tests[scenario.id] = scenario;
  const calls: string[] = [];
  serverMock.current = {
    selectedAppMap: () => map,
    isOffline: () => false,
    health: () => "online",
    devices: () => [
      { serial: "ipad-1", name: "Design iPad", platform: "ios", connectionState: "connected" },
    ],
    selectedDevice: () => "ipad-1",
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => ({ setup: {}, checks: [] }),
    jobs: () => [],
    persistedRuns: () => [],
    pollLiveFrame: async () => undefined,
    loadRunDetail: async () => undefined,
    frameUrlForPersisted: () => "",
    refreshAppMaps: async () => undefined,
    refreshJobs: async () => undefined,
    saveTest: async () => ({ appMap: { revision: 1 } }),
    editTest: async () => ({ appMap: { revision: 1 } }),
    runAction: async (id: string) => {
      calls.push(id);
      return {
        plan: {
          schemaVersion: 1,
          appMapId: "checkout",
          appMapRevision: 1,
          test: { id: scenario.id, name: scenario.name, kind: "scenario", intentSchemaVersion: 1 },
          rootRecipeId: "root",
          recipes: {},
          stepProvenance: [],
          performance: {
            executableOperations: 0,
            moduleCalls: 0,
            operationCounts: {},
            screenshotCount: 0,
            destinationProofCount: 0,
          },
          startup: { mode: "cold" },
        },
        preflight: {
          executionRisk: safeExecutionRisk,
          schemaVersion: 1,
          mode: "offline-test-preflight",
          appMapId: "checkout",
          appMapRevision: 1,
          testId: scenario.id,
          planDigest: "blocked-before-device",
          summary: {
            recipes: 1,
            checkedSelectors: 1,
            resolvedSelectors: 0,
            unknownCursorTransitions: 1,
            reviewRequiredReturns: 0,
            blockers: 1,
            warnings: 0,
          },
          selectors: [
            {
              recipeId: "root",
              recipeStepId: "cloud-filter",
              stepKind: "tap",
              target: { label: "Cloud filter" },
              status: "absent",
              evidence: { kind: "screen-observation", references: ["screen:settings:observation"] },
            },
          ],
          cursorTimeline: [
            {
              recipeId: "root",
              recipeStepId: "cloud-filter",
              stepIndex: 0,
              state: "unknown",
              reason: "A later screen expectation must prove this transition at runtime.",
            },
          ],
          returns: [],
          findings: [
            {
              severity: "blocker",
              code: "selector-absent",
              recipeId: "root",
              message: "Cloud filter is absent from every frozen source accessibility observation.",
            },
          ],
        },
      };
    },
    cancelJob: async () => undefined,
  };

  const dispose = render(() => <AppMapTestWorkspace testId={scenario.id} />, root);
  await settle();
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("Run test"))!
    .click();
  await settle();

  expect(calls).toEqual(["job.combine.campaign.repeat.active", "app-map.test.compile"]);
  expect(root.textContent).toContain("1 offline issue blocks device control");
  expect(root.textContent).toContain("Cloud filter is absent");
  expect(root.textContent).toContain("0 / 1 resolved");
  expect(root.textContent).toContain("1 unknown");
  expect(root.textContent).not.toContain("Run test");

  dispose();
  document.body.replaceChildren();
});

test("a narrow workspace keeps the device on the right edge and never below the editor", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const restoreObserver = observeWidth(860);
  const scenario: AppMapScenarioTest = {
    kind: "scenario",
    id: "mobile-test",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Mobile checkout",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "mobile-step",
        kind: "instruction",
        intent: "Open checkout",
        binding: { status: "unresolved", reason: "Choose a path" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const map = fixture();
  map.tests[scenario.id] = scenario;
  map.proposals.mobileProposal = {
    id: "mobileProposal",
    organizationId: "org",
    projectId: "project",
    appMapId: map.id,
    baseRevision: map.revision,
    title: "Clarify checkout",
    status: "pending",
    changes: [
      {
        kind: "test.edit",
        testId: scenario.id,
        edits: [
          {
            kind: "step.patch",
            stepId: "mobile-step",
            patch: { intent: "Open the reviewed checkout" },
          },
        ],
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  serverMock.current = {
    selectedAppMap: () => map,
    isOffline: () => false,
    health: () => "online",
    devices: () => [],
    selectedDevice: () => null,
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => null,
    jobs: () => [],
    persistedRuns: () => [],
    pollLiveFrame: async () => undefined,
    loadRunDetail: async () => undefined,
    frameUrlForPersisted: () => "",
    refreshAppMaps: async () => undefined,
    editTest: async () => ({ appMap: { revision: 2 } }),
    saveTest: async () => ({ appMap: { revision: 2 } }),
    runAction: async () => undefined,
  };

  const dispose = render(() => <AppMapTestWorkspace testId={scenario.id} />, root);
  await settle();
  const proposed = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("1 proposed"),
  )!;
  proposed.click();
  expect(root.textContent).toContain("Open the reviewed checkout");
  root.querySelector<HTMLButtonElement>("button[aria-label='Close Test proposal review']")!.click();

  const layout = root.querySelector<HTMLElement>("[data-test-workspace-layout]")!;
  expect(layout.getAttribute("data-layout-mode")).toBe("narrow");
  const tracks = () => layout.style.gridTemplateColumns.split(" ");
  expect(tracks()).toHaveLength(3);
  expect(layout.style.gridTemplateRows).toBe("");
  // The device is docked in the third (right) track, and the steps rail is the
  // one that yields to an overlay when space runs short.
  expect(Number.parseInt(tracks()[2]!, 10)).toBeGreaterThanOrEqual(272);
  expect(root.querySelector("[data-test-rail-strip='steps']")?.textContent).toContain("Steps");
  expect(root.querySelector("[data-test-rail-strip='device']")).toBeNull();

  // Collapsing the device leaves its edge strip behind rather than moving it.
  root.querySelector<HTMLButtonElement>("button[aria-label='Hide device']")!.click();
  await settle();
  expect(root.querySelector("[data-test-rail-strip='device']")).not.toBeNull();
  expect(tracks()).toHaveLength(3);
  root.querySelector<HTMLButtonElement>("[data-test-rail-strip='device'] button")!.click();
  await settle();

  // Opening Steps here overlays the editor on the left edge; it does not push the
  // device anywhere, so the grid still has exactly three columns.
  root.querySelector<HTMLButtonElement>("[data-test-rail-strip='steps'] button")!.click();
  await settle();
  expect(tracks()).toHaveLength(3);
  expect(root.querySelector("#test-steps-tab")?.getAttribute("aria-selected")).toBe("true");
  expect(root.querySelector("#test-problems-tab")).not.toBeNull();

  // Escape leaves the floating rail and hands focus back to the control that
  // opened it, then `/` brings the rail and its search back.
  const stepSearch = root.querySelector<HTMLInputElement>("#test-step-search")!;
  stepSearch.focus();
  stepSearch.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  expect(root.querySelector("[data-test-rail-strip='steps']")).not.toBeNull();
  expect(
    document.activeElement?.closest("[data-test-rail-strip]")?.getAttribute("data-test-rail-strip"),
  ).toBe("steps");
  layout.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
  await settle();
  expect(document.activeElement?.id).toBe("test-step-search");

  // Selecting a step names it in the rail, so Live and Last run are visibly the
  // views of one step rather than two unrelated columns.
  root.querySelector<HTMLButtonElement>("#test-step-row-mobile-step")!.click();
  await settle();
  expect(root.querySelector("[data-test-rail-step='mobile-step']")?.textContent).toContain(
    "Open checkout",
  );
  const lastRun = [...root.querySelectorAll<HTMLButtonElement>("button[role='tab']")].find((tab) =>
    tab.textContent?.includes("Last run"),
  )!;
  lastRun.click();
  await settle();
  expect(root.querySelector("#test-context-device-panel")?.hasAttribute("inert")).toBe(true);
  expect(root.querySelector("#test-context-evidence-panel")?.hasAttribute("inert")).toBe(false);

  dispose();
  restoreObserver();
  document.body.replaceChildren();
});
