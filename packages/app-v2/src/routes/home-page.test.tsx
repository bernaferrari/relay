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
    recordCurrent: async () => ({ status: "idle", targets: [] }),
    checkpoint: async () => ({ status: "idle", targets: [] }),
    stop: async () => ({ status: "idle", targets: [] }),
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
        productService={recording(input.apps ?? [])}
        catalogService={catalog(input.tests ?? [], input.runs ?? [])}
        changeService={changes(input.changes ?? [])}
      />,
    );
  });
  for (let index = 0; index < 5; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

describe("Home", () => {
  it("teaches one direct first action only for a truly empty workspace", async () => {
    await renderHome({});

    expect(document.body.textContent).toContain("Prove one journey that matters");
    expect(document.body.textContent).toContain("Add the app you want to verify");
    expect(document.querySelector('a[href="/apps"]')?.textContent).toContain("Add an App");
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

    expect(document.body.textContent).toContain("Ready when you are");
    expect(document.body.textContent).toContain("Keep Arabic settings readable");
    expect(document.body.textContent).toContain("Continue verification");
    expect(document.body.textContent).toContain("1 target ready");
    expect(document.body.textContent).toContain("Latest results");
    expect(document.body.textContent).toContain("Managed Chromium");
    expect(document.body.textContent).not.toContain("Start with one journey");
  });
});
