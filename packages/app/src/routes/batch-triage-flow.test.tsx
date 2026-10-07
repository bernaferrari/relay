/** @jsxImportSource react */
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelayApp } from "../app";
import type { RunAcrossProductService } from "../data/run-across-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { RunProductService } from "../data/run-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];

beforeEach(() => {
  // Product services own this fixture's reads. Unowned shell requests must
  // never reach the developer server or outlive the test DOM.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline test fixture")));
});

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

async function render(service: RunAcrossProductService, runService?: RunProductService) {
  const history = createMemoryHistory({ initialEntries: ["/batches/batch-1"] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayApp
        platform={platform()}
        history={history}
        productService={{ listApps: async () => [] } as unknown as RecordingProductService}
        runAcrossService={service}
        runService={runService}
      />,
    );
  });
  for (let index = 0; index < 8; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
  return history;
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Batch review controls", () => {
  it("opens and inspects the exact running Plan job before immutable evidence exists", async () => {
    const inspectExecution = vi.fn<NonNullable<RunProductService["inspectExecution"]>>(
      async (jobId) => ({
        status: "running",
        run: { jobId },
        snapshot: {
          schemaVersion: 1,
          kind: "run-test",
          title: "Live Plan case",
          phase: "running",
          version: "v1",
          progress: { label: "Checking the first prompt", completed: 0, total: 2 },
          allowedNextActions: ["inspect"],
          problems: [],
          evidenceRefs: [],
        },
      }),
    );
    await render(
      {
        getReport: async () => ({
          ...report,
          status: "running",
          runIds: [],
          completedCases: 0,
          cases: [
            {
              id: "prompt-one",
              index: 0,
              phase: "pilot",
              status: "running",
              values: {},
              jobId: "live-prompt-job",
              priorRunIds: ["earlier-prompt-run"],
            },
            { id: "prompt-two", index: 1, phase: "coverage", status: "pending", values: {} },
          ],
        }),
        getFailureClusters: async () => ({ campaignId: "batch-1", clusters: [] }),
        getFindings: async () => undefined,
      } as unknown as RunAcrossProductService,
      { inspectExecution } as unknown as RunProductService,
    );
    const checklist = document.querySelector('[aria-label="Plan run"]')!;
    expect([...checklist.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "/runs/live-prompt-job",
    ]);
    expect(inspectExecution).toHaveBeenCalledExactlyOnceWith("live-prompt-job");
    expect(document.body.textContent).toContain("Checking the first prompt");
    expect(document.body.textContent).not.toContain("stopped before a Run captured evidence");
    expect(document.querySelector('a[href*="earlier-prompt-run"]')).toBeNull();
    expect(
      [...document.querySelectorAll("a")].some(
        (link) => link.textContent?.trim() === "Walk through",
      ),
    ).toBe(false);
  });

  it.each([
    { status: "pending", message: "Waiting to start." },
    { status: "queued", message: "Waiting to start." },
    { status: "running", message: "Run in progress. Evidence will appear here as it is saved." },
    { status: "failed", message: "This case ended without saved Run evidence." },
  ] as const)(
    "shows truthful $status copy when a case has no inspection reference",
    async ({ status, message }) => {
      await render({
        getReport: async () => ({
          ...report,
          status: status === "failed" ? "completed-with-problems" : "running",
          runIds: [],
          cases: [{ id: "no-evidence", index: 0, phase: "pilot", status, values: {} }],
        }),
        getFailureClusters: async () => ({ campaignId: "batch-1", clusters: [] }),
        getFindings: async () => {
          throw new Error("Findings unavailable in this fixture");
        },
      } as unknown as RunAcrossProductService);
      expect(document.body.textContent).toContain(message);
      expect(document.body.textContent).not.toContain("stopped before a Run captured evidence");
      expect(document.querySelector('[aria-label="Plan run"] a')).toBeNull();
    },
  );

  it("does not attach an old Plan download to the next Plan", async () => {
    let finish!: (blob: Blob) => void;
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:old-plan");
    const getReport = vi.fn(async (id: string) => ({
      ...report,
      id,
      export: { jobIds: ["run-1"] },
    }));
    const history = await render({
      getReport,
      getFailureClusters: async () => ({ campaignId: "batch-1", clusters: [] }),
      getFindings: async () => undefined,
      downloadExport: () =>
        new Promise<Blob>((resolve) => {
          finish = resolve;
        }),
    } as unknown as RunAcrossProductService);
    const download = [...document.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("Download"),
    );
    expect(download).toBeDefined();
    await act(async () => download!.click());
    await act(async () => history.push("/batches/batch-2"));
    // Memory history changes before the new document has mounted. Resolve the
    // old download only once this fixture observes the next Plan's own read.
    await vi.waitFor(async () => {
      await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
      expect(getReport).toHaveBeenCalledWith("batch-2");
    });
    await act(async () => finish(new Blob(["old-plan"])));
    expect(createUrl).not.toHaveBeenCalled();
    expect(document.querySelector('a[href="blob:old-plan"]')).toBeNull();
    createUrl.mockRestore();
  });

  it("advances to the next unresolved case only after a successful review", async () => {
    const triage = vi.fn(async () => report);
    await render({
      getReport: async () => report,
      getFailureClusters: async () => ({ campaignId: "batch-1", clusters: [] }),
      getFindings: async () => undefined,
      triage,
    } as unknown as RunAcrossProductService);
    const resolve = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Mark resolved",
    );
    if (!resolve) throw new Error("Resolve action not found");
    await act(async () => resolve.click());
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
    expect(triage).toHaveBeenCalledWith("batch-1", {
      caseIds: ["login-ios"],
      triageStatus: "resolved",
    });
    expect(document.querySelector("h3")?.textContent).toContain("Case 2");
    expect(report.cases.every((item) => item.status === "failed")).toBe(true);
  });

  it("offers the affected case's rerun beside its failure evidence", async () => {
    const rerun = vi.fn(async () => report);
    await render({
      getReport: async () => report,
      getFailureClusters: async () => ({ campaignId: "batch-1", clusters: [] }),
      getFindings: async () => undefined,
      rerun,
    } as unknown as RunAcrossProductService);
    const button = [...document.querySelectorAll("button")].find(
      (item) => item.textContent === "Rerun this case",
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
    expect(rerun).toHaveBeenCalledWith("batch-1", { caseIds: ["login-ios"] });
  });

  it("opens the exact case behind a missing screenshot", async () => {
    await render({
      getReport: async () => report,
      getFailureClusters: async () => ({ campaignId: "batch-1", clusters: [] }),
      getFindings: async () => undefined,
      getCaptureReview: async () => ({
        items: [
          {
            runId: "run-2",
            executionCaseId: "checkout-ios",
            captureId: "checkout-missing",
            caption: "Checkout",
            status: "missing",
          },
        ],
        summary: {
          planned: 1,
          captured: 0,
          missing: 1,
          blocked: 0,
          pending: 0,
          accepted: 0,
          issue: 0,
          needMoreEvidence: 0,
        },
      }),
    } as unknown as RunAcrossProductService);
    const open = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Review affected cases"),
    );
    expect(open).toBeDefined();
    await act(async () => open?.click());
    expect(document.querySelector("h3")?.textContent).toContain("Case 2");
  });

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
    // Checklist rows open the Run; the findings report opens its screenshots.
    const workbench = [...document.querySelectorAll("a")].find(
      (link) => link.textContent === "Open full report",
    );
    expect(workbench?.getAttribute("href")).toBe("/runs/run-1?reportView=captures");
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
    expect(document.body.textContent).toContain("Check accounts");
    expect(document.body.textContent).toContain("never accept a visual baseline");
    expect(document.body.textContent).toContain(
      "Review screenshots opens the Report and does not accept a baseline",
    );
    expect(document.body.textContent).toContain("Assign to me");
    expect(document.body.textContent).toContain("Add note");
    const checkbox = document.querySelector<HTMLButtonElement>(
      '[role="checkbox"][aria-label="Select case 1"]',
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
    const groups = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Failure groups",
    );
    if (!groups) throw new Error("Failure groups not found");
    await act(async () => groups.click());
    expect(document.body.textContent).toContain("Same failure");
    expect(document.body.textContent).toContain("1 group");
    expect(document.body.textContent).toContain("Select a group to rerun");
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

  it("reviews Plan screenshots from the Batch page without accepting a baseline", async () => {
    const reviewCaptures = vi.fn(async () => ({
      queue: {
        items: [
          {
            captureId: "frames/001.png::aaa",
            caption: "Settings",
            status: "accepted" as const,
            runId: "run-1",
            framePath: "frames/001.png",
            imageSha256: "aaa",
            attempt: 1,
          },
        ],
        summary: {
          captured: 1,
          missing: 0,
          pending: 0,
          accepted: 1,
          issue: 0,
          needMoreEvidence: 0,
          planned: 1,
          blocked: 0,
        },
      },
      results: [{ runId: "run-1", captureId: "frames/001.png::aaa", status: "applied" as const }],
    }));
    await render({
      getReport: async () => report,
      getFailureClusters: async () => ({ campaignId: "batch-1", clusters: [] }),
      getFindings: async () => {
        throw new Error("Failed to fetch");
      },
      getCaptureReview: async () => ({
        items: [
          {
            captureId: "frames/001.png::aaa",
            caption: "Settings",
            status: "pending" as const,
            runId: "run-1",
            framePath: "frames/001.png",
            imageSha256: "aaa",
            attempt: 1,
          },
          {
            captureId: "missing::settings",
            caption: "Language",
            status: "missing" as const,
            runId: "run-2",
            attempt: 1,
            blocked: true,
          },
        ],
        summary: {
          captured: 1,
          missing: 0,
          pending: 1,
          accepted: 0,
          issue: 0,
          needMoreEvidence: 0,
          planned: 2,
          blocked: 1,
        },
      }),
      reviewCaptures,
    } as unknown as RunAcrossProductService);
    expect(document.body.textContent).toContain("Screenshot review");
    expect(document.body.textContent).toContain("2 planned · 1 captured · 1 blocked");
    expect(document.body.textContent).toContain("0 missing");
    expect(document.body.textContent).toContain("blocked");
    expect(document.body.textContent).toContain(
      "Looks correct reviews this capture. Accept as reference also governs later Runs.",
    );
    const inspect = [...document.querySelectorAll('[role="tab"]')].find(
      (tab) => tab.textContent === "Inspect",
    ) as HTMLButtonElement;
    await act(async () => inspect.click());
    const accept = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Looks correct",
    );
    if (!(accept instanceof HTMLButtonElement)) throw new Error("Looks correct not found");
    await act(async () => accept.click());
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
    expect(reviewCaptures).toHaveBeenCalledTimes(1);
    expect(reviewCaptures.mock.calls[0]).toEqual([
      "batch-1",
      {
        action: "accept",
        items: [
          {
            runId: "run-1",
            captureId: "frames/001.png::aaa",
            imageSha256: "aaa",
          },
        ],
      },
    ]);
  });

  it("reviews captured Plan screenshots while the Plan is still running", async () => {
    await render({
      getReport: async () => ({ ...report, status: "running" as const }),
      getFailureClusters: async () => ({ campaignId: "batch-1", clusters: [] }),
      getFindings: async () => {
        throw new Error("Failed to fetch");
      },
      getCaptureReview: async () => ({
        items: [
          {
            captureId: "frames/001.png::aaa",
            caption: "Settings",
            status: "pending" as const,
            runId: "run-1",
            framePath: "frames/001.png",
            imageSha256: "aaa",
            attempt: 1,
          },
        ],
        summary: {
          captured: 1,
          missing: 0,
          pending: 1,
          accepted: 0,
          issue: 0,
          needMoreEvidence: 0,
          planned: 1,
          blocked: 0,
        },
      }),
      cancel: async () => report,
    } as unknown as RunAcrossProductService);
    // The live Plan checklist shows it is running and can be stopped.
    expect(document.body.textContent).toContain("Running");
    expect(
      [...document.querySelectorAll("button")].some((item) => item.textContent === "Stop"),
    ).toBe(true);
    expect(document.body.textContent).toContain("Screenshot review");
    expect(document.body.textContent).toContain(
      "New captures appear here as they finish. Selection does not include later arrivals.",
    );
    expect(document.body.textContent).toContain("1 planned · 1 captured · 0 blocked · 0 missing");
  });
});
