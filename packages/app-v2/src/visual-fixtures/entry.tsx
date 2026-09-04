/** @jsxImportSource react */
import type { ProductRunSummary } from "@relay/product/catalog";
import type { ProductBatchReport } from "@relay/product/run-across";
import { createMemoryHistory } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RelayV2App } from "../app";
import type { AppResourcesProductService } from "../data/app-resources-product-service";
import type { CatalogProductService } from "../data/catalog-product-service";
import type { ChangeProductService } from "../data/change-product-service";
import type { MapProductService } from "../data/map-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { ProductRunReportOverview, RunProductService } from "../data/run-product-service";
import type { LiveTargetSnapshot } from "../data/live-target-session";
import type { RunAcrossProductService } from "../data/run-across-product-service";
import type { Platform } from "../platform/types";
import "../styles/app.css";

type FixtureName =
  | "home-empty"
  | "apps-list"
  | "apps-error"
  | "app-versions"
  | "app-versions-error"
  | "app-accounts"
  | "app-accounts-error"
  | "prerecord-ready"
  | "prerecord-connecting"
  | "prerecord-failure"
  | "test-detail"
  | "runs-large"
  | "report-failed"
  | "report-evidence"
  | "batch-completed";

const FIXTURE_TIME = Date.UTC(2026, 8, 4, 12, 0, 0);
const fixture = new URLSearchParams(window.location.search).get("fixture") as FixtureName | null;
const definitions: Record<FixtureName, { path: string }> = {
  "home-empty": { path: "/home" },
  "apps-list": { path: "/apps" },
  "apps-error": { path: "/apps" },
  "app-versions": { path: "/apps/checkout-app/versions" },
  "app-versions-error": { path: "/apps/checkout-app/versions" },
  "app-accounts": { path: "/apps/checkout-app/accounts" },
  "app-accounts-error": { path: "/apps/checkout-app/accounts" },
  "prerecord-ready": { path: "/tests/new?app=checkout-app" },
  "prerecord-connecting": { path: "/tests/new?app=checkout-app" },
  "prerecord-failure": { path: "/tests/new?app=checkout-app" },
  "test-detail": { path: "/tests/test-checkout" },
  "runs-large": { path: "/runs?view=all" },
  "report-failed": { path: "/runs/run-checkout" },
  "report-evidence": { path: "/runs/run-checkout?view=evidence" },
  "batch-completed": { path: "/batches/batch-checkout" },
};
if (!fixture || !definitions[fixture]) throw new TypeError(`Unknown visual fixture: ${fixture}`);

const platform: Platform = {
  platform: "web",
  getServerUrl: () => "http://visual-fixture.invalid",
  storage: {
    get: () => null,
    set: () => undefined,
    remove: () => undefined,
  },
};

const apps = [{ id: "checkout-app", name: "Checkout" }] as const;
const prerecord = fixture.startsWith("prerecord-");
const previewTarget = {
  kind: "browser" as const,
  platform: "browser" as const,
  targetId: "checkout-browser",
};
const recordingService = {
  listApps: async () => {
    if (fixture === "apps-error") throw new Error("Relay is offline");
    return fixture === "home-empty" ? [] : apps;
  },
  connect: async () => ({
    status: "target-selection" as const,
    targets: prerecord ? [previewTarget] : [],
  }),
  presentTargets: async () =>
    prerecord
      ? [{ ...previewTarget, name: "Checkout browser", detail: "Managed browser · Ready" }]
      : [],
  inspect: async () => ({ status: "idle" as const, targets: [] }),
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
      mount() {
        if (fixture === "prerecord-ready") {
          current = { status: "streaming", target: previewTarget };
          for (const listener of listeners) listener(current);
        }
        return () => undefined;
      },
      input: async () => undefined,
      close: () => undefined,
    };
  },
} as unknown as RecordingProductService;

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
    fixture === "apps-list"
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
    fixture === "runs-large" ? largeRuns : fixture === "apps-list" ? [fixtureRun(0)] : [],
  getRun: async () => undefined,
};
const mapService: MapProductService = {
  get: async (appMapId) => ({
    appMapId,
    appName: "Checkout",
    revision: 4,
    screens: [],
    paths: [],
    coverage: {
      screenCount: 0,
      coveredScreenCount: 0,
      pathCount: 0,
      coveredPathCount: 0,
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
const changeService = {
  list: async () => [],
} as unknown as ChangeProductService;

const failedReport: ProductRunReportOverview = {
  runId: "run-checkout",
  testId: "test-checkout",
  title: "Complete checkout",
  outcome: "harness-failure",
  targetName: "Golden Chromium",
  durationMs: 12_480,
  category: "Browser connection",
  cause:
    "page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173/checkout\nCall log:\n  - navigating to the saved app address, waiting until load",
  firstEvidence: {
    label: "Order confirmation was missing",
    detail:
      "Relay reached the final checkout step, but the saved confirmation text was not visible.",
  },
  timeline: [
    {
      id: "open-cart",
      index: 0,
      title: "Open the cart",
      state: "passed",
      durationMs: 1_100,
      evidenceCount: 1,
    },
    {
      id: "submit-order",
      index: 1,
      title: "Submit the order",
      state: "passed",
      durationMs: 2_240,
      evidenceCount: 1,
    },
    {
      id: "confirmation",
      index: 2,
      title: "Check the order confirmation",
      state: "failed",
      durationMs: 9_140,
      evidenceCount: 2,
    },
  ],
  evidence: [
    {
      id: "screenshot",
      label: "Screenshots",
      count: 4,
      detail: "4 screenshots",
      summary: "See the screens Relay captured while this Test ran.",
      inspectable: true,
      items: [
        { id: "cart", title: "Cart ready" },
        { id: "checkout", title: "Checkout submitted" },
        {
          id: "missing",
          title: "Confirmation missing",
          tone: "critical",
          media: {
            kind: "image",
            src: "/src/visual-fixtures/checkout-observed.svg",
            width: 320,
            height: 200,
          },
        },
      ],
    },
    {
      id: "logs",
      label: "Logs",
      count: 1,
      detail: "1 log message",
      summary: "Review the app and system messages captured during this Run.",
      inspectable: true,
      items: [{ id: "log", title: "Checkout completed without confirmation", tone: "warning" }],
    },
  ],
};
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
const runService = {
  getTest: async () => (fixture === "test-detail" ? fixtureTest : undefined),
  listTestRuns: async () => (fixture === "test-detail" ? [fixtureRun(0), fixtureRun(1)] : []),
  listTargets: async () =>
    fixture === "test-detail"
      ? [
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
        ]
      : [],
  getReport: async () => failedReport,
  getRawEvidence: async () => ({ redacted: true, events: [] }),
} as unknown as RunProductService;

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
  navigation: { route: "/batches/:batchId", href: "/batches/batch-checkout" },
  report: {
    headline: "5 of 6 cases passed",
    detail: "One saved account needs review. Every completed case has its own durable Report.",
  },
};
const runAcrossService = {
  getReport: async () => batchReport,
  exportReport: async () => ({
    ...batchReport,
    export: { rootDir: "/relay/exports/batch-checkout", jobIds: [...batchReport.runIds] },
  }),
} as unknown as RunAcrossProductService;

document.documentElement.dataset.visualFixture = fixture;
const root = document.getElementById("root");
if (!root) throw new TypeError("Visual fixture root is missing");
createRoot(root).render(
  <StrictMode>
    <RelayV2App
      platform={platform}
      history={createMemoryHistory({ initialEntries: [definitions[fixture].path] })}
      productService={recordingService}
      appResourcesService={appResourcesService}
      catalogService={catalogService}
      mapService={mapService}
      changeService={changeService}
      runService={runService}
      runAcrossService={runAcrossService}
    />
  </StrictMode>,
);
