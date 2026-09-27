/** @jsxImportSource react */
import type { ProductChange } from "@relay/product/change-journey";
import type { ProductRunSummary, ProductTestSummary } from "@relay/product/catalog";
import type { ProductTestSummary as RunTestSummary } from "../data/run-product-service";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RelayV2App } from "../app";
import type { CatalogProductService } from "../data/catalog-product-service";
import type { ChangeProductService } from "../data/change-product-service";
import type { DeviceProductService, ProductDevice } from "../data/device-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { RunProductService } from "../data/run-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

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

function recording(): RecordingProductService {
  return {
    listApps: async () => [],
    connect: async () => ({ status: "idle", targets: [] }),
    presentTargets: async () => [],
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
  runs: readonly ProductRunSummary[],
  tests: readonly ProductTestSummary[] = [],
  runsUnavailable = false,
  testsUnavailable = false,
  onRunsRead?: () => void,
): CatalogProductService {
  return {
    listTests: async () => {
      if (testsUnavailable) throw new Error("catalog unavailable");
      return tests;
    },
    getTest: async () => undefined,
    listRuns: async () => {
      onRunsRead?.();
      if (runsUnavailable) throw new Error("workspace unavailable");
      return runs;
    },
    getRun: async () => undefined,
  };
}

function changes(items: readonly ProductChange[]): ChangeProductService {
  const unsupported = async (): Promise<never> => {
    throw new Error("not used in shell overlay tests");
  };
  return {
    list: async () => items,
    open: unsupported,
    prepare: unsupported,
    approve: unsupported,
    run: unsupported,
    watch: unsupported,
    cancel: unsupported,
    rerunAffected: unsupported,
    resumeHumanEvidence: unsupported,
    retryPublication: unsupported,
  };
}

function productDevice(
  id: string,
  name: string,
  status: ProductDevice["status"],
  platform: ProductDevice["platform"],
): ProductDevice {
  return {
    id,
    name,
    serial: id,
    status,
    platform,
    kind: platform === "browser" ? "Managed browser" : "Physical device",
    runnable: status === "ready",
    device: {
      id,
      serial: id,
      name,
      platform,
      kind: platform === "browser" ? "Managed browser" : "Physical device",
      booted: true,
    },
  };
}

function devices(items: readonly ProductDevice[] = []): DeviceProductService {
  return {
    list: async () => items,
    get: async (deviceId) => items.find((device) => device.id === deviceId),
    actions: async () => [],
    recover: async () => {
      throw new Error("not used in shell overlay tests");
    },
  };
}

async function renderShell(input: {
  runs?: readonly ProductRunSummary[];
  tests?: readonly ProductTestSummary[];
  runsUnavailable?: boolean;
  testsUnavailable?: boolean;
  changes?: readonly ProductChange[];
  devices?: readonly ProductDevice[];
  onRunsRead?: () => void;
  initialEntries?: string[];
  /** The saved Test a Run page reads for its return link. */
  test?: RunTestSummary;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const history = createMemoryHistory({ initialEntries: input.initialEntries ?? ["/home"] });
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayV2App
        platform={platform()}
        history={history}
        productService={recording()}
        runService={
          {
            getTest: async (testId: string) => (input.test?.id === testId ? input.test : undefined),
            listTargets: async () => [],
            restore: async () => undefined,
            inspectExecution: async () => null,
            getReport: async (runId: string) => ({
              runId,
              testId: "test-1",
              title: "Checkout result",
              timeline: [],
              evidence: [],
            }),
          } as unknown as RunProductService
        }
        catalogService={catalog(
          input.runs ?? [],
          input.tests ?? [],
          input.runsUnavailable,
          input.testsUnavailable,
          input.onRunsRead,
        )}
        changeService={changes(input.changes ?? [])}
        deviceService={devices(input.devices ?? [])}
      />,
    );
  });
  await settle();
  return history;
}

async function settle() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

describe("shell overlays", () => {
  it("keeps narrow-screen destinations reachable and preserves the app when switching collections", async () => {
    const history = await renderShell({ initialEntries: ["/tests?app=checkout"] });
    const navigation = document.querySelector('nav[aria-label="Main navigation"]')!;
    expect([...navigation.querySelectorAll("a")].map((link) => link.textContent)).toEqual([
      "Tests",
      "Runs",
    ]);
    expect(navigation.querySelector('[aria-current="page"]')?.textContent).toBe("Tests");
    expect(navigation.querySelector('button[aria-label="More navigation"]')).not.toBeNull();
    // Plans are groups on Tests now, so there is no separate Plans collection
    // link; the sidebar carries the App into Tests/Runs and its Map.
    expect(document.querySelector('a[href*="/suites"]')).toBeNull();
    const primary = document.querySelector('nav[aria-label="Primary"]')!;
    expect(primary.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe(
      "/tests?app=checkout",
    );
    expect(document.querySelector('nav[aria-label="App navigation"] a')?.getAttribute("href")).toBe(
      "/apps/checkout/map",
    );
    const runs = [...navigation.querySelectorAll("a")].find((link) => link.textContent === "Runs")!;
    await act(async () => runs.click());
    await settle();
    expect(history.location.pathname).toBe("/runs");
    expect(history.location.search).toContain("app=checkout");
    expect(navigation.querySelector('[aria-current="page"]')?.textContent).toBe("Runs");
  });

  it("orders the sidebar as Tests, Runs, Map, then Accounts and Devices, and moves Review, Activity, and Changes out", async () => {
    const history = await renderShell({ initialEntries: ["/tests"] });
    const sidebar = document.querySelector('[aria-label="Relay navigation"]')!;
    const labels = [...sidebar.querySelectorAll("a, button")]
      .map((item) => item.textContent?.trim())
      .filter((text) =>
        ["Tests", "Review", "Results", "Runs", "Map", "Accounts", "Devices"].includes(text ?? ""),
      );
    expect(labels).toEqual(["Tests", "Runs", "Map", "Accounts", "Devices"]);
    expect(sidebar.querySelector('[aria-label="Setup"] a[href="/accounts"]')).not.toBeNull();
    expect(sidebar.querySelector('a[href="/review"]')).toBeNull();
    expect(sidebar.querySelector('a[href="/sessions"]')).toBeNull();
    expect(sidebar.querySelector('a[href="/changes"]')).toBeNull();
    expect(sidebar.textContent).not.toContain("Changes");

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
      );
    });
    await settle();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search commands"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Changes");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    const changesCommand = [
      ...document.querySelectorAll<HTMLElement>(
        '[role="listbox"][aria-label="Commands"] [role="option"]',
      ),
    ].find((option) => option.textContent?.includes("Changes"));
    expect(changesCommand).toBeTruthy();
    await act(async () => changesCommand!.click());
    await settle();
    expect(history.location.pathname).toBe("/changes");
  });

  it("shows running work and links to full Activity", async () => {
    const run: ProductRunSummary = {
      id: "run-server",
      title: "Checkout",
      action: "test",
      status: "running",
      phase: "running",
      testName: "Checkout",
      targetName: "Managed Chromium",
      queuedAt: Date.now(),
      identity: { runId: "run-server" },
      links: { self: "/runs/run-server" },
    };
    const change: ProductChange = {
      id: "change-server",
      version: 1,
      status: "running",
      repository: "relay",
      title: "Verify checkout change",
      baseRevision: "base",
      requestedRevision: "head",
      runs: [],
      evidenceCount: 0,
      coverageGaps: [],
      residualRisk: [],
      affectedTestCount: 1,
      requiredVerificationCount: 1,
      advisoryVerificationCount: 0,
      updatedAt: Date.now(),
    };
    const history = await renderShell({ runs: [run], changes: [change] });

    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label^="Open running work"]',
    );
    expect(trigger).toBeTruthy();
    // The global badge is live before opening the center, so closed Activity
    // still communicates work that needs attention.
    expect(trigger?.getAttribute("aria-label")).toMatch(/2 active/);
    expect(trigger?.textContent).toBe("2 running");
    await act(async () => trigger?.click());
    await settle();

    expect(document.body.textContent).toContain("Checkout");
    expect(document.body.textContent).toContain("Verify checkout change");
    expect(document.body.textContent).toContain("Verifying");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Running now");
    const activityLink = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.textContent === "View all activity",
    );
    expect(activityLink).toBeTruthy();
    await act(async () => activityLink?.click());
    await settle();
    expect(history.location.pathname).toBe("/sessions");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the top bar quiet while nothing is running", async () => {
    await renderShell({});
    expect(document.querySelector('button[aria-label^="Open running work"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Running now");
  });

  it("marks closed Activity unavailable and offers an in-place retry", async () => {
    let reads = 0;
    await renderShell({
      runsUnavailable: true,
      onRunsRead: () => {
        reads += 1;
      },
    });

    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label^="Open running work"]',
    );
    expect(trigger?.getAttribute("aria-label")).toContain("unavailable");
    await act(async () => trigger?.click());
    await settle();

    expect(document.body.textContent).toContain("Couldn’t load running work");
    const retry = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Try again"),
    );
    expect(retry).toBeTruthy();
    const before = reads;
    await act(async () => retry?.click());
    await settle();
    expect(reads).toBeGreaterThan(before);
    expect(document.body.textContent).toContain("Couldn’t load running work");
  });

  it("opens the command palette with the keyboard, searches, and navigates", async () => {
    const history = await renderShell({});

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    await settle();

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search commands"]');
    expect(input).toBeTruthy();
    expect(input?.className).toContain("bg-transparent");
    expect(input?.className).not.toContain("border-input");
    expect(input?.getAttribute("role")).toBe("combobox");
    expect(input?.getAttribute("aria-controls")).toBe("command-results");
    expect(input?.getAttribute("aria-autocomplete")).toBe("list");
    expect(input?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "failed");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    const results = document.querySelector('[role="listbox"][aria-label="Commands"]');
    expect(results?.textContent).toContain("Review failed Runs");
    expect(results?.textContent).not.toContain("Open Home");

    await act(async () => {
      const failedRuns = [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Review failed Runs"),
      );
      failedRuns?.click();
    });
    await settle();
    expect(history.location.pathname).toBe("/runs");
    expect(history.location.search).toBe("?view=failed");
  });

  it("searches tests beyond the first thirty catalog entries", async () => {
    const tests = Array.from({ length: 31 }, (_, index): ProductTestSummary => ({
      id: `test-${index + 1}`,
      name: index === 30 ? "Thirty-first checkout" : `Checkout ${index + 1}`,
      appMapId: "app-1",
      appName: "Checkout",
      stepCount: 2,
      status: "ready",
      updatedAt: Date.now() - index,
      href: `/tests/test-${index + 1}`,
    }));
    await renderShell({ tests });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
      );
    });
    await settle();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search commands"]');
    expect(input).toBeTruthy();
    await act(async () => {
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Thirty-first");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(
      document.querySelector('[role="listbox"][aria-label="Commands"]')?.textContent,
    ).toContain("Thirty-first checkout");
  });

  it("reports unavailable test search instead of claiming there are no matches", async () => {
    await renderShell({ testsUnavailable: true });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
      );
    });
    await settle();
    expect(document.body.textContent).toContain("Test search is unavailable");
    expect(document.body.textContent).not.toContain("No matching commands");
    expect(document.body.textContent).toContain("Open Tests");
    expect(document.querySelector('button[type="button"]')?.textContent).not.toBeUndefined();
  });

  it("selects a command with the keyboard", async () => {
    const history = await renderShell({});
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
      );
    });
    await settle();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search commands"]');
    expect(input).toBeTruthy();
    await act(async () => {
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Manage versions");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(history.location.pathname).toBe("/versions");
  });
  it("wraps keyboard selection and returns focus when Escape closes the palette", async () => {
    await renderShell({});
    const trigger = document.querySelector<HTMLButtonElement>(
      '[aria-label="Open command palette"]',
    );
    expect(trigger).toBeTruthy();
    trigger!.focus();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
      );
    });
    await settle();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search commands"]')!;
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.length).toBeGreaterThan(1);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    expect(input.getAttribute("aria-activedescendant")).toBe(options.at(-1)!.id);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(document.querySelector('input[aria-label="Search commands"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it.each([
    ["Tests", ["/tests", "/runs/run-1"], "/tests", ""],
    [
      "filtered history",
      ["/runs?view=failed&q=checkout", "/runs/run-1"],
      "/runs",
      "?view=failed&q=checkout",
    ],
    ["Test", ["/tests/test-1", "/runs/run-1"], "/tests/test-1", ""],
    ["fresh deep link", ["/runs/run-1"], "/runs", ""],
  ])("returns from a Report through %s with global Back", async (_label, entries, path, search) => {
    const history = await renderShell({ initialEntries: entries as string[] });
    const back = document.querySelector<HTMLButtonElement>('[aria-label="Go back"]');
    expect(back?.disabled).toBe(false);
    await act(async () => back!.click());
    await settle();
    expect(history.location.pathname).toBe(path);
    expect(history.location.search).toBe(search);
  });

  it("the Test link on a Run opens the Test without substituting browser Back", async () => {
    const history = await renderShell({
      initialEntries: ["/tests", "/runs/run-1"],
      test: {
        id: "test-1",
        name: "Checkout",
        appMapId: "checkout",
        appName: "Checkout",
        stepCount: 0,
      },
    });
    const link = [...document.querySelectorAll<HTMLAnchorElement>("main a")].find((item) =>
      item.textContent?.includes("Checkout"),
    );
    expect(link?.getAttribute("href")).toBe("/tests/test-1");
    await act(async () => link!.click());
    await settle();
    expect(history.location.pathname).toBe("/tests/test-1");
  });

  it("keeps App map visible without app context and opens its picker in place", async () => {
    const history = await renderShell({});
    const originalPath = history.location.pathname;
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="App map"]');
    expect(trigger).not.toBeNull();
    await act(async () => trigger!.click());
    await settle();
    expect(history.location.pathname).toBe(originalPath);
    expect(document.querySelector('[role="menu"]')?.textContent).toContain("Choose an app to map");
    expect(document.querySelector('[role="menu"]')?.textContent).toContain("Add an app");
  });

  it("collapses stopped simulators and keeps the picker compact", async () => {
    const stopped = Array.from({ length: 38 }, (_, index) => ({
      ...productDevice(`sim-${index}`, `iPad ${index}`, "needs-attention", "ios"),
      device: {
        ...productDevice(`sim-${index}`, `iPad ${index}`, "needs-attention", "ios").device,
        booted: false,
      },
      kind: "simulator",
      osVersion: "18.5",
    }));
    await renderShell({
      devices: [
        { ...productDevice("phone", "My phone", "ready", "android"), osVersion: "16" },
        ...stopped,
      ],
    });
    const trigger = document.querySelector<HTMLButtonElement>('[aria-label^="Device or browser"]')!;
    await act(async () => trigger.click());
    await settle();
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu.textContent).toContain("My phone");
    expect(menu.textContent).toContain("Android 16");
    expect(menu.textContent).toContain("38");
    expect(menu.textContent).not.toContain("stopped");
    expect(menu.textContent).not.toContain("iPad 0");
    expect(menu.textContent).not.toContain("Needs attention");
    expect(menu.textContent).toContain("Check again");
    expect(menu.querySelectorAll('[role="menuitem"]').length).toBeLessThan(8);
  });

  it("keeps the run destination in the toolbar instead of the workspace sidebar", async () => {
    const history = await renderShell({
      devices: [
        productDevice("ipad", "Design iPad", "ready", "ios"),
        productDevice("browser", "Checkout browser", "virtual", "browser"),
      ],
    });

    // Devices is setup: under the everyday links, outside the Primary nav.
    expect(document.querySelector('nav[aria-label="Primary"] a[href="/devices"]')).toBeNull();
    expect(document.querySelector('[aria-label="Setup"] a[href="/devices"]')).not.toBeNull();
    const trigger = document.querySelector<HTMLButtonElement>('[aria-label^="Device or browser"]');
    expect(trigger?.textContent).toContain("2 devices");
    await act(async () => trigger?.click());
    await settle();

    expect(document.body.textContent).toContain("Design iPad");
    expect(document.body.textContent).toContain("Checkout browser");
    const deviceItem = [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
      item.textContent?.includes("Design iPad"),
    );
    await act(async () => deviceItem?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();
    expect(history.location.pathname).not.toBe("/devices/ipad");
    expect(history.location.pathname).not.toBe("/environments/ipad");
    await act(async () => trigger?.click());
    await settle();
    const manage = [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
      item.textContent?.includes("Manage devices"),
    );
    expect(manage).toBeTruthy();
    await act(async () => manage?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();
    expect(history.location.pathname).toBe("/devices");
  });
});
