/** @jsxImportSource react */
import type { ProductRunSummary } from "@relay/product/catalog";
import type { ProductBatchReport } from "@relay/product/run-across";
import { previewProductRunAcross } from "@relay/product/run-across";
import { createMemoryHistory } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RelayV2App } from "../app";
import { applyColorScheme, validColorScheme } from "../data/appearance-preference";
import type { AppResourcesProductService } from "../data/app-resources-product-service";
import type { CatalogProductService } from "../data/catalog-product-service";
import type { ChangeProductService } from "../data/change-product-service";
import type { DeviceProductService } from "../data/device-product-service";
import type { MapProductService } from "../data/map-product-service";
import type { LiveTestEditorProductService } from "../data/live-test-editor-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { RunProductService } from "../data/run-product-service";
import { definitions, type FixtureName } from "./fixture-routes";
import { fixtureSettingsService } from "./settings-fixture";
import { fixtureChangeService } from "./change-fixture";
import { failedReport, videoReport } from "./report-fixture";
import { activeRecordingState, createActiveRecordingTarget } from "./active-recording-fixture";
import { createWorkflowFixture } from "./workflow-fixture";
import type { LiveTargetSnapshot } from "../data/live-target-session";
import type { RunAcrossProductService } from "../data/run-across-product-service";
import { emptyPlanFindings } from "./empty-findings";
import type { SessionProductService } from "../data/session-product-service";
import type { SuiteProfileProductService } from "../data/suite-profile-product-service";
import type { BrowserSpacesProductService } from "../data/browser-spaces-product-service";
import type { AgentDebugProductService } from "../data/agent-debug-product-service";
import type { Platform } from "../platform/types";
import "../styles/globals.css";

try {
  applyColorScheme(validColorScheme(window.localStorage.getItem("relay-color-scheme")));
} catch {
  applyColorScheme("system");
}

const FIXTURE_TIME = Date.UTC(2026, 8, 4, 12, 0, 0);
const VISUAL_NOW = 1_788_390_000_000;
const fixture = new URLSearchParams(window.location.search).get("fixture") as FixtureName | null;
if (!fixture || !definitions[fixture]) throw new TypeError(`Unknown visual fixture: ${fixture}`);

const platform: Platform = {
  platform: "web",
  getServerUrl: () => "http://visual-fixture.invalid",
  storage: {
    get: (key) => window.localStorage.getItem(`visual:${key}`),
    set: (key, value) => window.localStorage.setItem(`visual:${key}`, value),
    remove: (key) => window.localStorage.removeItem(`visual:${key}`),
  },
};

const apps = [{ id: "checkout-app", name: "Checkout" }] as const;
const prerecord = fixture.startsWith("prerecord-") || fixture === "workflow";
const populatedHome = fixture === "home-populated";
const previewTarget = {
  kind: "browser" as const,
  platform: "browser" as const,
  targetId: "checkout-browser",
};

function paintPrerecordCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 768;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#f5f6f8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(92, 46, 584, 420);
  context.fillStyle = "#171719";
  context.font = "600 28px system-ui";
  context.fillText("Checkout", 132, 104);
  context.fillStyle = "#62636a";
  context.font = "18px system-ui";
  context.fillText("Order summary", 132, 150);
  context.fillStyle = "#e5e7eb";
  context.fillRect(132, 184, 504, 2);
  context.fillStyle = "#171719";
  context.font = "600 22px system-ui";
  context.fillText("Total", 132, 240);
  context.fillText("$84.00", 548, 240);
  context.fillStyle = "#171719";
  context.fillRect(132, 322, 504, 64);
  context.fillStyle = "#ffffff";
  context.font = "600 20px system-ui";
  context.fillText("Place order", 330, 362);
}

const defaultRecordingService = {
  listApps: async () => {
    if (fixture === "apps-error") throw new Error("Relay is offline");
    return fixture === "home-empty" ? [] : apps;
  },
  connect: async () => ({
    status: "target-selection" as const,
    targets: prerecord || populatedHome ? [previewTarget] : [],
  }),
  presentTargets: async () =>
    prerecord || populatedHome
      ? [{ ...previewTarget, name: "Checkout browser", detail: "Managed browser · Ready" }]
      : [],
  inspect: async () =>
    fixture === "recording-active"
      ? activeRecordingState
      : fixture === "recording-review"
        ? {
            status: "reviewing" as const,
            targets: [previewTarget],
            selectedTarget: previewTarget,
            snapshot: {
              schemaVersion: 1 as const,
              kind: "author-test" as const,
              title: "Complete checkout and confirm the order",
              phase: "running" as const,
              stage: "reviewing" as const,
              version: "review-fixture-v4",
              workflow: { workflowId: "recording-checkout", expectedVersion: 4 },
              frozen: {
                title: "Complete checkout and confirm the order",
                actorId: "human:fixture",
                appMapId: "checkout-app",
                appMapRevision: 4,
                target: previewTarget,
              },
              authoring: { sessionId: "recording-checkout" },
              review: {
                actionCount: 4,
                currentRevision: 4,
                revisionCount: 4,
                actions: [
                  {
                    id: "open-cart",
                    intent: "Open the shopping cart",
                    stepCount: 1,
                    kind: "tap" as const,
                    startedAt: FIXTURE_TIME,
                    finishedAt: FIXTURE_TIME + 1_200,
                    durationMs: 1_200,
                    evidenceCount: 2,
                    proofStatus: "verified" as const,
                    captureProof: "relay-controlled" as const,
                  },
                  {
                    id: "apply-code",
                    intent: "Apply the saved discount code",
                    stepCount: 2,
                    kind: "mixed" as const,
                    startedAt: FIXTURE_TIME + 1_200,
                    finishedAt: FIXTURE_TIME + 4_800,
                    durationMs: 3_600,
                    evidenceCount: 3,
                    proofStatus: "verified" as const,
                    captureProof: "relay-controlled" as const,
                  },
                  {
                    id: "review-total",
                    intent: "Discounted total is visible",
                    label: "Discounted total is visible",
                    stepCount: 0,
                    kind: "screenshot" as const,
                    startedAt: FIXTURE_TIME + 4_800,
                    finishedAt: FIXTURE_TIME + 5_100,
                    durationMs: 300,
                    evidenceCount: 1,
                    proofStatus: "pixels-only" as const,
                    captureProof: "relay-controlled" as const,
                  },
                  {
                    id: "place-order",
                    intent: "Place the order",
                    stepCount: 1,
                    kind: "tap" as const,
                    startedAt: FIXTURE_TIME + 5_100,
                    finishedAt: FIXTURE_TIME + 7_800,
                    durationMs: 2_700,
                    evidenceCount: 2,
                    proofStatus: "verified" as const,
                    captureProof: "relay-controlled" as const,
                  },
                ],
                timeline: {
                  startedAt: FIXTURE_TIME,
                  finishedAt: FIXTURE_TIME + 7_800,
                  durationMs: 7_800,
                  actionCount: 4,
                  evidenceCount: 8,
                  observationCount: 5,
                },
                replayRequired: true,
              },
              progress: { label: "Ready to review" },
              allowedNextActions: ["inspect", "edit", "replay"] as const,
              problems: [],
              evidenceRefs: [],
            },
          }
        : { status: "idle" as const, targets: [] },
  previewTarget: async () => {
    if (fixture === "prerecord-failure") throw new Error("offline");
    let current: LiveTargetSnapshot = {
      status: "connecting",
      target: previewTarget,
    };
    const listeners = new Set<(value: LiveTargetSnapshot) => void>();
    return {
      snapshot: () => current,
      subscribe(listener: (value: LiveTargetSnapshot) => void) {
        listeners.add(listener);
        listener(current);
        return () => listeners.delete(listener);
      },
      mount(canvas: HTMLCanvasElement) {
        if (fixture === "prerecord-ready") {
          paintPrerecordCanvas(canvas);
          current = { status: "streaming", target: previewTarget };
          for (const listener of listeners) listener(current);
        }
        return () => undefined;
      },
      input: async () => undefined,
      close: () => undefined,
    };
  },
  liveTarget: async () => createActiveRecordingTarget(),
} as unknown as RecordingProductService;
const workflowFixture =
  fixture === "workflow" ? createWorkflowFixture(window.localStorage) : undefined;
const recordingService = workflowFixture?.productService ?? defaultRecordingService;

function fixtureRun(index: number): ProductRunSummary {
  const failed = index % 7 === 4;
  const review = index % 11 === 7;
  return {
    id: `run-${index + 1}`,
    title: index % 3 === 0 ? "Complete checkout" : "Apply discount and confirm total",
    testName: index % 3 === 0 ? "Complete checkout" : "Apply discount and confirm total",
    testId: `test-${index + 1}`,
    appMapId: "checkout-app",
    appName: "Checkout",
    targetName: index % 2 ? "Pixel 9" : "Golden Chromium",
    platform: index % 2 ? "android" : "browser",
    phase: "completed",
    outcome: review ? "uncertain" : failed ? "product-failure" : "passed",
    queuedAt: FIXTURE_TIME - (index + 2) * 60_000,
    finishedAt: FIXTURE_TIME - (index + 1) * 60_000,
    durationMs: 1_400 + index * 13,
    status: "completed",
    action: "Open Report",
    identity: { runId: `run-${index + 1}` },
    links: { self: `/runs/run-${index + 1}` },
  };
}

const largeRuns = Array.from({ length: 240 }, (_, index) => fixtureRun(index));
const catalogService: CatalogProductService = {
  listTests: async () =>
    fixture === "apps-list" ||
    fixture === "app-overview" ||
    fixture === "tests-library" ||
    populatedHome
      ? [
          {
            id: "test-checkout",
            name: "Complete checkout",
            appMapId: "checkout-app",
            appName: "Checkout",
            stepCount: 3,
            status: "ready",
            updatedAt: FIXTURE_TIME - 60_000,
            href: "/tests/test-checkout",
          },
        ]
      : [],
  getTest: async () => undefined,
  listRuns: async () =>
    fixture === "runs-large"
      ? largeRuns
      : fixture === "apps-list" ||
          fixture === "app-overview" ||
          fixture === "tests-library" ||
          populatedHome
        ? [fixtureRun(0), fixtureRun(1), fixtureRun(2)]
        : [],
  getRun: async () => undefined,
};
const mapService: MapProductService = {
  get: async (appMapId) => ({
    appMapId,
    appName: "Checkout",
    revision: 4,
    screens:
      fixture === "map-overview"
        ? [
            {
              id: "cart",
              title: "Cart",
              position: { x: 24, y: 24 },
              variantCount: 1,
              variants: [],
              coveringTests: [{ id: "test-checkout", name: "Complete checkout" }],
              recentFailures: [],
            },
            {
              id: "confirmation",
              title: "Order confirmation",
              position: { x: 350, y: 24 },
              variantCount: 1,
              variants: [],
              coveringTests: [],
              recentFailures: [
                { id: "failure", outcome: "product-failure", runId: "run-checkout" },
              ],
            },
          ]
        : [],
    paths:
      fixture === "map-overview"
        ? [
            {
              id: "place-order",
              label: "Place order",
              fromScreenId: "cart",
              toScreenId: "confirmation",
              fromTitle: "Cart",
              toTitle: "Order confirmation",
              coveringTests: [{ id: "test-checkout", name: "Complete checkout" }],
            },
          ]
        : [],
    coverage: {
      screenCount: fixture === "map-overview" ? 2 : 0,
      coveredScreenCount: fixture === "map-overview" ? 1 : 0,
      pathCount: fixture === "map-overview" ? 1 : 0,
      coveredPathCount: fixture === "map-overview" ? 1 : 0,
      testCount: 1,
    },
    pendingProposalCount: 0,
    navigation: { route: "/apps/:appId/map", href: `/apps/${appMapId}/map` },
  }),
};
const appResourcesService: AppResourcesProductService = {
  createApp: async (name) => ({ id: "created-app", name }),
  listVersions: async () => {
    if (fixture === "app-versions-error") throw new Error("Relay is offline");
    return [
      {
        id: "checkout-ios-340",
        name: "Checkout 3.4.0",
        platform: "ios",
        status: "ready",
        applicationId: "com.example.checkout",
        configuration: "release",
        sourceSha: "982aa748",
        updatedAt: FIXTURE_TIME - 86_400_000,
      },
      {
        id: "checkout-web-staging",
        name: "Checkout web staging",
        platform: "web",
        status: "uploaded",
        configuration: "staging",
        updatedAt: FIXTURE_TIME - 172_800_000,
      },
    ];
  },
  listBrowserAccounts: async () => {
    if (fixture === "app-accounts-error") throw new Error("Relay is offline");
    return [
      {
        target: { id: "checkout-browser", name: "Checkout browser" },
        fixture: {
          schemaVersion: 1,
          id: "1da46c45-cf4d-43fb-bb5f-1bd2fe761154",
          reference: "authfx:1da46c45-cf4d-43fb-bb5f-1bd2fe761154:1",
          revision: 1,
          projectId: "default",
          targetId: "checkout-browser",
          name: "Staging buyer",
          origins: ["https://checkout.example"],
          cookieCount: 3,
          createdAt: FIXTURE_TIME - 180_000,
          createdBy: "human:fixture",
        },
      },
    ];
  },
};
const changeService: ChangeProductService = fixture.startsWith("change")
  ? fixtureChangeService
  : { ...fixtureChangeService, list: async () => [] };

const fixtureTest = {
  id: "test-checkout",
  name: "Complete checkout and confirm the order",
  appMapId: "checkout-app",
  appName: "Checkout",
  stepCount: 4,
  steps: [
    { id: "open-cart", kind: "instruction" as const, intent: "Open the cart", capture: true },
    {
      id: "submit-order",
      kind: "instruction" as const,
      intent: "Submit the order with the saved delivery address",
      capture: true,
    },
    {
      id: "confirmation",
      kind: "validation" as const,
      intent: "Confirm the order number and total",
      capture: true,
    },
    { id: "receipt", kind: "instruction" as const, intent: "Open the receipt", capture: false },
  ],
};
const defaultRunService = {
  getTest: async () => fixtureTest,
  listTestRuns: async () => (fixture === "test-detail" ? [fixtureRun(0), fixtureRun(1)] : []),
  listTargets: async () => [
    {
      kind: "browser" as const,
      platform: "browser" as const,
      targetId: "checkout-browser",
      name: "Golden Chromium — Checkout staging",
      detail: "Managed browser · Ready",
    },
    {
      kind: "device" as const,
      platform: "android" as const,
      targetId: "checkout-pixel",
      name: "Pixel 9 Pro XL API 36",
      detail: "Android emulator · Ready",
    },
  ],
  getReport: async () => (fixture === "report-video" ? videoReport : failedReport),
  replay: async () => ({ jobId: "replay-checkout" }),
  getReplayJob: async () => ({ status: "running" }),
  cancelReplay: async () => undefined,
  getRawEvidence: async () => ({ redacted: true, events: [] }),
} as unknown as RunProductService;
const runService = workflowFixture?.runService ?? defaultRunService;
const workflowInitialPath =
  fixture === "workflow" &&
  JSON.parse(window.localStorage.getItem("relay:visual-workflow-fixture:v1") ?? "null")?.stage ===
    "committed"
    ? "/tests/test-stateful"
    : definitions[fixture].path;

const batchReport: ProductBatchReport = {
  id: "batch-checkout",
  title: "Checkout across saved accounts",
  status: "completed-with-problems",
  createdAt: FIXTURE_TIME - 180_000,
  updatedAt: FIXTURE_TIME - 60_000,
  totalCases: 6,
  completedCases: 6,
  passedCases: 5,
  failedCases: 1,
  pendingCases: 0,
  targetNames: ["Golden Chromium", "Pixel 9"],
  runIds: Array.from({ length: 6 }, (_, index) => `batch-run-${index + 1}`),
  cases: [
    ["Guest · English", "guest", "en", "passed"],
    ["Guest · Portuguese", "guest", "pt", "passed"],
    ["Member · English", "member", "en", "passed"],
    ["Member · Portuguese", "member", "pt", "failed"],
    ["Admin · English", "admin", "en", "passed"],
    ["Admin · Portuguese", "admin", "pt", "passed"],
  ].map(([world, account, language, status], index) => ({
    id: `case-${index + 1}`,
    index,
    phase: index === 0 ? ("pilot" as const) : ("coverage" as const),
    status: status as "passed" | "failed",
    values: { account: account!, language: language! },
    world,
    runId: `batch-run-${index + 1}`,
    ...(status === "failed"
      ? {
          error: "Checkout confirmation did not appear",
          findingCode: "PRODUCT_ASSERTION" as const,
          outcome: "product-failure",
        }
      : {}),
  })),
  navigation: { route: "/batches/:batchId", href: "/batches/batch-checkout" },
  report: {
    headline: "5 of 6 cases passed",
    detail: "Member · Portuguese failed.",
  },
};
const runAcrossService = {
  getSetup: async () => ({
    appMapId: "checkout-app",
    appMapRevision: 4,
    testId: "test-checkout",
    testName: "Complete checkout",
    appName: "Checkout",
    dataSet: {
      name: "Checkout locales",
      dimensions: [
        {
          id: "locale",
          name: "Language",
          kind: "language",
          values: [
            { id: "en", label: "English" },
            { id: "pt", label: "Portuguese" },
          ],
        },
      ],
    },
  }),
  preview: previewProductRunAcross,
  getReport: async () => batchReport,
  getFailureClusters: async () => ({ batchId: batchReport.id, clusters: [] }),
  getFindings: async () => emptyPlanFindings(batchReport.id),
  exportReport: async () => ({
    ...batchReport,
    export: { rootDir: "/relay/exports/batch-checkout", jobIds: [...batchReport.runIds] },
  }),
} as unknown as RunAcrossProductService;

const fixtureSuite = {
  id: "release-smoke",
  appMapId: "checkout-app",
  appMapRevision: 4,
  appName: "Checkout",
  name: "Release smoke",
  testIds: ["test-checkout", "test-discount", "test-guest"],
  tests: [
    { id: "test-checkout", name: "Complete checkout", status: "ready" as const },
    { id: "test-discount", name: "Apply discount", status: "ready" as const },
    { id: "test-guest", name: "Guest checkout", status: "needs-review" as const },
  ],
  variableIds: ["locale", "account"],
  strategy: "cartesian" as const,
  source: { kind: "app-map-combine" as const, id: "release-smoke" },
};
const fixtureProfile = {
  id: "checkout-browser",
  name: "Checkout staging",
  targetId: "checkout-browser",
  source: { kind: "managed-target" as const, id: "checkout-browser" },
  target: {
    id: "checkout-browser",
    name: "Checkout staging",
    kind: "browser" as const,
    browser: {
      startUrl: "https://checkout.example",
      environment: { locale: "en-US", timezoneId: "America/New_York" },
      profileRetention: "retain" as const,
    },
  },
  platform: "browser" as const,
  browserEnvironment: { locale: "en-US", timezoneId: "America/New_York" },
  authenticationOptions: [
    {
      id: "fixture-buyer",
      reference: "authfx:fixture-buyer:2",
      revision: 2,
      targetId: "checkout-browser",
      name: "Staging buyer",
      origins: ["https://checkout.example"],
      cookieCount: 3,
      createdAt: FIXTURE_TIME - 180_000,
    },
  ],
  buildOptions: [
    {
      id: "checkout-web-staging",
      name: "Checkout web staging",
      platform: "web" as const,
      status: "ready",
      updatedAt: FIXTURE_TIME - 86_400_000,
    },
  ],
};
const suiteProfileService = {
  listSuites: async () => [fixtureSuite],
  getSuite: async () => fixtureSuite,
  getSuiteEditor: async () => ({
    appMapId: "checkout-app",
    appName: "Checkout",
    revision: 4,
    tests: fixtureSuite.tests,
    dataSets: [
      { id: "locale", name: "Locale", kind: "language", optionCount: 4 },
      { id: "account", name: "Account", kind: "account", optionCount: 3 },
    ],
  }),
  listEnvironmentProfiles: async () => [fixtureProfile],
  getEnvironmentProfile: async () => fixtureProfile,
  previewSuite: async () => ({
    suite: fixtureSuite,
    environment: fixtureProfile,
    caseCount: 12,
    checkCount: 36,
    expectedScreenshots: 24,
    blockers: [],
    warnings: [{ code: "review", message: "Guest checkout needs review before full coverage." }],
  }),
  preflightEnvironment: async () => ({
    profile: fixtureProfile,
    target: {
      targetId: "checkout-browser",
      ok: true,
      checkedAt: FIXTURE_TIME,
      capabilities: ["screenshot", "snapshot", "tap"],
      checks: [
        {
          id: "browser",
          label: "Managed browser",
          status: "pass",
          message: "Browser runtime is ready.",
        },
        {
          id: "profile",
          label: "Profile storage",
          status: "pass",
          message: "Persistent profile is available.",
        },
      ],
    },
  }),
} as unknown as SuiteProfileProductService;
const browserSpacesService = {
  listSpaces: async () => [
    {
      id: "checkout-browser",
      name: "Checkout staging",
      startUrl: "https://checkout.example",
      createdAt: FIXTURE_TIME - 604_800_000,
      updatedAt: FIXTURE_TIME - 60_000,
      environment: { locale: "en-US", timezoneId: "America/New_York" },
      profileRetention: "retain" as const,
      persistent: true,
      source: { kind: "managed-browser-target" as const, id: "checkout-browser" },
    },
    {
      id: "checkout-guest",
      name: "Guest checkout",
      startUrl: "https://checkout.example/guest",
      createdAt: FIXTURE_TIME - 86_400_000,
      updatedAt: FIXTURE_TIME - 120_000,
      profileRetention: "ephemeral" as const,
      persistent: false,
      source: { kind: "managed-browser-target" as const, id: "checkout-guest" },
    },
  ],
  listAuthenticationFixtures: async () => fixtureProfile.authenticationOptions,
  createSpace: async (input: {
    name: string;
    startUrl: string;
    profileRetention?: "retain" | "ephemeral";
  }) => ({
    id: "checkout-new-browser",
    name: input.name,
    startUrl: input.startUrl,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    profileRetention: input.profileRetention ?? "ephemeral",
    persistent: input.profileRetention === "retain",
    source: { kind: "managed-browser-target" as const, id: "checkout-new-browser" },
  }),
  openSpace: async (spaceId: string) => ({
    targetId: spaceId,
    name: spaceId === "checkout-guest" ? "Guest checkout" : "Checkout staging",
    url: "https://checkout.example",
  }),
} as unknown as BrowserSpacesProductService;
const fixtureSession = {
  id: "session-checkout",
  title: "Complete checkout and confirm the order",
  state: "recording" as const,
  target: previewTarget,
  appMapId: "checkout-app",
  appName: "Checkout",
  actorId: "human:fixture",
  actorKind: "human" as const,
  captureProvenance: "relay-controlled" as const,
  createdAt: VISUAL_NOW - 720_000,
  updatedAt: VISUAL_NOW - 30_000,
  lease: {
    id: "lease-checkout",
    projectId: "default",
    poolId: "browser",
    deviceSerial: "checkout-browser",
    ownerId: "human:fixture",
    status: "leased" as const,
    leasedAt: VISUAL_NOW - 720_000,
    expiresAt: VISUAL_NOW + 3_600_000,
  },
  take: {
    id: "take-checkout",
    state: "recording" as const,
    revision: 3,
    actionCount: 4,
    evidenceCount: 8,
  },
  committedTestId: "test-checkout",
  hasError: false,
  archived: false,
};
function fixtureLiveTarget() {
  const snapshot = {
    status: "streaming" as const,
    target: previewTarget,
    lastFrameAt: VISUAL_NOW,
  };
  return {
    snapshot: () => snapshot,
    subscribe(listener: (value: LiveTargetSnapshot) => void) {
      listener(snapshot);
      return () => undefined;
    },
    mount: (canvas: HTMLCanvasElement) => {
      canvas.width = 768;
      canvas.height = 512;
      const context = canvas.getContext("2d");
      if (context) {
        context.fillStyle = "#f5f6f8";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#ffffff";
        context.fillRect(92, 46, 584, 420);
        context.fillStyle = "#171719";
        context.font = "600 28px system-ui";
        context.fillText("Checkout", 132, 104);
        context.fillStyle = "#62636a";
        context.font = "18px system-ui";
        context.fillText("Order summary", 132, 150);
        context.fillStyle = "#e5e7eb";
        context.fillRect(132, 184, 504, 2);
        context.fillStyle = "#171719";
        context.font = "600 22px system-ui";
        context.fillText("Total", 132, 240);
        context.fillText("$84.00", 548, 240);
        context.fillStyle = "#171719";
        context.fillRect(132, 322, 504, 64);
        context.fillStyle = "#ffffff";
        context.font = "600 20px system-ui";
        context.fillText("Place order", 330, 362);
      }
      return () => undefined;
    },
    input: async () => undefined,
    close: () => undefined,
  };
}
const sessionProductService = {
  list: async () => [fixtureSession],
  get: async () => ({
    ...fixtureSession,
    projectId: "default",
    testName: fixtureSession.title,
    activity: [
      {
        activityId: "activity-1",
        actorId: "human:fixture",
        actorKind: "human" as const,
        operationId: "authoring.session.interact",
        requestId: "request-1",
        timestamp: VISUAL_NOW - 30_000,
        eventType: "operation.succeeded" as const,
        summary: "Captured the checkout confirmation",
      },
    ],
  }),
  live: async () => fixtureLiveTarget(),
} as unknown as SessionProductService;
const liveTestEditorService = {
  open: async () => ({
    test: {
      appMapId: "checkout-app",
      appName: "Checkout",
      revision: 4,
      test: {
        id: "test-checkout",
        organizationId: "local",
        projectId: "default",
        appMapId: "checkout-app",
        name: "Complete checkout and confirm the order",
        kind: "scenario" as const,
        intentSchemaVersion: 1 as const,
        steps: [
          {
            id: "open-cart",
            kind: "instruction" as const,
            intent: "Open the cart",
            binding: {
              status: "resolved" as const,
              kind: "connections" as const,
              connectionIds: ["open-cart"],
            },
          },
          {
            id: "place-order",
            kind: "validation" as const,
            intent: "Order confirmation is visible",
            binding: { status: "unresolved" as const, reason: "Review this checkpoint" },
          },
        ],
        updatedAt: FIXTURE_TIME,
        originApplication: "https://checkout.example",
      },
      history: [],
      repairs: [],
    },
    authoring: await sessionProductService.get("session-checkout"),
    liveTarget: fixtureLiveTarget(),
    capabilities: { edit: true as const, observe: true as const, record: false },
  }),
} as unknown as LiveTestEditorProductService;

const debugDevice = {
  id: "checkout-pixel",
  name: "Pixel 9 Pro XL",
  serial: "fixture-android",
  platform: "android" as const,
  kind: "emulator",
  osVersion: "16",
  status: "ready" as const,
  runnable: true,
  device: {
    id: "checkout-pixel",
    serial: "fixture-android",
    name: "Pixel 9 Pro XL",
    platform: "android" as const,
    kind: "emulator",
    booted: true,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  },
};
const visualDevices = [
  debugDevice,
  ...Array.from({ length: 40 }, (_, index) => ({
    ...debugDevice,
    id: `managed-browser-${index + 1}`,
    serial: `fixture-browser-${index + 1}`,
    name: `Managed browser ${index + 1}`,
    platform: "browser" as const,
    kind: "managed-browser",
    osVersion: "Chromium",
    status: "virtual" as const,
    device: {
      ...debugDevice.device,
      id: `managed-browser-${index + 1}`,
      serial: `fixture-browser-${index + 1}`,
      name: `Managed browser ${index + 1}`,
      platform: "browser" as const,
      kind: "managed-browser",
    },
  })),
];
const deviceService = {
  list: async () => (fixture === "devices" ? visualDevices : [debugDevice]),
  get: async () => debugDevice,
  actions: async () => [],
  recover: async () => {
    throw new TypeError("Recovery is not available in the visual fixture.");
  },
} as unknown as DeviceProductService;
const agentDebugService = {
  debugBug: async () => {
    throw new TypeError("Starting Agent Debug is not available in the visual fixture.");
  },
} as unknown as AgentDebugProductService;

document.documentElement.dataset.visualFixture = fixture;
const root = document.getElementById("root");
if (!root) throw new TypeError("Visual fixture root is missing");
createRoot(root).render(
  <StrictMode>
    <RelayV2App
      platform={platform}
      history={createMemoryHistory({ initialEntries: [workflowInitialPath] })}
      productService={recordingService}
      appResourcesService={appResourcesService}
      catalogService={catalogService}
      mapService={mapService}
      changeService={changeService}
      runService={runService}
      runAcrossService={runAcrossService}
      suiteProfileService={suiteProfileService}
      browserSpacesService={browserSpacesService}
      sessionService={sessionProductService}
      liveTestEditorService={liveTestEditorService}
      deviceService={deviceService}
      agentDebugService={agentDebugService}
      settingsService={fixtureSettingsService}
      testEditorService={
        (workflowFixture?.testEditorService ?? {
          get: async () =>
            (
              await liveTestEditorService.open({
                testId: "test-checkout",
                sessionId: "session-checkout",
              })
            ).test,
          edit: async ({ document }: { document: unknown }) => document,
          decideRepair: async ({ document }: { document: unknown }) => document,
        }) as never
      }
    />
  </StrictMode>,
);
