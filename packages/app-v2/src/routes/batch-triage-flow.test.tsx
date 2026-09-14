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
  report: {
    headline: "1 case needs attention",
    detail: "0 passed · 1 failed",
    executionLine: "0 passed, 1 check failed",
    checksLine: "0 passed, 1 check failed",
    coverageLine: "0 of 1 planned cases verified",
  },
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
    expect(document.body.textContent).toContain("QA bug, not a pass");
    expect(document.body.textContent).toContain("must appear here as a finding");
    expect(document.body.textContent).not.toContain("No findings. Passing cases");
    expect(document.body.textContent).toContain("2 product issues to review");
    expect(document.body.textContent).toContain("product issues");
    expect(document.body.textContent).not.toContain("Execution");
    expect(document.body.textContent).not.toContain("31 of 33 planned cases");
    const workbench = [...document.querySelectorAll("a")].find((link) =>
      (link.getAttribute("href") || "").includes("/runs/run-1"),
    );
    expect(workbench?.getAttribute("href")).toContain("reportView=captures");
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
    expect(document.body.textContent).toContain("QA bug, not a pass");
    expect(document.body.textContent).toContain("must appear here as a finding");
    expect(document.body.textContent).not.toContain("No findings. Passing cases");
    expect(document.body.textContent).toContain("Check Sign-ins");
    expect(document.body.textContent).toContain("never accept a visual baseline");
    expect(document.body.textContent).toContain(
      "Review screenshots opens the Report and does not accept a baseline",
    );
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

  it("shows HARNESS_FAILURE for cancelled SOS cells instead of an empty Findings page", async () => {
    await render({
      getReport: async () => report,
      getFailureClusters: async () => ({ campaignId: "batch-1", clusters: [] }),
      getFindings: async () => ({
        schemaVersion: 1,
        batchId: "batch-1",
        locales: ["logged-out"],
        analysis: {
          schemaVersion: 1,
          sessionId: "s1",
          generatedAt: 1,
          baselineLocale: "logged-out",
          findings: [
            {
              id: "harness-failure-099e8094-8018-4d44-b00b-73d2290b2f3f",
              code: "HARNESS_FAILURE",
              severity: "critical",
              confidence: "high",
              canonicalKey: "job:099e8094-8018-4d44-b00b-73d2290b2f3f",
              screenLabel: "Toolbar on existing chat signed-in (no composer)",
              locale: "logged-out",
              baselineLocale: "logged-out",
              detail: "SOS: cold recovery blocked — expect-set missing toolbar",
            },
          ],
          critical: 1,
          warnings: 0,
          affectedScreens: 1,
        },
        coverage: { frames: 0, inspectedFrames: 0 },
        cases: [
          {
            jobId: "099e8094-8018-4d44-b00b-73d2290b2f3f",
            locale: "logged-out",
            status: "cancelled",
            frames: [],
          },
        ],
      }),
    } as unknown as RunAcrossProductService);
    expect(document.body.textContent).toContain("HARNESS_FAILURE");
    expect(document.body.textContent).toContain("finding to review");
    expect(document.body.textContent).not.toContain("No findings. Passing cases");
    expect(document.body.textContent).toContain("never accept a visual baseline");
    expect(document.body.textContent).toContain("Review screenshots");
    const review = [...document.querySelectorAll("a")].find(
      (link) => link.textContent?.trim() === "Review screenshots",
    );
    expect(review).toBeInstanceOf(HTMLAnchorElement);
    expect(review?.getAttribute("href")).toContain("/runs/099e8094-8018-4d44-b00b-73d2290b2f3f");
    expect(review?.getAttribute("href")).toContain("reportView=captures");
    const confirm = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Confirm",
    );
    const reject = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Reject",
    );
    expect(confirm).toBeInstanceOf(HTMLButtonElement);
    expect(reject).toBeInstanceOf(HTMLButtonElement);
    if (!(reject instanceof HTMLButtonElement)) throw new Error("Reject not found");
    expect(confirm?.className).not.toMatch(/bg-primary(?:\/|\s|$)/u);
    expect(reject.className).not.toMatch(/bg-primary(?:\/|\s|$)/u);
    expect(document.body.textContent).toContain("Proposed Reject");
    expect(document.body.textContent).toContain("Infra");
    expect(document.body.textContent).not.toContain("Recorded as a product issue");
    await act(async () => reject.click());
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
    expect(document.body.textContent).toContain("Rejected as not a product failure this run");
    expect(document.body.textContent).toContain("does not accept a new visual baseline");
    const recordedReject = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Reject",
    );
    expect(recordedReject?.getAttribute("aria-pressed")).toBe("true");
  });

  it("presents a same-failure cluster as a Findings group, not an engine dump", async () => {
    await render({
      getReport: async () => report,
      getFailureClusters: async () => ({
        campaignId: "batch-1",
        clusters: [
          {
            id: "cluster-1",
            kind: "causal",
            signature: {
              kind: "causal",
              digest: `sha256:${"a".repeat(64)}`,
              summary: "causal failure",
              checkIds: [],
            },
            environmentId: "browser:grok-com-1280x800-339a5a430a41",
            representativeCaseId: "login-ios",
            representativeRunId: "run-1",
            caseIds: ["login-ios", "checkout-ios"],
          },
        ],
      }),
      getFindings: async () => {
        throw new Error("Failed to fetch");
      },
    } as unknown as RunAcrossProductService);
    expect(document.body.textContent).toContain("Same failure");
    expect(document.body.textContent).toContain("1 group");
    expect(document.body.textContent).not.toContain("1 groups");
    expect(document.body.textContent).toContain("Product behavior");
    expect(document.body.textContent).toContain("2 cases · grok-com");
    expect(document.body.textContent).not.toContain("causal failure");
    expect(document.body.textContent).not.toContain("339a5a430a41");
    const reportLink = [...document.querySelectorAll("a")].find(
      (link) => link.textContent?.trim() === "Report",
    );
    expect(reportLink?.getAttribute("href")).toContain("/runs/run-1");
    expect(reportLink?.getAttribute("href")).toContain("reportView=captures");
  });

  it("reviews typed cell Findings when analysis is missing", async () => {
    await render({
      getReport: async () => ({
        ...report,
        cases: [
          {
            ...report.cases[0]!,
            status: "cancelled" as const,
            findingCode: "HARNESS_FAILURE" as const,
            error: "Cancelled by user",
          },
          report.cases[1]!,
        ],
      }),
      getFailureClusters: async () => ({ campaignId: "batch-1", clusters: [] }),
      getFindings: async () => {
        throw new Error("Failed to fetch");
      },
    } as unknown as RunAcrossProductService);
    expect(document.body.textContent).toContain("HARNESS_FAILURE");
    expect(document.body.textContent).toContain("finding to review");
    expect(document.body.textContent).not.toContain("QA bug, not a pass");
    expect(document.body.textContent).toContain("never accept a visual baseline");
    const confirm = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Confirm",
    );
    const reject = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Reject",
    );
    expect(confirm).toBeInstanceOf(HTMLButtonElement);
    expect(reject).toBeInstanceOf(HTMLButtonElement);
  });
});
