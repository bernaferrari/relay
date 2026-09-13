/** @jsxImportSource react */
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayV2App } from "../app";
import type { RunAcrossProductService } from "../data/run-across-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];

const report = {
  id: "batch-1",
  title: "Languages",
  status: "completed-with-problems",
  createdAt: 1,
  updatedAt: 2,
  totalCases: 2,
  completedCases: 2,
  passedCases: 0,
  failedCases: 2,
  pendingCases: 0,
  targetNames: ["Firefox"],
  runIds: ["run-1", "run-2"],
  cases: [
    {
      id: "login-ios",
      index: 0,
      phase: "coverage" as const,
      status: "failed" as const,
      values: {},
      runId: "run-1",
      identity: {
        testId: "login",
        environmentId: "iphone-15",
        environmentPlatform: "ios" as const,
        runId: "run-1",
      },
    },
    {
      id: "checkout-ios",
      index: 1,
      phase: "coverage" as const,
      status: "failed" as const,
      values: {},
      runId: "run-2",
      identity: {
        testId: "checkout",
        environmentId: "iphone-15",
        environmentPlatform: "ios" as const,
        runId: "run-2",
      },
    },
  ],
  setup: {
    appMapId: "app-1",
    appMapRevision: 1,
    testId: "login",
    testName: "Login",
    appName: "Checkout",
    dataSet: { name: "Default", dimensions: [] },
  },
  navigation: { route: "/batches/batch-1", href: "/batches/batch-1" },
  report: { headline: "1 case needs attention", detail: "0 passed · 1 failed" },
};

function platform(): Platform {
  return {
    platform: "web",
    getServerUrl: () => "http://127.0.0.1:8787",
    getServerConnection: () => ({
      url: "http://127.0.0.1:8787",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:qa",
      actorKind: "human",
    }),
    storage: { get: () => null, set: () => undefined, remove: () => undefined },
  };
}

async function render(service: RunAcrossProductService) {
  const history = createMemoryHistory({ initialEntries: ["/batches/batch-1"] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayV2App
        platform={platform()}
        history={history}
        productService={{ listApps: async () => [] } as unknown as RecordingProductService}
        runAcrossService={service}
      />,
    );
  });
  for (let index = 0; index < 8; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

describe("Batch review controls", () => {
  it("still shows morning Findings copy when analysis is missing", async () => {
    await render({
      getReport: async () => report,
      getFailureClusters: async () => ({ campaignId: "batch-1", clusters: [] }),
      getFindings: async () => {
        throw new Error("Failed to fetch");
      },
    } as unknown as RunAcrossProductService);
    expect(document.body.textContent).toContain("No findings");
    expect(document.body.textContent).toContain(
      "rate-limit SOS, or a Cloudflare block is not a product pass",
    );
  });

  it("assigns the authenticated actor from the visible control, not the me placeholder", async () => {
    const triage = vi.fn(async () => report);
    await render({
      getReport: async () => report,
      getFailureClusters: async () => ({ campaignId: "batch-1", clusters: [] }),
      getFindings: async () => ({
        schemaVersion: 1,
        batchId: "batch-1",
        locales: ["en"],
        analysis: {
          schemaVersion: 1,
          sessionId: "s1",
          generatedAt: 1,
          baselineLocale: "en",
          findings: [],
          critical: 0,
          warnings: 0,
          affectedScreens: 0,
        },
        coverage: { frames: 0, inspectedFrames: 0 },
        cases: [],
      }),
      triage,
    } as unknown as RunAcrossProductService);

    const reviewStatus = document.querySelector('[aria-label="Review status"]');
    expect(reviewStatus).not.toBeNull();
    expect(reviewStatus).not.toBeInstanceOf(HTMLSelectElement);
    expect(document.body.textContent).toContain("No findings");
    expect(document.body.textContent).toContain(
      "rate-limit SOS, or a Cloudflare block is not a product pass",
    );
    expect(document.body.textContent).toContain("Check Sign-ins");
    expect(document.body.textContent).toContain("never accept a visual baseline");
    expect(document.body.textContent).toContain("Accept a baseline from a Report");
    expect(document.body.textContent).toContain("Assign to me");
    expect(document.body.textContent).toContain("Add note");
    const checkbox = document.querySelector<HTMLButtonElement>(
      '[role="checkbox"][aria-label="Select Default data"]',
    );
    if (!checkbox) throw new Error("Case checkbox not found");
    await act(async () => checkbox.click());
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
    const assign = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Assign to me",
    );
    if (!(assign instanceof HTMLButtonElement)) throw new Error("Assign to me not found");
    await act(async () => assign.click());
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
    expect(triage).toHaveBeenCalledTimes(1);
    expect(triage.mock.calls).toEqual([
      [
        "batch-1",
        {
          caseIds: [expect.stringMatching(/ios$/u)],
          assignee: "human:qa",
        },
      ],
    ]);
  });
});
