/** @jsxImportSource react */
import type { ProductRunSummary, ProductTestSummary } from "@relay/product/catalog";
import type { ProductChange } from "@relay/product/change-journey";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RelayV2App } from "../app";
import type { CatalogProductService } from "../data/catalog-product-service";
import type { ChangeProductService } from "../data/change-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { Platform } from "../platform/types";
import { homeAttentionRuns } from "../data/home-run-attention";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const target = { kind: "browser", platform: "browser", targetId: "browser-ready" } as const;

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

function platform(): Platform {
  return {
    platform: "web",
    getServerUrl: () => "http://127.0.0.1:8787",
    storage: { get: () => null, set: () => undefined, remove: () => undefined },
  };
}

function recording(apps: readonly { id: string; name: string }[]): RecordingProductService {
  return {
    listApps: async () => apps,
    connect: async () => ({ status: "target-selection", targets: apps.length ? [target] : [] }),
    presentTargets: async (targets) =>
      targets.map((item) => ({
        ...item,
        name: "Managed Chromium",
        detail: "Browser · Ready",
      })),
    begin: async () => ({ status: "idle", targets: [] }),
    inspect: async () => ({ status: "idle", targets: [] }),
    getOptimization: async () => ({ proposal: null }),
    getEvidencePreview: async () => null,
    recordCurrent: async () => ({ status: "idle", targets: [] }),
    checkpoint: async () => ({ status: "idle", targets: [] }),
    stop: async () => ({ status: "idle", targets: [] }),
    edit: async () => ({ status: "idle", targets: [] }),
    replay: async () => ({ status: "idle", targets: [] }),
    approve: async () => ({ status: "idle", targets: [] }),
  };
}

function catalog(
  tests: readonly ProductTestSummary[],
  runs: readonly ProductRunSummary[],
): CatalogProductService {
  return {
    listTests: async () => tests,
    getTest: async () => undefined,
    listRuns: async () => runs,
    getRun: async () => undefined,
  };
}

function changes(items: readonly ProductChange[]): ChangeProductService {
  return {
    list: async () => items,
    open: async () => {
      throw new Error("not used");
    },
    prepare: async () => {
      throw new Error("not used");
    },
    approve: async () => {
      throw new Error("not used");
    },
    run: async () => {
      throw new Error("not used");
    },
    watch: async () => {
      throw new Error("not used");
    },
    cancel: async () => {
      throw new Error("not used");
    },
    rerunAffected: async () => {
      throw new Error("not used");
    },
    resumeHumanEvidence: async () => {
      throw new Error("not used");
    },
    retryPublication: async () => {
      throw new Error("not used");
    },
  };
}

async function renderHome(input: {
  apps?: readonly { id: string; name: string }[];
  tests?: readonly ProductTestSummary[];
  runs?: readonly ProductRunSummary[];
  changes?: readonly ProductChange[];
  productService?: RecordingProductService;
  catalogService?: CatalogProductService;
  changeService?: ChangeProductService;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayV2App
        platform={platform()}
        history={createMemoryHistory({ initialEntries: ["/home"] })}
        productService={input.productService ?? recording(input.apps ?? [])}
        catalogService={input.catalogService ?? catalog(input.tests ?? [], input.runs ?? [])}
        changeService={input.changeService ?? changes(input.changes ?? [])}
      />,
    );
  });
  for (let index = 0; index < 5; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

describe("Home", () => {
  it("keeps a failed device result when a later pass used another execution configuration", () => {
    const base = {
      title: "Pay",
      action: "test",
      appMapId: "app",
      testId: "test",
      identity: { runId: "x", appMapId: "app", testId: "test" },
      links: { self: "/runs/x" },
    } as const;
    const failed: ProductRunSummary = {
      ...base,
      id: "android-failed",
      status: "failed",
      phase: "failed",
      outcome: "product-failure",
      queuedAt: 10,
      executionIdentity: {
        appMapId: "app",
        testId: "test",
        appMapRevision: 4,
        buildId: "build-1",
        platform: "android",
        deviceId: "pixel-1",
      },
    };
    const passed: ProductRunSummary = {
      ...base,
      id: "ios-passed",
      status: "completed",
      phase: "completed",
      outcome: "passed",
      queuedAt: 20,
      executionIdentity: {
        appMapId: "app",
        testId: "test",
        appMapRevision: 4,
        buildId: "build-1",
        platform: "ios",
        deviceId: "ipad-1",
      },
    };

    expect(homeAttentionRuns([failed, passed]).map((run) => run.id)).toEqual(["android-failed"]);
  });

  it("does not let queued, cancelled, or unknown runs erase an actionable failure", () => {
    const identity = {
      appMapId: "app",
      testId: "test",
      appMapRevision: 4,
      buildId: "build-1",
      platform: "android",
      deviceId: "pixel-1",
    } as const;
    const run = (id: string, phase: ProductRunSummary["phase"], at: number): ProductRunSummary => ({
      id,
      title: "Pay",
      action: "test",
      status: phase,
      phase,
      ...(phase === "failed" ? { outcome: "harness-failure" as const } : {}),
      queuedAt: at,
      testId: "test",
      appMapId: "app",
      identity: { runId: id, appMapId: "app", testId: "test" },
      executionIdentity: phase === "cancelled" ? undefined : identity,
      links: { self: `/runs/${id}` },
    });

    expect(
      homeAttentionRuns([run("failed", "failed", 10), run("queued", "queued", 20)]),
    ).toHaveLength(1);
    expect(
      homeAttentionRuns([run("failed", "failed", 10), run("cancelled", "cancelled", 20)]),
    ).toHaveLength(1);
    expect(
      homeAttentionRuns([
        run("failed", "failed", 10),
        { ...run("passed", "completed", 20), outcome: "passed", executionIdentity: undefined },
      ]),
    ).toHaveLength(1);
  });

  it("resolves a failure only after a later pass of the same frozen execution", () => {
    const identity = {
      appMapId: "app",
      testId: "test",
      appMapRevision: 4,
      buildId: "build-1",
      targetProfileId: "profile-1",
      platform: "android",
      deviceId: "pixel-1",
    } as const;
    const run = (id: string, phase: ProductRunSummary["phase"], at: number): ProductRunSummary => ({
      id,
      title: "Pay",
      action: "test",
      status: phase,
      phase,
      ...(phase === "failed"
        ? { outcome: "harness-failure" as const }
        : { outcome: "passed" as const }),
      queuedAt: at,
      testId: "test",
      appMapId: "app",
      identity: { runId: id, appMapId: "app", testId: "test" },
      executionIdentity: identity,
      links: { self: `/runs/${id}` },
    });

    expect(
      homeAttentionRuns([run("failed", "failed", 10), run("passed", "completed", 20)]),
    ).toEqual([]);
  });

  it("keeps failures when target or ordering evidence is unresolved", () => {
    const base: ProductRunSummary = {
      id: "failed",
      title: "Pay",
      action: "test",
      status: "failed",
      phase: "failed",
      outcome: "product-failure",
      queuedAt: 10,
      appMapId: "app",
      testId: "test",
      identity: { runId: "failed", appMapId: "app", testId: "test" },
      executionIdentity: {
        appMapId: "app",
        testId: "test",
        appMapRevision: 4,
        platform: "android",
        deviceId: "pixel-1",
      },
      links: { self: "/runs/failed" },
    };
    const samePlatformUnknownTarget: ProductRunSummary = {
      ...base,
      id: "passed",
      status: "completed",
      phase: "completed",
      outcome: "passed",
      queuedAt: 20,
      executionIdentity: {
        appMapId: "app",
        testId: "test",
        appMapRevision: 4,
        platform: "android",
      },
    };
    expect(homeAttentionRuns([base, samePlatformUnknownTarget])).toHaveLength(1);

    const equalTimestampPass = {
      ...samePlatformUnknownTarget,
      queuedAt: 10,
      executionIdentity: base.executionIdentity,
    };
    expect(homeAttentionRuns([base, equalTimestampPass])).toHaveLength(1);
  });

  it("keeps failures when a later pass omits saved data or account identity", () => {
    const failed: ProductRunSummary = {
      id: "failed-config",
      title: "Pay",
      action: "test",
      status: "failed",
      phase: "failed",
      outcome: "product-failure",
      queuedAt: 10,
      appMapId: "app",
      testId: "test",
      identity: { runId: "failed-config", appMapId: "app", testId: "test" },
      executionIdentity: {
        appMapId: "app",
        testId: "test",
        appMapRevision: 4,
        platform: "browser",
        targetProfileId: "checkout",
        dataSetId: "member",
        accountId: "signed-in",
      },
      links: { self: "/runs/failed-config" },
    };
    const passWithoutConfig: ProductRunSummary = {
      ...failed,
      id: "passed-unknown-config",
      status: "completed",
      phase: "completed",
      outcome: "passed",
      queuedAt: 20,
      identity: { runId: "passed-unknown-config", appMapId: "app", testId: "test" },
      executionIdentity: {
        appMapId: "app",
        testId: "test",
        appMapRevision: 4,
        platform: "browser",
        targetProfileId: "checkout",
      },
      links: { self: "/runs/passed-unknown-config" },
    };
    expect(homeAttentionRuns([failed, passWithoutConfig]).map((run) => run.id)).toEqual([
      "failed-config",
    ]);
  });

  it("teaches one direct first action only for a truly empty workspace", async () => {
    await renderHome({});

    expect(document.body.textContent).toContain("Prove one journey that matters");
    expect(document.body.textContent).toContain("Add the app you want to verify");
    expect(
      [...document.querySelectorAll('a[href="/apps"]')].some((link) =>
        link.textContent?.includes("Add an App"),
      ),
    ).toBe(true);
    expect(document.body.textContent).not.toContain("Latest results");
  });

  it("turns a populated workspace into current work and recent evidence", async () => {
    const now = Date.now();
    const run: ProductRunSummary = {
      id: "run-private",
      title: "Arabic settings",
      action: "test",
      status: "completed",
      phase: "completed",
      outcome: "passed",
      testName: "Arabic settings",
      appName: "Settings",
      targetName: "Managed Chromium",
      queuedAt: now - 4_000,
      finishedAt: now - 2_000,
      identity: { runId: "run-private", testId: "test-private", appMapId: "app-private" },
      links: { self: "/runs/run-private" },
    };
    const test: ProductTestSummary = {
      id: "test-private",
      name: "Arabic settings",
      appMapId: "app-private",
      appName: "Settings",
      stepCount: 4,
      status: "ready",
      updatedAt: now - 3_000,
      href: "/tests/test-private",
      recentRun: run,
    };
    const change: ProductChange = {
      id: "change-private",
      version: 2,
      status: "ready",
      repository: "acme/settings",
      title: "Keep Arabic settings readable",
      baseRevision: "a".repeat(40),
      requestedRevision: "b".repeat(40),
      runs: [],
      evidenceCount: 0,
      coverageGaps: [],
      residualRisk: [],
      affectedTestCount: 1,
      requiredVerificationCount: 1,
      advisoryVerificationCount: 0,
      updatedAt: now,
    };

    await renderHome({
      apps: [{ id: "app-private", name: "Settings" }],
      tests: [test],
      runs: [run],
      changes: [change],
    });

    expect(document.body.textContent).toContain("Your workspace");
    expect(document.body.textContent).toContain("Keep Arabic settings readable");
    expect(document.body.textContent).toContain("Continue verification");
    expect(document.body.textContent).toContain("1 device ready");
    expect(document.body.textContent).toContain("Latest results");
    expect(document.body.textContent).toContain("Managed Chromium");
    expect(document.body.textContent).not.toContain("Start with one journey");
  });
  it("prioritizes an unsuccessful latest result over a saved test", async () => {
    const now = Date.now();
    await renderHome({
      apps: [{ id: "app", name: "Checkout" }],
      tests: [
        {
          id: "test",
          name: "Pay",
          appMapId: "app",
          appName: "Checkout",
          stepCount: 2,
          status: "needs-review",
          updatedAt: now,
          href: "/tests/test",
        },
      ],
      runs: [
        {
          id: "failed",
          testId: "test",
          title: "Payment failed",
          action: "Inspect",
          status: "failed",
          phase: "failed",
          outcome: "product-failure",
          appMapId: "app",
          queuedAt: now,
          identity: { runId: "failed", testId: "test" },
          links: { self: "/runs/failed" },
        },
      ],
    });
    expect(document.querySelector("#home-next-title")?.textContent).toBe("Payment failed");
    expect(document.body.textContent).toContain("1 result needs attention");
    expect(document.body.textContent).not.toContain("Ready to run");
    expect(document.querySelector("[data-page-pattern]")).toHaveProperty(
      "dataset.pagePattern",
      "library",
    );
  });

  it("lists every result that still needs attention", async () => {
    const now = Date.now();
    const failed = (
      id: string,
      title: string,
      targetName: string,
      at: number,
    ): ProductRunSummary => ({
      id,
      title,
      testName: title,
      action: "Inspect",
      status: "failed",
      phase: "failed",
      outcome: "product-failure",
      appMapId: "app",
      testId: id,
      targetName,
      queuedAt: at,
      identity: { runId: id, testId: id, appMapId: "app" },
      executionIdentity: { appMapId: "app", testId: id, deviceId: targetName },
      links: { self: `/runs/${id}` },
    });
    await renderHome({
      apps: [{ id: "app", name: "Checkout" }],
      tests: [
        {
          id: "pay",
          name: "Pay",
          appMapId: "app",
          appName: "Checkout",
          stepCount: 2,
          status: "ready",
          updatedAt: now,
          href: "/tests/pay",
        },
        {
          id: "login",
          name: "Sign in",
          appMapId: "app",
          appName: "Checkout",
          stepCount: 3,
          status: "ready",
          updatedAt: now - 1_000,
          href: "/tests/login",
        },
      ],
      runs: [
        failed("pay", "Pay", "Pixel 9", now),
        failed("login", "Sign in", "iPad Pro", now - 2_000),
      ],
    });
    expect(document.body.textContent).toContain("2 results need attention");
    expect(
      document.querySelector("[aria-label='Results that need attention']")?.textContent,
    ).toContain("Pay");
    expect(
      document.querySelector("[aria-label='Results that need attention']")?.textContent,
    ).toContain("Sign in");
    expect(
      document.querySelector("[aria-label='Results that need attention']")?.textContent,
    ).toContain("Pixel 9");
    expect(
      document.querySelector("[aria-label='Results that need attention']")?.textContent,
    ).toContain("iPad Pro");
  });

  it("keeps saved Tests and their action visible when Runs fail", async () => {
    const now = Date.now();
    const test: ProductTestSummary = {
      id: "test-runs-down",
      name: "Checkout",
      appMapId: "app",
      appName: "Shop",
      stepCount: 2,
      status: "ready",
      updatedAt: now,
      href: "/tests/test-runs-down",
    };
    const catalogService = catalog([test], []);
    catalogService.listRuns = async () => {
      throw new Error("runs unavailable");
    };

    await renderHome({ apps: [{ id: "app", name: "Shop" }], catalogService });

    expect(document.body.textContent).toContain("Checkout");
    expect(document.body.textContent).toContain("Record a Test");
    expect(document.body.textContent).toContain("Latest results are unavailable");
    expect(document.body.textContent).not.toContain("No results need attention");
  });

  it("keeps Runs visible when Changes fail", async () => {
    const now = Date.now();
    const run: ProductRunSummary = {
      id: "run-changes-down",
      title: "Checkout",
      action: "Inspect",
      status: "completed",
      phase: "completed",
      outcome: "passed",
      appMapId: "app",
      queuedAt: now,
      identity: { runId: "run-changes-down", appMapId: "app" },
      links: { self: "/runs/run-changes-down" },
    };
    const changeService = changes([]);
    changeService.list = async () => {
      throw new Error("changes unavailable");
    };

    await renderHome({ apps: [{ id: "app", name: "Shop" }], runs: [run], changeService });

    expect(document.body.textContent).toContain("Latest results");
    expect(document.body.textContent).toContain("Checkout");
    expect(document.body.textContent).toContain("Some workspace sections are unavailable");
  });

  it("keeps the primary recovery state when Apps fail", async () => {
    const productService = recording([]);
    productService.listApps = async () => {
      throw new Error("apps unavailable");
    };

    await renderHome({ productService });

    expect(document.body.textContent).toContain("Relay could not complete this request");
    expect(document.body.textContent).not.toContain("Add the app you want to verify");
  });
});
