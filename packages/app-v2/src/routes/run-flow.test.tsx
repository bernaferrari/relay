/** @jsxImportSource react */
import type { ProductRunReport, ProductRunState } from "@relay/product/run-journey";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayV2App } from "../app";
import type { RecordingProductService } from "../data/recording-product-service";
import type { RunAcrossProductService } from "../data/run-across-product-service";
import { runEvidenceExportDocument } from "@relay/product/run-evidence-export";
import type { ProductRunReportOverview, RunProductService } from "../data/run-product-service";
import type { TracePackExportResponse } from "@relay/protocol";
import type { Platform } from "../platform/types";
import { WORKSPACE_DESTINATION_KEY } from "../layout/destination-summary";
import { runConfigurationStorageKey } from "../data/use-persisted-run-configuration";

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

function workflowless(state: ProductRunState): ProductRunState {
  return {
    ...state,
    workflow: undefined,
    snapshot: { ...state.snapshot, workflow: undefined },
  } as ProductRunState;
}

function fakeRunService(initial: ProductRunState = runState("running")) {
  let current = initial;
  let finish: ((state: ProductRunState) => void) | undefined;
  const calls: string[] = [];
  const startInputs: unknown[] = [];
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
    async listBuilds() {
      return [
        {
          id: "build-android-1",
          name: "Android QA",
          platform: "android",
          status: "ready",
          sourceSha: "abcdef1234567",
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
      startInputs.push(input);
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
    async exportEvidence(runId) {
      calls.push(`export:${runId}`);
      return runEvidenceExportDocument(runId, tracePackForRun(runId));
    },
  };
  return {
    service,
    calls,
    startInputs,
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

async function renderRun(
  path: string,
  runService: RunProductService,
  platform: Platform,
  runAcrossService?: RunAcrossProductService,
) {
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
        runAcrossService={runAcrossService}
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
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (!(result instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
  return result;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}

async function openRunSettings() {
  const trigger = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
    item.textContent?.includes("Run settings"),
  );
  if (!trigger) throw new Error("Run settings trigger not found");
  await click(trigger);
}

async function selectOption(label: string, option: string) {
  await click(document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!);
  const item = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((candidate) =>
    candidate.textContent?.trim().includes(option),
  );
  if (!item) throw new Error(`Option not found: ${label} / ${option}`);
  await click(item);
}

describe("Run and Report", () => {
  it("offers step review when saved capture controls block compilation", async () => {
    const fake = fakeRunService();
    fake.service.start = async () => ({
      status: "failed",
      recovery: {
        code: "compile-blocked",
        sourceCode: "raw-evidence-variant-recapture-required",
        title: "The Test has 5 compile blockers",
        detail: "workflow compile raw selector proof failed",
        recovery: "Review selector bindings",
        retryable: false,
      },
    });
    fake.service.listTargets = async () => [
      {
        kind: "device",
        platform: "android",
        targetId: "emulator-5554",
        name: "QA phone",
        detail: "Android emulator",
      },
    ];
    await renderRun("/tests/test-1", fake.service, platformWithStorage().platform);
    await click(button("Run Test"));
    expect(document.body.textContent).toContain("Saved controls need review");
    expect(document.body.textContent).not.toContain("restore this work");
    const review = [
      ...document.querySelectorAll<HTMLAnchorElement>('a[href="/tests/test-1/edit"]'),
    ].find((link) => link.textContent === "Review steps");
    expect(review).toBeDefined();
  });

  it("opens Run settings directly from a library setup link", async () => {
    const fake = fakeRunService();
    await renderRun("/tests/test-1?setup=run", fake.service, platformWithStorage().platform);
    expect(
      document.querySelector("#test-run-setup"),
      document.body.textContent ?? "",
    ).not.toBeNull();
    expect(document.querySelector('button[aria-label="Device or browser"]')).not.toBeNull();
  });

  it("dismisses setup after launch and keeps it closed when the run completes", async () => {
    const fake = fakeRunService();
    const { history } = await renderRun(
      "/tests/test-1?setup=run",
      fake.service,
      platformWithStorage().platform,
    );
    await selectOption("Device or browser", "Checkout browser");
    await click(button("Run Test"));
    expect(String(history.location.search)).not.toContain("setup=run");
    await act(async () => fake.complete());
    await settle();
    expect(document.querySelector("#test-run-setup")).toBeNull();
    expect(document.body.textContent).toContain("Test passed");
  });

  it("waits for every data dimension before previewing and labels the selected target", async () => {
    const fake = fakeRunService(runState("running", ["inspect"]));
    const preview = vi.fn((input) => ({
      selected: input.selected,
      target: input.target,
      caseCount: 1,
      pilot: {},
      scopeLabel: `1 case on ${input.target.label}`,
    }));
    const runAcross = {
      getSetup: vi.fn(async () => ({
        appMapId: "settings-language-proof",
        appMapRevision: 1,
        testId: "test-1",
        testName: "Change the app language",
        appName: "Settings Language Proof",
        dataSet: {
          name: "Checkout cases",
          dimensions: [
            {
              id: "language",
              name: "Language",
              values: [{ id: "en", label: "English" }],
            },
            {
              id: "region",
              name: "Region",
              values: [{ id: "us", label: "United States" }],
            },
          ],
        },
      })),
      preview,
    } as unknown as RunAcrossProductService;
    await renderRun(
      "/tests/test-1/run-across",
      fake.service,
      platformWithStorage().platform,
      runAcross,
    );
    await selectOption("Device or browser", "Checkout browser");
    expect(preview).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Choose values for the remaining data groups");

    const values = [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')];
    expect(values).toHaveLength(2);
    await click(values[0]!.closest("label") ?? values[0]!);
    expect(preview).not.toHaveBeenCalled();
    expect(values[0]?.getAttribute("aria-checked")).toBe("true");

    await click(values[1]!.closest("label") ?? values[1]!);
    expect(values[1]?.getAttribute("aria-checked")).toBe("true");
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview.mock.calls[0]?.[0].target.label).toBe("Checkout browser");
    expect(document.body.textContent).toContain("1 case on Checkout browser");
  });

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
    await openRunSettings();

    expect(
      document.querySelector<HTMLButtonElement>('button[aria-label="Device or browser"]')
        ?.textContent,
    ).toContain("Checkout browser");
    expect(button("Run Test").disabled).toBe(false);
  });

  it("submits the visible build and cold-start choices", async () => {
    const fake = fakeRunService();
    await renderRun("/tests/test-1", fake.service, platformWithStorage().platform);
    await openRunSettings();
    await selectOption("Build", "Android QA · abcdef123456");
    await selectOption("Device or browser", "Checkout browser");
    const cold = [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].find((input) =>
      input.parentElement?.textContent?.includes("Restart app before running"),
    );
    if (!cold) throw new Error("Cold-start selector not found");
    await click(cold.closest("label") ?? cold);
    await click(button("Run Test"));
    expect(fake.startInputs[0]).toMatchObject({
      sourceRevision: { vcs: "git", sha: "abcdef1234567", buildId: "build-android-1" },
      startup: { mode: "cold" },
    });
  });

  it("keeps an incompatible saved profile visible as a blocker", async () => {
    const fake = fakeRunService();
    fake.service.listProfiles = async () => [
      {
        id: "profile-android",
        name: "Pixel 9 reviewed",
        targetId: "emulator-5554",
        platform: "android",
      },
    ];
    await renderRun("/tests/test-1", fake.service, platformWithStorage().platform);
    await openRunSettings();

    await selectOption("Device or browser", "Pixel 9 Pro");
    await selectOption("Profile", "Pixel 9 reviewed");
    await selectOption("Device or browser", "Checkout browser");
    expect(document.body.textContent).toContain("saved for another destination");
    await click(button("Fix setup"));
    expect(fake.startInputs).toHaveLength(0);
  });

  it("keeps a saved Test browser and profile when a workspace Pixel is remembered", async () => {
    const fake = fakeRunService();
    fake.service.listProfiles = async () => [
      {
        id: "profile-member",
        name: "Member",
        targetId: "browser-golden",
        platform: "browser",
        account: { id: "acct-member", name: "Member" },
      },
    ];
    const saved = JSON.stringify({
      targetId: "browser-golden",
      savedProfileId: "profile-member",
    });
    const storage = platformWithStorage({
      [WORKSPACE_DESTINATION_KEY]: JSON.stringify({ targetId: "emulator-5554" }),
      [runConfigurationStorageKey({
        server: "http://127.0.0.1:8787",
        entity: "test-run:test-1",
      })]: saved,
      [runConfigurationStorageKey({
        server: "http://127.0.0.1:8787",
        appId: "settings-language-proof",
        entity: "test-run:test-1",
      })]: saved,
    });
    await renderRun("/tests/test-1", fake.service, storage.platform);
    await openRunSettings();

    expect(
      document.querySelector<HTMLButtonElement>('button[aria-label="Device or browser"]')
        ?.textContent,
    ).toContain("Checkout browser");
    expect(
      document.querySelector<HTMLButtonElement>('button[aria-label="Profile"]')?.textContent,
    ).toContain("Member · Member");
  });

  it("applies a toolbar destination serial once and keeps a later in-page target", async () => {
    const fake = fakeRunService();
    const storage = platformWithStorage({
      [WORKSPACE_DESTINATION_KEY]: JSON.stringify({ targetId: "emulator-5554" }),
    });
    await renderRun("/tests/test-1", fake.service, storage.platform);
    await openRunSettings();

    expect(
      document.querySelector<HTMLButtonElement>('button[aria-label="Device or browser"]')
        ?.textContent,
    ).toContain("Pixel 9 Pro");
    await selectOption("Device or browser", "Checkout browser");
    expect(
      document.querySelector<HTMLButtonElement>('button[aria-label="Device or browser"]')
        ?.textContent,
    ).toContain("Checkout browser");
  });

  it("moves step selection and focus with overview keyboard controls", async () => {
    const fake = fakeRunService();
    await renderRun("/tests/test-1", fake.service, platformWithStorage().platform);

    const heading = document.querySelector<HTMLElement>("#test-overview-title");
    const steps = [...document.querySelectorAll<HTMLButtonElement>("button[data-step-id]")];
    if (!heading || steps.length !== 3) throw new Error("Test overview controls not found");
    expect(heading.tabIndex).toBe(0);
    heading.focus();
    expect(document.activeElement).toBe(heading);

    const press = async (key: string) => {
      await act(async () => {
        heading.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
      await settle();
    };
    await press("ArrowDown");
    expect(document.activeElement).toBe(steps[1]);
    expect(steps[1]?.getAttribute("aria-pressed")).toBe("true");
    await press("Home");
    expect(document.activeElement).toBe(steps[0]);
    expect(steps[0]?.getAttribute("aria-pressed")).toBe("true");
    await press("End");
    expect(document.activeElement).toBe(steps[2]);
    expect(steps[2]?.getAttribute("aria-pressed")).toBe("true");
  });

  it("starts one canonical Run, follows progress, and renders only real evidence", async () => {
    const fake = fakeRunService();
    const storage = platformWithStorage();
    const { history } = await renderRun("/tests/test-1", fake.service, storage.platform);

    expect(button("Set up Run").disabled).toBe(false);
    expect(document.body.textContent?.match(/Set up Run/g)).toHaveLength(1);
    await openRunSettings();
    expect(document.body.textContent).toContain("Checkout browser");
    expect(document.body.textContent).toContain("Pixel 9 Pro");
    expect(document.body.textContent).not.toContain("browser-golden");
    expect(document.body.textContent).not.toContain("emulator-5554");
    expect(document.body.textContent).toContain("Run this test to see its result here.");
    const savedSteps = [
      ...document.querySelectorAll<HTMLButtonElement>(".relay-test-readable-steps button"),
    ];
    expect(savedSteps).toHaveLength(3);
    expect(savedSteps[0]?.getAttribute("aria-pressed")).toBe("true");
    await click(savedSteps[1]!);
    expect(savedSteps[1]?.getAttribute("aria-pressed")).toBe("true");
    await openRunSettings();
    await selectOption("Device or browser", "Checkout browser");
    expect(button("Run Test").disabled).toBe(false);
    await click(button("Run Test"));

    expect(fake.calls).toContain("start:test-1:settings-language-proof:browser-golden");
    expect(history.location.pathname).toBe("/tests/test-1");
    expect(String(history.location.search)).toContain("run=run-1");
    expect(document.body.textContent).toContain("Checking Language");
    expect(storage.values.has("activeRunWorkflow")).toBe(true);

    await act(async () => fake.complete());
    await settle();

    expect(history.location.pathname).toBe("/tests/test-1");
    expect(document.body.textContent).toContain("Test passed");
    expect(document.body.textContent).not.toContain("Draft issue");
    expect(document.body.textContent).toContain("Open full report");
    expect(document.body.textContent).not.toContain("Investigate this failure");
    expect(document.body.textContent).toMatch(/\d+(?:\.\d+)?\s?s/);
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(storage.values.has("activeRunWorkflow")).toBe(false);

    const fullReport = [...document.querySelectorAll("a")].find((item) =>
      item.textContent?.includes("Open full report"),
    );
    if (!fullReport) throw new Error("Open full report not found");
    await click(fullReport);
    expect(history.location.pathname).toBe("/runs/run-1");
    expect(document.body.textContent).toContain("Test passed");
    expect(document.body.textContent).toContain("Language settings");
    expect(document.querySelector<HTMLImageElement>(".relay-evidence-image-frame img")?.src).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
    expect(fake.calls).not.toContain("raw-evidence:run-1");

    await click(button("More run actions"));
    const auditTrigger = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === "Audit",
    )!;
    expect(document.querySelector('[aria-label="Raw evidence JSON"]')).toBeNull();
    await click(auditTrigger);
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
    expect(history.location.pathname).toBe("/tests/test-1");
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
    await click(button("Rerun…"));
    await click(button("Start run"));

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
    await click(button("Rerun…"));
    await click(button("Start run"));
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
    await click(button("Rerun…"));
    await click(button("Start run"));
    await settle();

    expect(history.location.pathname).toBe("/runs/run-1");
    expect(document.body.textContent).toContain("Replaying saved steps");
  });

  it("surfaces a terminal replay with no report id as an unavailable result", async () => {
    const fake = fakeRunService(runState("succeeded"));
    fake.service.replay = async () => ({ jobId: "job-replay" });
    fake.service.getReplayJob = async () => ({ status: "ok" });

    await renderRun("/runs/run-raw-1", fake.service, platformWithStorage().platform);
    await click(button("Rerun…"));
    await click(button("Start run"));
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

  it("restores an active Run from canonical server state without local storage", async () => {
    const fake = fakeRunService();
    fake.service.inspectExecution = async (runId) => {
      fake.calls.push(`execution:${runId}`);
      return workflowless(runState("running", ["inspect", "cancel"]));
    };

    await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);

    expect(fake.calls).not.toContain("restore:run-1");
    expect(fake.calls).toContain("execution:run-1");
    expect(document.body.textContent).toContain("Checking Language");
    expect(document.body.textContent).toContain("Cancel Run");
    expect(document.body.textContent).not.toContain("Run unavailable");
  });

  it("keeps an active run scoped while moving Test A to Test B and back", async () => {
    const fake = fakeRunService();
    const storage = platformWithStorage({
      activeRunWorkflow: JSON.stringify({
        workflowId: "workflow-run-1",
        runId: "run-1",
        testId: "test-1",
      }),
    });
    const { history } = await renderRun("/tests/test-1", fake.service, storage.platform);

    expect(document.body.textContent).toContain("Checking Language");
    expect(document.body.textContent).toContain("Open full report");
    history.push("/tests/test-2");
    await settle();
    expect(document.body.textContent).not.toContain("Checking Language");
    expect(document.body.textContent).toContain("Set up Run");

    history.push("/tests/test-1");
    await settle();
    expect(document.body.textContent).toContain("Checking Language");
  });

  it("restores the URL Run when local storage points at a different Run", async () => {
    const fake = fakeRunService(runState("running", ["inspect"]));
    fake.service.restore = async (runId) => {
      fake.calls.push(`restore:${runId}`);
      return runState("running", ["inspect"]);
    };
    await renderRun(
      "/runs/run-2",
      fake.service,
      platformWithStorage({
        activeRunWorkflow: JSON.stringify({
          workflowId: "workflow-run-1",
          runId: "run-1",
          testId: "test-1",
        }),
      }).platform,
    );
    expect(fake.calls).toContain("restore:run-2");
    expect(document.body.textContent).toContain("Checking Language");
    expect(document.body.textContent).not.toContain("Cancel Run");
  });

  it("falls back to the canonical terminal report when restore finds no workflow", async () => {
    const fake = fakeRunService(runState("succeeded"));
    fake.service.restore = async (runId) => {
      fake.calls.push(`restore:${runId}`);
      return undefined;
    };
    await renderRun(
      "/runs/run-1",
      fake.service,
      platformWithStorage({
        activeRunWorkflow: JSON.stringify({
          workflowId: "workflow-run-other",
          runId: "run-other",
          testId: "test-1",
        }),
      }).platform,
    );
    expect(fake.calls).toContain("restore:run-1");
    expect(fake.calls).toContain("report:run-1");
    expect(document.body.textContent).toContain("Test passed");
  });

  it("renders the saved Result when restore would throw and the pointer is empty", async () => {
    const fake = fakeRunService(runState("succeeded"));
    fake.service.restore = async (runId) => {
      fake.calls.push(`restore:${runId}`);
      throw new Error("Failed to fetch");
    };
    await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);
    expect(fake.calls).not.toContain("restore:run-1");
    expect(fake.calls).toContain("report:run-1");
    expect(document.body.textContent).toContain("Test passed");
    expect(document.body.textContent).not.toContain("could not complete this request");
  });

  it("restores a workflow-less active job with progress and explicit cancellation", async () => {
    const fake = fakeRunService();
    fake.service.restore = async () => undefined;
    let executionPhase: "running" | "cancelled" = "running";
    fake.service.inspectExecution = async () => {
      const current = runState(
        executionPhase,
        executionPhase === "running" ? ["inspect", "cancel"] : ["inspect"],
      );
      return workflowless(current);
    };
    fake.service.cancelExecution = async (runId) => {
      fake.calls.push(`cancel-execution:${runId}`);
      executionPhase = "cancelled";
      const current = runState("cancelled", ["inspect"]);
      return workflowless(current);
    };

    await renderRun("/runs/run-raw-1", fake.service, platformWithStorage().platform);
    expect(document.body.textContent).toContain("Checking Language");
    expect(button("Cancel Run").disabled).toBe(false);
    await click(button("Cancel Run"));
    expect(fake.calls).toContain("cancel-execution:run-raw-1");
    expect(document.body.textContent).not.toContain("Cancel Run");
  });

  it("renders the terminal report after a workflow-less job completes", async () => {
    const fake = fakeRunService();
    fake.service.restore = async () => undefined;
    fake.service.inspectExecution = async () => {
      const current = runState("succeeded");
      return workflowless(current);
    };

    await renderRun("/runs/run-raw-terminal", fake.service, platformWithStorage().platform);

    expect(fake.calls).toContain("report:run-raw-terminal");
    expect(document.body.textContent).toContain("Test passed");
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

  it("attaches an active Run to the Test instead of starting another", async () => {
    const fake = fakeRunService();
    const storage = platformWithStorage({
      activeRunWorkflow: JSON.stringify({
        workflowId: "workflow-run-1",
        runId: "run-1",
        testId: "test-1",
      }),
    });
    const { history } = await renderRun("/tests/test-1", fake.service, storage.platform);

    expect(document.body.textContent).toContain("Checking Language");
    expect(
      [...document.querySelectorAll("button")].some((item) => item.textContent === "Set up Run"),
    ).toBe(false);
    expect(
      [...document.querySelectorAll("a")].some((item) =>
        item.textContent?.includes("Open full report"),
      ),
    ).toBe(true);
    expect(history.location.pathname).toBe("/tests/test-1");
    expect(fake.calls.some((call) => call.startsWith("start:"))).toBe(false);

    await act(async () => fake.complete());
    await settle();
    expect(history.location.pathname).toBe("/tests/test-1");
    expect(storage.values.has("activeRunWorkflow")).toBe(false);
    expect(document.body.textContent).toContain("Test passed");
    expect(
      [...document.querySelectorAll("a")].some((item) =>
        item.textContent?.includes("Open full report"),
      ),
    ).toBe(true);
    expect(
      [...document.querySelectorAll("button")].some((item) => item.textContent === "Set up Run"),
    ).toBe(true);
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
    expect(document.body.textContent).toContain("Test passed");
    expect(document.body.textContent).not.toContain("Draft issue");
  });

  it("restores an available Report destination from the URL", async () => {
    const fake = fakeRunService();
    await renderRun("/runs/run-1?view=evidence", fake.service, platformWithStorage().platform);

    expect(document.body.textContent).toContain("Language settings");
    expect(document.body.textContent).toContain("Test passed");
    expect(document.querySelector('[aria-label="Run evidence"]')).not.toBeNull();
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });

  it("routes durable Run review decisions with the canonical Run identity", async () => {
    const fake = fakeRunService();
    const review = vi.fn().mockResolvedValue({ status: "approved" } as never);
    fake.service.review = review;
    await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);

    await click(button("More run actions"));
    await click(
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent?.trim() === "Review run",
      )!,
    );
    await click(button("Approve run"));
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
      policy: {
        regions: [
          { id: "identity-ignore:reply body:0", name: "reply body", mode: "ignore", frameIndex: 0 },
        ],
      },
    } as never;
    const compareVisual = vi.fn().mockResolvedValue(comparison);
    const approveVisualBaseline = vi.fn().mockResolvedValue({ status: "approved" } as never);
    const reviewVisual = vi.fn().mockResolvedValue({ status: "reviewed" } as never);
    fake.service.compareVisual = compareVisual;
    fake.service.approveVisualBaseline = approveVisualBaseline;
    fake.service.reviewVisual = reviewVisual;
    await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);

    await click(button("Review screenshots"));
    await click(button("Compare screenshots"));
    expect(compareVisual).toHaveBeenCalledWith("run-1");
    expect(document.body.textContent).toContain("Visual changes need review");
    expect(document.body.textContent).toContain("2 changed · 1 added · 0 removed");
    expect(document.body.textContent).toContain("1 ignore region (reply body)");
    expect(document.body.textContent).toContain(
      "Findings Confirm and Reject never accept a visual baseline",
    );

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

    expect(document.body.textContent).not.toContain("Run history");
    await click(button("History"));
    expect(document.body.textContent).toContain("Run history");
    expect(document.body.textContent).toContain("Showing loaded runs. Totals may be incomplete.");
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

    await click(button("History"));
    expect(document.body.textContent).toContain("Run history");
    expect(document.body.textContent).not.toContain("Totals may be incomplete");
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

    expect(document.body.textContent).toContain("Test passed");
    expect(document.body.textContent).not.toContain("Draft issue");
    expect(document.body.textContent).toContain("Evidence details are temporarily unavailable");
    expect(document.body.textContent).toContain("saved outcome above is unchanged");
    expect(document.body.textContent).not.toContain("run-1");
  });

  it("keeps a failed Report compact and opens technical details without expanding the page", async () => {
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

    expect(document.body.textContent).toContain("Could not complete");
    expect(document.body.textContent).not.toContain("The app took too long to respond");
    expect(document.querySelector('button[aria-label="Technical details"]')).not.toBeNull();
    expect(
      document.querySelector<HTMLAnchorElement>('a[href="/debug?runId=run-1"]'),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("ERR_CONNECTION_REFUSED");
    await click(
      document.querySelector<HTMLButtonElement>('button[aria-label="Technical details"]')!,
    );
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Browser connection");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Reconnect the device or browser",
    );
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "ERR_CONNECTION_REFUSED",
    );
    expect(document.body.textContent).not.toContain("Evidence at this point");
    expect(document.querySelector('[role="tab"]')).toBeNull();
  });

  it("exports the attached Run as a TracePack named for that Run", async () => {
    const fake = fakeRunService(runState("succeeded"));
    const created: string[] = [];
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = (blob: Blob) => {
      created.push(blob.type);
      return "blob:relay-run-export";
    };
    try {
      await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);
      await click(button("More run actions"));
      expect(document.body.textContent).toContain("Export evidence");
      if (!document.querySelector('[role="menu"]')) await click(button("More run actions"));
      await click(
        [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
          (item) => item.textContent?.trim() === "Export evidence",
        )!,
      );
      await click(button("Export evidence"));
      expect(fake.calls).toContain("export:run-1");
      const link = document.querySelector<HTMLAnchorElement>('a[download="relay-run-run-1.json"]');
      expect(link).not.toBeNull();
      expect(link?.textContent).toContain("Save evidence pack");
      expect(created).toEqual(["application/json"]);
    } finally {
      URL.createObjectURL = originalCreate;
    }
  });

  it("does not offer a pack from a different Run as this Run's export", async () => {
    const fake = fakeRunService(runState("succeeded"));
    fake.service.exportEvidence = async (runId) =>
      runEvidenceExportDocument(runId, tracePackForRun("run-from-test-B"));
    await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);
    if (!document.querySelector('[role="menu"]')) await click(button("More run actions"));
    await click(
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent?.trim() === "Export evidence",
      )!,
    );
    await click(button("Export evidence"));
    expect(document.body.textContent).toContain("TracePack evidence for a different Run");
    expect(document.querySelector("a[download]")).toBeNull();
  });
});

function tracePackForRun(runId: string): TracePackExportResponse {
  const digest = `sha256:${"a".repeat(64)}`;
  return {
    tracePack: {
      schemaVersion: 1,
      kind: "relay-trace-pack",
      digest,
      createdAt: 1,
      source: {
        runId,
        runSchemaVersion: 5,
        status: "ok",
        action: "test",
        inputDigest: "b".repeat(64),
        writtenAt: 1,
      },
      redaction: { status: "applied-at-persistence", redactedChannels: [] },
      completeness: { status: "complete", channels: {}, missing: [], artifacts: [] },
      objects: [
        {
          path: "run.json",
          kind: "frozen-run",
          mediaType: "application/json",
          encoding: "json",
          digest,
          bytes: 2,
          content: {},
        },
      ],
    },
    analysis: {
      schemaVersion: 1,
      mode: "trace-pack-offline-analysis",
      tracePackDigest: digest,
      sourceRunId: runId,
      historicalVerdict: "failed",
      futureTransitionVerdict: "unknown",
      proved: [],
      unknown: [
        {
          code: "MISSING_EVIDENCE",
          statement: "The fixture has no verified future-device claim.",
          resolution: "Replay the frozen Test on the intended target.",
        },
      ],
      smallestLiveVerification: {
        kind: "replay-frozen-test",
        reason: "Offline export cannot prove a later device.",
        requiresTarget: true,
      },
    },
  };
}
