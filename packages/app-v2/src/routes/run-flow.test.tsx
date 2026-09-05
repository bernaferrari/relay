/** @jsxImportSource react */
import type { ProductRunReport, ProductRunState } from "@relay/product/run-journey";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayV2App } from "../app";
import type { RecordingProductService } from "../data/recording-product-service";
import type { ProductRunReportOverview, RunProductService } from "../data/run-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const recordingService = {} as RecordingProductService;

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

function runState(
  phase: "queued" | "running" | "succeeded" | "failed" | "cancelled",
  allowed: readonly ("inspect" | "cancel")[] = phase === "running"
    ? ["inspect", "cancel"]
    : ["inspect"],
): ProductRunState {
  const terminal = phase === "succeeded" || phase === "failed" || phase === "cancelled";
  const report: ProductRunReport | undefined = terminal
    ? {
        id: "run-1",
        reportId: "run-1",
        runId: "run-1",
        title: "Change the app language",
        phase,
        target: { kind: "device", platform: "android", targetId: "emulator-5554" },
        problems: [],
        evidenceRefs: [{ kind: "run", id: "run-1" }],
        navigation: { route: "/runs/run-1", href: "/runs/run-1" },
      }
    : undefined;
  return {
    status: phase,
    workflow: { workflowId: "workflow-run-1", expectedVersion: 2 },
    run: { jobId: "job-1", runId: "run-1" },
    snapshot: {
      schemaVersion: 1,
      kind: "run-test",
      title: "Change the app language",
      phase,
      version: `run-${phase}`,
      workflow: { workflowId: "workflow-run-1", expectedVersion: 2 },
      target: { kind: "device", platform: "android", targetId: "emulator-5554" },
      execution: { jobId: "job-1", runId: "run-1" },
      progress: {
        label: phase === "running" ? "Checking Language" : phase,
        completed: 1,
        total: 3,
      },
      allowedNextActions: allowed,
      problems: [],
      evidenceRefs: terminal ? [{ kind: "run", id: "run-1" }] : [],
    },
    ...(report ? { report } : {}),
  };
}

function report(outcome: ProductRunReportOverview["outcome"] = "passed"): ProductRunReportOverview {
  return {
    runId: "run-1",
    title: "Change the app language",
    outcome,
    targetName: "Pixel 9",
    durationMs: 1_550,
    ...(outcome === "passed"
      ? { firstEvidence: { label: "Language checkpoint passed" } }
      : { cause: "The Language checkpoint did not appear." }),
    timeline: [
      {
        id: "step-open",
        index: 0,
        title: "Open Language settings",
        state: "passed",
        durationMs: 650,
        evidenceCount: 1,
        framePaths: ["screen-1"],
      },
      {
        id: "step-check",
        index: 1,
        title: "Language checkpoint passed",
        state: outcome === "passed" ? "passed" : "failed",
        durationMs: 900,
        evidenceCount: 1,
        framePaths: ["screen-2"],
      },
    ],
    evidence: [
      {
        id: "screenshot",
        label: "Screenshots",
        count: 2,
        detail: "2 screenshots",
        summary: "See the screens Relay captured while this Test ran.",
        inspectable: true,
        items: [
          {
            id: "screen-1",
            title: "Language settings",
            media: {
              kind: "image",
              src: "data:image/png;base64,iVBORw0KGgo=",
              width: 320,
              height: 640,
            },
          },
          {
            id: "screen-2",
            title: "Language checkpoint",
            media: {
              kind: "image",
              src: "data:image/png;base64,iVBORw0KGgo=",
              width: 320,
              height: 640,
            },
          },
        ],
      },
      {
        id: "ui-tree",
        label: "Interface snapshots",
        count: 1,
        detail: "1 interface snapshot",
        summary: "Inspect the interface structure Relay used for semantic checks.",
        inspectable: false,
        items: [],
      },
    ],
  };
}

function fakeRunService(initial: ProductRunState = runState("running")) {
  let current = initial;
  let finish: ((state: ProductRunState) => void) | undefined;
  const calls: string[] = [];
  const service: RunProductService = {
    async getTest(testId) {
      calls.push(`test:${testId}`);
      return {
        id: testId,
        name: "Change the app language",
        appMapId: "settings-language-proof",
        appName: "Settings Language Proof",
        stepCount: 3,
        steps: [
          {
            id: "step-open",
            kind: "instruction",
            intent: "Open Language settings",
            capture: true,
            status: "ready",
          },
          {
            id: "step-check",
            kind: "validation",
            intent: "Confirm the selected language",
            capture: true,
            status: "ready",
          },
          {
            id: "step-finish",
            kind: "instruction",
            intent: "Return to the app",
            capture: false,
            status: "ready",
          },
        ],
      };
    },
    async listTargets() {
      calls.push("targets");
      return [
        {
          kind: "device",
          platform: "android",
          targetId: "emulator-5554",
          name: "Pixel 9 Pro",
          detail: "Android emulator · 15 · Ready",
        },
        {
          kind: "browser",
          platform: "browser",
          targetId: "browser-golden",
          name: "Checkout browser",
          detail: "Managed browser · Ready",
        },
      ];
    },
    async presentTargets(selected) {
      return selected.map((item) => ({
        ...item,
        name: item.kind === "browser" ? "Checkout browser" : "Pixel 9 Pro",
        detail: item.kind === "browser" ? "Managed browser · Ready" : "Android emulator · Ready",
      }));
    },
    async start(input) {
      calls.push(`start:${input.testId}:${input.appMapId}:${input.targetId}`);
      current = runState("queued", ["inspect", "cancel"]);
      return current;
    },
    async inspect(workflowId) {
      calls.push(`inspect:${workflowId}`);
      if (current.status === "queued") current = runState("running");
      return current;
    },
    async watch(input) {
      calls.push("watch");
      input?.onState?.(current);
      return new Promise<ProductRunState>((resolve) => {
        finish = (next) => {
          current = next;
          input?.onState?.(next);
          resolve(next);
        };
      });
    },
    async cancel() {
      calls.push("cancel");
      current = runState("cancelled");
      finish?.(current);
      return current;
    },
    async getReport(runId) {
      calls.push(`report:${runId}`);
      return report(current.status === "cancelled" ? "cancelled" : "passed");
    },
    async getRawEvidence(runId) {
      calls.push(`raw-evidence:${runId}`);
      return {
        channels: {
          screenshot: { entries: 2 },
          "ui-tree": { entries: 1 },
        },
        redacted: true,
        note: null,
        events: [{ sequence: 1, kind: "checkpoint.passed" }],
      };
    },
  };
  return {
    service,
    calls,
    complete(phase: "succeeded" | "failed" = "succeeded") {
      const next = runState(phase);
      current = next;
      finish?.(next);
    },
  };
}

function platformWithStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const platform: Platform = {
    platform: "web",
    getServerUrl: () => "http://127.0.0.1:8787",
    storage: {
      get: (key) => values.get(key) ?? null,
      set: (key, value) => void values.set(key, value),
      remove: (key) => void values.delete(key),
    },
  };
  return { platform, values };
}

async function renderRun(path: string, runService: RunProductService, platform: Platform) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayV2App
        platform={platform}
        history={history}
        productService={recordingService}
        runService={runService}
      />,
    );
  });
  await settle();
  return { history };
}

async function settle() {
  for (let index = 0; index < 5; index++) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(result instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
  return result;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}

describe("Run and Report", () => {
  it("selects the only ready target so a Test can run immediately", async () => {
    const fake = fakeRunService();
    fake.service.listTargets = async () => [
      {
        kind: "browser",
        platform: "browser",
        targetId: "browser-golden",
        name: "Checkout browser",
        detail: "Managed browser · Ready",
      },
    ];
    await renderRun("/tests/test-1", fake.service, platformWithStorage().platform);

    expect(document.querySelector<HTMLInputElement>('input[value="browser-golden"]')?.checked).toBe(
      true,
    );
    expect(button("Run Test").disabled).toBe(false);
  });

  it("starts one canonical Run, follows progress, and renders only real evidence", async () => {
    const fake = fakeRunService();
    const storage = platformWithStorage();
    const { history } = await renderRun("/tests/test-1", fake.service, storage.platform);

    expect(button("Run Test").disabled).toBe(true);
    expect(document.body.textContent?.match(/Run Test/g)).toHaveLength(1);
    expect(document.body.textContent).toContain("Checkout browser");
    expect(document.body.textContent).toContain("Pixel 9 Pro");
    expect(document.body.textContent).not.toContain("browser-golden");
    expect(document.body.textContent).not.toContain("emulator-5554");
    expect(document.body.textContent).toContain("Evidence for this step");
    const savedSteps = [
      ...document.querySelectorAll<HTMLButtonElement>(".relay-test-readable-steps button"),
    ];
    expect(savedSteps).toHaveLength(3);
    expect(savedSteps[0]?.getAttribute("aria-pressed")).toBe("true");
    await click(savedSteps[1]!);
    expect(savedSteps[1]?.getAttribute("aria-pressed")).toBe("true");
    await click(document.querySelector<HTMLInputElement>('input[value="browser-golden"]')!);
    expect(button("Run Test").disabled).toBe(false);
    await click(button("Run Test"));

    expect(fake.calls).toContain("start:test-1:settings-language-proof:browser-golden");
    expect(history.location.pathname).toBe("/runs/run-1");
    expect(document.body.textContent).toContain("Checking Language");
    expect(button("Cancel Run").disabled).toBe(false);
    expect(storage.values.has("activeRunWorkflow")).toBe(true);

    await act(async () => fake.complete());
    await settle();

    expect(document.body.textContent).toContain("This Test passed on Pixel 9.");
    expect(document.body.textContent).not.toContain("Draft issue");
    expect(document.body.textContent).toContain("Set up another run");
    expect(document.body.textContent).toContain("View test");
    expect(document.body.textContent).toContain("1.6 s");
    expect(document.body.textContent).toContain("Language checkpoint passed");
    expect(document.body.textContent).toContain("What Relay verified");
    expect(document.body.textContent).toContain("Passed");
    expect(document.body.textContent).toContain("Timeline");
    expect(document.body.textContent).toContain("Evidence");
    expect(document.body.textContent).not.toContain("Network");
    expect(document.body.textContent?.match(/1\.6 s/g)).toHaveLength(1);
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(storage.values.has("activeRunWorkflow")).toBe(false);

    await click(button("Evidence"));
    expect(document.body.textContent).toContain("Screenshots");
    expect(document.body.textContent).toContain("Interface snapshots");
    expect(document.body.textContent).toContain("Language settings");
    expect(document.querySelector<HTMLImageElement>(".relay-evidence-image-frame img")?.src).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
    expect(fake.calls).not.toContain("raw-evidence:run-1");

    const auditTrigger = button("Audit details");
    expect(auditTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[aria-label="Raw evidence JSON"]')).toBeNull();
    await click(auditTrigger);
    expect(auditTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(fake.calls).toContain("raw-evidence:run-1");
    const rawJson = document.querySelector('[aria-label="Raw evidence JSON"]');
    expect(rawJson?.textContent).toContain('\n  "channels": {\n');
    expect(rawJson?.querySelector(".relay-json-token--key")?.textContent).toBe('"channels"');
    expect(rawJson?.querySelector(".relay-json-token--string")?.textContent).toBe(
      '"checkpoint.passed"',
    );
    expect(rawJson?.querySelector(".relay-json-token--number")?.textContent).toBe("2");
    expect(rawJson?.querySelector(".relay-json-token--boolean")?.textContent).toBe("true");
    expect(rawJson?.querySelector(".relay-json-token--null")?.textContent).toBe("null");
    expect(document.body.textContent).toContain("checkpoint.passed");

    await act(async () => history.back());
    await settle();
    expect(history.location.pathname).toBe("/runs/run-1");
    expect(history.location.search).toBe("");
    await act(async () => history.back());
    await settle();
    expect(history.location.pathname).toBe("/tests/test-1");
    // Returning to the document restores the explicitly chosen compatible target.
    expect(button("Run Test").disabled).toBe(false);
  });

  it("keeps a queued saved-step replay on the source report until a real run id exists", async () => {
    const fake = fakeRunService(runState("succeeded"));
    let replayCalls = 0;
    let jobReads = 0;
    fake.service.replay = async (runId) => {
      expect(runId).toBe("run-1");
      replayCalls += 1;
      return { jobId: "job-replay" };
    };
    fake.service.getReplayJob = async (jobId) => {
      expect(jobId).toBe("job-replay");
      jobReads += 1;
      return jobReads === 1 ? { status: "queued" } : { status: "ok", runId: "run-2" };
    };

    const { history } = await renderRun(
      "/runs/run-1",
      fake.service,
      platformWithStorage().platform,
    );
    await click(button("Replay saved steps"));
    await click(button("Start replay"));

    expect(replayCalls).toBe(1);
    expect(history.location.search).toContain("replayJob=job-replay");
    expect(history.location.pathname).toBe("/runs/run-1");
    expect(document.body.textContent).toContain("Replay queued on the saved target");

    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 1_650))));
    await settle();
    expect(history.location.pathname).toBe("/runs/run-2");
    expect(history.location.search).toBe("");
    expect(replayCalls).toBe(1);
  });

  it("reports replay polling failures instead of leaving a false in-progress state", async () => {
    const fake = fakeRunService(runState("succeeded"));
    fake.service.replay = async () => ({ jobId: "job-replay" });
    fake.service.getReplayJob = async () => {
      throw new Error("workspace unavailable");
    };

    await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);
    await click(button("Replay saved steps"));
    await click(button("Start replay"));
    await settle();

    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("Replaying saved steps on the saved target");
  });

  it("does not navigate from a running replay even if a provisional run id is present", async () => {
    const fake = fakeRunService(runState("succeeded"));
    fake.service.replay = async () => ({ jobId: "job-replay" });
    fake.service.getReplayJob = async () => ({ status: "running", runId: "run-provisional" });

    const { history } = await renderRun(
      "/runs/run-1",
      fake.service,
      platformWithStorage().platform,
    );
    await click(button("Replay saved steps"));
    await click(button("Start replay"));
    await settle();

    expect(history.location.pathname).toBe("/runs/run-1");
    expect(document.body.textContent).toContain("Replaying saved steps");
  });

  it("surfaces a terminal replay with no report id as an unavailable result", async () => {
    const fake = fakeRunService(runState("succeeded"));
    fake.service.replay = async () => ({ jobId: "job-replay" });
    fake.service.getReplayJob = async () => ({ status: "ok" });

    await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);
    await click(button("Replay saved steps"));
    await click(button("Start replay"));
    await settle();

    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("Replaying saved steps on the saved target");
  });

  it("adopts the durable workflow pointer after reload", async () => {
    const fake = fakeRunService();
    const storage = platformWithStorage({
      activeRunWorkflow: JSON.stringify({
        workflowId: "workflow-run-1",
        runId: "run-1",
        testId: "test-1",
      }),
    });
    await renderRun("/runs/run-1", fake.service, storage.platform);

    expect(fake.calls).toContain("inspect:workflow-run-1");
    expect(document.body.textContent).toContain("Checking Language");
    expect(document.body.textContent).not.toContain("emulator-5554");
  });

  it("shows only one centered recovery state when an in-progress Run disconnects", async () => {
    const fake = fakeRunService();
    fake.service.inspect = async () => {
      throw new TypeError("Failed to fetch");
    };
    const storage = platformWithStorage({
      activeRunWorkflow: JSON.stringify({
        workflowId: "workflow-run-1",
        runId: "run-1",
        testId: "test-1",
      }),
    });
    await renderRun("/runs/run-1", fake.service, storage.platform);

    const recovery = document.querySelector(".relay-run-recovery");
    expect(recovery?.classList.contains("relay-recovery-state--centered")).toBe(true);
    expect(recovery?.textContent).toContain("Relay is not connected");
    expect(document.body.textContent).not.toContain("Restoring progress");
    expect(document.body.textContent).not.toContain("Loading the Run");
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(document.querySelector(".relay-run-progress")).toBeNull();
    const recoveryHeading = document.querySelector("h1");
    expect(recoveryHeading?.classList.contains("relay-visually-hidden")).toBe(true);
    expect(recoveryHeading?.classList.contains("sr-only")).toBe(true);
    expect(button("Try again")).not.toBeNull();
  });

  it("offers only Resume Run while a durable Run is active", async () => {
    const fake = fakeRunService();
    const storage = platformWithStorage({
      activeRunWorkflow: JSON.stringify({
        workflowId: "workflow-run-1",
        runId: "run-1",
        testId: "test-1",
      }),
    });
    const { history } = await renderRun("/tests/test-1", fake.service, storage.platform);

    expect(document.body.textContent).toContain("A Run is already in progress");
    expect(
      [...document.querySelectorAll("button")].some((item) => item.textContent === "Run Test"),
    ).toBe(false);
    const resume = [...document.querySelectorAll("a")].find(
      (item) => item.textContent?.trim() === "Resume Run",
    );
    expect(resume?.textContent).toContain("Resume Run");
    expect(history.location.pathname).toBe("/tests/test-1");
    expect(fake.calls.some((call) => call.startsWith("start:"))).toBe(false);
  });

  it("shows Cancel only while canonical state allows it", async () => {
    const fake = fakeRunService();
    const storage = platformWithStorage({
      activeRunWorkflow: JSON.stringify({
        workflowId: "workflow-run-1",
        runId: "run-1",
        testId: "test-1",
      }),
    });
    await renderRun("/runs/run-1", fake.service, storage.platform);
    await click(button("Cancel Run"));

    expect(fake.calls).toContain("cancel");
    expect(document.body.textContent).toContain("This Run was cancelled on Pixel 9.");
    expect(document.body.textContent).not.toContain("Cancel Run");
  });

  it("does not offer Cancel when canonical state withholds it", async () => {
    const fake = fakeRunService(runState("running", ["inspect"]));
    const storage = platformWithStorage({
      activeRunWorkflow: JSON.stringify({
        workflowId: "workflow-run-1",
        runId: "run-1",
        testId: "test-1",
      }),
    });
    await renderRun("/runs/run-1", fake.service, storage.platform);

    expect(document.body.textContent).toContain("Checking Language");
    expect(document.body.textContent).not.toContain("Cancel Run");
  });

  it("loads a durable terminal report directly without a local pointer", async () => {
    const fake = fakeRunService();
    const storage = platformWithStorage();
    await renderRun("/runs/run-1", fake.service, storage.platform);

    expect(fake.calls).not.toContain("inspect:workflow-run-1");
    expect(fake.calls).toContain("report:run-1");
    expect(document.body.textContent).toContain("This Test passed on Pixel 9.");
    expect(document.body.textContent).not.toContain("Draft issue");
  });

  it("restores an available Report destination from the URL", async () => {
    const fake = fakeRunService();
    await renderRun("/runs/run-1?view=evidence", fake.service, platformWithStorage().platform);

    expect(document.body.textContent).toContain("Captured during this Run");
    expect(document.body.textContent).toContain("Language settings");
    expect(document.body.textContent).not.toContain("What Relay verified");
    expect(document.querySelector('#report-tab-evidence[aria-selected="true"]')).not.toBeNull();
  });

  it("routes durable Run review decisions with the canonical Run identity", async () => {
    const fake = fakeRunService();
    const review = vi.fn().mockResolvedValue({ status: "approved" } as never);
    fake.service.review = review;
    await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);

    await click(button("Review and visual decisions"));
    await click(button("Approve Run"));
    await click(button("Defer"));
    await click(button("Reject"));

    expect(review).toHaveBeenNthCalledWith(1, {
      runId: "run-1",
      action: "approve",
      note: "Reviewed in Relay",
    });
    expect(review).toHaveBeenNthCalledWith(2, {
      runId: "run-1",
      action: "defer",
      note: "Reviewed in Relay",
    });
    expect(review).toHaveBeenNthCalledWith(3, {
      runId: "run-1",
      action: "reject",
      note: "Reviewed in Relay",
    });
    expect(document.body.textContent).toContain("Run review saved");
  });

  it("renders visual comparison facts and routes baseline decisions by comparison id", async () => {
    const fake = fakeRunService();
    const comparison = {
      id: "comparison-7",
      code: "VISUAL_CHANGED",
      diff: { changedFrames: 2, addedFrames: 1, removedFrames: 0 },
    } as never;
    const compareVisual = vi.fn().mockResolvedValue(comparison);
    const approveVisualBaseline = vi.fn().mockResolvedValue({ status: "approved" } as never);
    const reviewVisual = vi.fn().mockResolvedValue({ status: "reviewed" } as never);
    fake.service.compareVisual = compareVisual;
    fake.service.approveVisualBaseline = approveVisualBaseline;
    fake.service.reviewVisual = reviewVisual;
    await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);

    await click(button("Review and visual decisions"));
    await click(button("Compare visual evidence"));
    expect(compareVisual).toHaveBeenCalledWith("run-1");
    expect(document.body.textContent).toContain("Visual changes need review");
    expect(document.body.textContent).toContain("2 changed · 1 added · 0 removed");

    await click(button("Approve new baseline"));
    expect(approveVisualBaseline).toHaveBeenCalledWith({
      runId: "run-1",
      action: "approve-new-baseline",
      note: "Reviewed in Relay",
    });

    await click(button("Keep baseline"));
    await click(button("Retry later"));
    expect(reviewVisual).toHaveBeenNthCalledWith(1, {
      runId: "run-1",
      comparisonId: "comparison-7",
      action: "keep-baseline",
      note: "Reviewed in Relay",
    });
    expect(reviewVisual).toHaveBeenNthCalledWith(2, {
      runId: "run-1",
      comparisonId: "comparison-7",
      action: "retry",
      note: "Reviewed in Relay",
    });
  });

  it("labels Test reliability as partial while loaded Run history is incomplete", async () => {
    const fake = fakeRunService();
    fake.service.listTestRuns = async () =>
      [
        {
          id: "run-1",
          title: "Change the app language",
          action: "Open report",
          status: "completed",
          phase: "completed",
          outcome: "passed",
          appMapId: "settings-language-proof",
          queuedAt: 1,
          finishedAt: 2,
          identity: { runId: "run-1", appMapId: "settings-language-proof" },
          links: { self: "/runs/run-1", app: "/apps/settings-language-proof" },
        },
      ] as never;
    await renderRun("/tests/test-1", fake.service, platformWithStorage().platform);

    expect(document.body.textContent).toContain("Recent stability");
    expect(document.body.textContent).toContain("Partial history");
    expect(document.body.textContent).toContain(
      "Rates stay hidden until complete history is available.",
    );
  });

  it("labels Test reliability complete only when the explicit complete-history read is available", async () => {
    const fake = fakeRunService();
    const history = [
      {
        id: "run-1",
        title: "Change the app language",
        action: "Open report",
        status: "completed",
        phase: "completed",
        outcome: "passed",
        appMapId: "settings-language-proof",
        testId: "test-1",
        queuedAt: 1,
        finishedAt: 2,
        identity: {
          runId: "run-1",
          appMapId: "settings-language-proof",
          testId: "test-1",
        },
        links: { self: "/runs/run-1", app: "/apps/settings-language-proof" },
      },
    ] as never;
    fake.service.listTestRuns = async () => history;
    fake.service.listTestRunsComplete = async () => history;
    await renderRun("/tests/test-1", fake.service, platformWithStorage().platform);

    expect(document.body.textContent).toContain("Complete history");
  });

  it("keeps unavailable evidence calm without weakening the saved outcome", async () => {
    const fake = fakeRunService();
    fake.service.getReport = async () => ({
      runId: "run-1",
      title: "Change the app language",
      outcome: "passed",
      targetName: "Pixel 9",
      timeline: [],
      evidence: [],
      evidenceUnavailable: true,
    });
    await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);

    expect(document.body.textContent).toContain("This Test passed on Pixel 9.");
    expect(document.body.textContent).not.toContain("Draft issue");
    expect(document.body.textContent).toContain("Evidence details are temporarily unavailable");
    expect(document.body.textContent).toContain("saved outcome above is unchanged");
    expect(document.body.textContent).not.toContain("run-1");
  });

  it("keeps a failed Report human-readable and collapses the raw exception", async () => {
    const fake = fakeRunService();
    fake.service.getReport = async () => ({
      runId: "run-1",
      title: "Change the app language",
      outcome: "harness-failure",
      targetName: "Golden Chromium",
      cause:
        "page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173\nCall log:\n  - navigating",
      category: "Browser connection",
      timeline: [],
      evidence: [],
    });
    await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);

    expect(document.body.textContent).toContain("Browser could not open the app");
    expect(document.body.textContent).toContain("Browser connection");
    expect(document.body.textContent).toContain("Reconnect the device or browser");
    expect(document.body.textContent).toContain("Technical details");
    expect(
      document.querySelector<HTMLAnchorElement>('a[href="/debug?runId=run-1"]'),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("ERR_CONNECTION_REFUSED");
    expect(document.body.textContent).not.toContain("Evidence at this point");
    expect(document.querySelector('[role="tab"]')).toBeNull();
  });
});
