/** @jsxImportSource react */
import type { ProductRunReport, ProductRunState } from "@relay/product/run-journey";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelayApp } from "../app";
import type { RecordingProductService } from "../data/recording-product-service";
import type { RunAcrossProductService } from "../data/run-across-product-service";
import { runEvidenceExportDocument } from "@relay/product/run-evidence-export";
import type { ProductRunReportOverview, RunProductService } from "../data/run-product-service";
import type { TracePackExportResponse } from "@relay/protocol";
import type { Platform } from "../platform/types";
import type { TestEditorProductService } from "../data/test-editor-product-service";
import { WORKSPACE_DESTINATION_KEY } from "../layout/destination-summary";
import { runConfigurationStorageKey } from "../data/use-persisted-run-configuration";
import { PAIRED_CONFIGURATION_STORAGE_KEY } from "../data/paired-configuration";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const recordingService = {} as RecordingProductService;

beforeEach(() => {
  // Owned services supply fixture data. Shell reads must not reach the
  // developer's service or outlive this test's DOM.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Offline run test fixture")));
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
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
        summary: "See the screens Relay captured while this test ran.",
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

/** The Test page edits steps in place, so it also reads the editor document. */
function fakeEditorService(): TestEditorProductService {
  return {
    get: async (testId) => ({
      appMapId: "settings-language-proof",
      appName: "Settings Language Proof",
      revision: 1,
      test: {
        id: testId,
        organizationId: "local",
        projectId: "default",
        appMapId: "settings-language-proof",
        name: "Change the app language",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [
          {
            id: "step-open",
            kind: "instruction",
            intent: "Open Language settings",
            capture: true,
            binding: { status: "resolved", kind: "connections", connectionIds: ["language"] },
          },
          {
            id: "step-check",
            kind: "validation",
            intent: "Confirm the selected language",
            capture: true,
            binding: {
              status: "resolved",
              kind: "assertion",
              assertion: {
                kind: "content",
                input: "Language",
                expected: "English",
                match: "exact",
              },
            },
          },
          {
            id: "step-finish",
            kind: "instruction",
            intent: "Return to the app",
            binding: { status: "resolved", kind: "connections", connectionIds: ["back"] },
          },
        ],
        createdAt: 1,
        updatedAt: 2,
      },
      history: [],
      repairs: [],
    }),
    edit: async () => {
      throw new Error("Run tests do not edit steps.");
    },
    decideRepair: async () => {
      throw new Error("Run tests do not repair steps.");
    },
  } as TestEditorProductService;
}

describe("recorded test destinations", () => {
  it.each([
    {
      label: "bound app",
      path: "/tests/test-1",
      originApplication: "ai.x.grok",
      startup: { mode: "cold" },
    },
    {
      label: "bound app and recorded destination",
      path: "/tests/test-1?target=emulator-5554",
      originApplication: "ai.x.grok",
      startup: { mode: "cold" },
    },
    {
      label: "no bound app",
      path: "/tests/test-1",
      originApplication: undefined,
      startup: undefined,
    },
  ])(
    "uses the intended initial startup for a fresh Android test with $label",
    async ({ path, originApplication, startup }) => {
      const fake = fakeRunService();
      const editor = fakeEditorService();
      const get = editor.get;
      editor.get = async (...args) => {
        const document = (await get(...args))!;
        return {
          ...document,
          recordedPlatforms: ["android"],
          test: { ...document.test, ...(originApplication ? { originApplication } : {}) },
        };
      };
      await renderRun(path, fake.service, platformWithStorage().platform, undefined, editor);
      await click(button("Run"));
      expect(fake.startInputs).toHaveLength(1);
      expect(fake.startInputs[0]).toMatchObject({ targetId: "emulator-5554" });
      expect((fake.startInputs[0] as { startup?: unknown }).startup).toEqual(startup);
    },
  );

  it.each(["saved warm setup", "explicit restart opt-out"])(
    "preserves %s for an Android test with a bound app",
    async (scenario) => {
      const fake = fakeRunService();
      const editor = fakeEditorService();
      const get = editor.get;
      editor.get = async (...args) => {
        const document = (await get(...args))!;
        return {
          ...document,
          recordedPlatforms: ["android"],
          test: { ...document.test, originApplication: "ai.x.grok" },
        };
      };
      const key = runConfigurationStorageKey({
        server: "http://127.0.0.1:8787",
        appId: "settings-language-proof",
        entity: "test-run:test-1",
      });
      const storage = platformWithStorage(
        scenario === "saved warm setup"
          ? { [key]: JSON.stringify({ targetId: "emulator-5554" }) }
          : {},
      );
      await renderRun(
        scenario === "explicit restart opt-out"
          ? "/tests/test-1"
          : "/tests/test-1?target=emulator-5554",
        fake.service,
        storage.platform,
        undefined,
        editor,
      );
      await openRunSettings();
      const restart = [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].find(
        (input) => input.closest("label")?.textContent?.includes("Restart app before running"),
      );
      expect(restart).toBeDefined();
      if (scenario === "explicit restart opt-out") {
        expect(restart?.getAttribute("aria-checked")).toBe("true");
        await click(restart!.closest("label") ?? restart!);
        expect(JSON.parse(storage.values.get(key)!)).not.toHaveProperty("startupMode");
        await act(async () => roots.pop()!.unmount());
        await renderRun(
          "/tests/test-1?target=emulator-5554",
          fake.service,
          storage.platform,
          undefined,
          editor,
        );
        await openRunSettings();
      }
      const restoredRestart = [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].find(
        (input) => input.closest("label")?.textContent?.includes("Restart app before running"),
      );
      expect(restoredRestart?.getAttribute("aria-checked")).toBe("false");
      await click(button("Run now"));
      expect(fake.startInputs).toHaveLength(1);
      expect((fake.startInputs[0] as { startup?: unknown }).startup).toBeUndefined();
    },
  );

  it("offers an Android reconnect path instead of browsers for a disconnected Android test", async () => {
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
    fake.service.listProfiles = async () => [
      {
        id: "profile-browser",
        name: "Member browser",
        platform: "browser",
        targetId: "browser-golden",
        account: { id: "member", name: "Member" },
      },
    ];
    const editor = fakeEditorService();
    const get = editor.get;
    editor.get = async (...args) => ({ ...(await get(...args))!, recordedPlatforms: ["android"] });
    await renderRun(
      "/tests/test-1?target=disconnected-samsung",
      fake.service,
      platformWithStorage().platform,
      undefined,
      editor,
    );
    await openRunSettings();
    expect(document.body.textContent).toContain("Connect an Android device");
    expect(document.querySelector('button[aria-label="Sign in as"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Android device"]')).toBeNull();
    expect(button("Run now").disabled).toBe(true);
    expect(document.querySelector('#test-run-setup a[href="/devices"]')?.textContent).toContain(
      "View devices",
    );
    expect(fake.startInputs).toHaveLength(0);
  });

  it("does not start a recorded Android test on a ready browser selected in its URL", async () => {
    const fake = fakeRunService();
    const editor = fakeEditorService();
    const get = editor.get;
    editor.get = async (...args) => ({ ...(await get(...args))!, recordedPlatforms: ["android"] });
    await renderRun(
      "/tests/test-1?target=browser-golden",
      fake.service,
      platformWithStorage().platform,
      undefined,
      editor,
    );
    await openRunSettings();
    expect(button("Run now").disabled).toBe(true);
    await selectOption("Android device", "Pixel 9 Pro");
    await click(button("Run now"));
    expect(fake.startInputs).toHaveLength(1);
    expect(fake.startInputs[0]).toMatchObject({ targetId: "emulator-5554" });
  });

  it("blocks a restored browser workspace for a recorded Android test", async () => {
    const fake = fakeRunService();
    const editor = fakeEditorService();
    const get = editor.get;
    editor.get = async (...args) => ({ ...(await get(...args))!, recordedPlatforms: ["android"] });
    const key = runConfigurationStorageKey({
      server: "http://127.0.0.1:8787",
      appId: "settings-language-proof",
      entity: "test-run:test-1",
    });
    const storage = platformWithStorage({
      [key]: JSON.stringify({ usePairedWorkspace: true, targetId: "browser-golden" }),
      [PAIRED_CONFIGURATION_STORAGE_KEY]: JSON.stringify({
        schemaVersion: 1,
        updatedAt: 1,
        rows: [
          {
            id: "guest",
            name: "Guest",
            browserId: "browser-golden",
            browserName: "Checkout browser",
            engine: "chromium",
            signedOutAttested: true,
          },
        ],
      }),
    });
    await renderRun("/tests/test-1", fake.service, storage.platform, undefined, editor);
    expect(button("Run settings menu").textContent).toContain("Run on1 configuration");
    await openRunSettings();
    expect(document.body.textContent).toContain("This saved workspace uses browsers");
    expect(button("Run now").disabled).toBe(true);
    expect(fake.startInputs).toHaveLength(0);
  });
});

function platformWithStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const platform: Platform = {
    platform: "web",
    getServerUrl: () => "http://127.0.0.1:8787",
    // Shell services (activity, counts) must never reach a real server.
    fetch: async () => {
      throw new TypeError("Network is not available in run tests.");
    },
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
  editorService: TestEditorProductService = fakeEditorService(),
) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayApp
        platform={platform}
        history={history}
        productService={recordingService}
        runService={runService}
        runAcrossService={runAcrossService}
        testEditorService={editorService}
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

/** The outcome pill in the full Report header. */
function reportOutcome(): string | undefined {
  return (
    document.querySelector('[role="status"] [data-slot="status-pill"]')?.textContent ?? undefined
  );
}

function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent?.trim() === label ||
      candidate.getAttribute("aria-label") === label ||
      (label === "Run settings menu" &&
        candidate.getAttribute("aria-label")?.startsWith("Run settings:")),
  );
  if (!(result instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
  return result;
}

/** Saved steps in the in-place editor on the Test tab. */
function editorSteps(): HTMLButtonElement[] {
  const list = document.querySelector("#test-steps-title")?.closest("section");
  return [...(list?.querySelectorAll<HTMLButtonElement>("button[aria-pressed]") ?? [])];
}

function editorIsHidden(): boolean {
  return (
    document
      .querySelector("#test-steps-title")
      ?.closest('[role="tabpanel"]')
      ?.hasAttribute("hidden") ?? false
  );
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}

async function openRunSettings() {
  await click(button("Run settings menu"));
  expect(document.querySelector('[role="menuitem"]')).toBeNull();
  expect(document.querySelector('[aria-label="Run settings"]')).not.toBeNull();
}

async function selectOption(label: string, option: string) {
  await click(document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!);
  const item = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((candidate) =>
    candidate.textContent?.trim().includes(option),
  );
  if (!item) throw new Error(`Option not found: ${label} / ${option}`);
  await click(item);
}

describe("Run and report", () => {
  it.each(["passed", "empty", "unavailable"])(
    "keeps unknown history distinct from no runs until it resolves as %s",
    async (result) => {
      const fake = fakeRunService();
      type Runs = Awaited<ReturnType<NonNullable<RunProductService["listTestRuns"]>>>;
      let resolve!: (runs: Runs) => void;
      let reject!: (error: Error) => void;
      const pendingRuns = new Promise<Runs>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      fake.service.listTestRuns = () => pendingRuns;
      await renderRun("/tests/test-1", fake.service, platformWithStorage().platform);
      expect(document.body.textContent).not.toContain("Not run yet");
      expect(document.querySelector('[aria-label="Loading run history"]')).not.toBeNull();
      await act(async () => {
        if (result === "unavailable") reject(new Error("Offline"));
        else
          resolve(
            result === "empty"
              ? []
              : [
                  {
                    id: "run-1",
                    title: "Saved result",
                    action: "saved-test",
                    status: "ok",
                    phase: "completed",
                    outcome: "passed",
                    queuedAt: 1,
                    identity: { runId: "run-1" },
                    links: { self: "/runs/run-1" },
                  },
                ],
          );
      });
      await vi.waitFor(
        async () => {
          await settle();
          expect(document.querySelector('[aria-label="Loading run history"]')).toBeNull();
        },
        { timeout: 5_000 },
      );
      // An empty history shows no status row at all rather than a placeholder verdict.
      if (result === "empty")
        expect(document.querySelector('[aria-label="Test views"]')).toBeNull();
      else
        expect(document.body.textContent).toContain(
          result === "passed" ? "Passed" : "Run history unavailable",
        );
      expect(document.body.textContent).not.toContain("Not run yet");
    },
  );

  it("keeps saved test steps separate from historical evidence and preserves definition selection", async () => {
    const fake = fakeRunService(runState("succeeded"));
    fake.service.listTestRuns = async () => [
      {
        id: "other-failed-run",
        title: "Another run failed",
        action: "saved-test",
        status: "error",
        phase: "completed",
        outcome: "harness-failure",
        queuedAt: 2,
        identity: { runId: "other-failed-run" },
        links: { self: "/runs/other-failed-run" },
      },
    ];
    const { history } = await renderRun(
      "/tests/test-1?run=run-1",
      fake.service,
      platformWithStorage().platform,
    );
    expect(editorSteps()).toHaveLength(3);
    expect(editorIsHidden()).toBe(true);
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "Result",
    );
    expect(document.body.textContent).not.toContain("Last run");
    expect(document.querySelector('a[href="/runs/other-failed-run"]')).toBeNull();
    await click(button("Test"));
    expect(document.body.textContent).toContain("Last run");
    expect(document.querySelector('a[href="/runs/other-failed-run"]')).not.toBeNull();
    const steps = editorSteps();
    expect(steps).toHaveLength(3);
    await click(steps[1]!);
    expect(button("Test").getAttribute("aria-selected")).toBe("true");
    expect(history.location.search).toContain("view=definition");
    expect(history.location.search).toContain("step=step-check");
    await click(button("Result"));
    expect(editorSteps()).toHaveLength(3);
    expect(editorIsHidden()).toBe(true);
    await click(button("Test"));
    expect(history.location.search).toContain("step=step-check");
    expect(
      editorSteps()
        .find((step) => step.textContent?.includes("Confirm the selected language"))
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("offers setup correction instead of retrying unrelated reads after a blocked start", async () => {
    const fake = fakeRunService();
    const start = vi.fn(async () => ({
      status: "failed" as const,
      recovery: {
        code: "compile-blocked" as const,
        title: "Choose another setup",
        detail: "Account unavailable",
        recovery: "Change the saved setup.",
        retryable: true,
      },
    }));
    fake.service.start = start;
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
    await click(button("Run"));
    expect(document.body.textContent).toContain("Choose another setup");
    await click(button("Review run setup"));
    expect(document.body.textContent).not.toContain("Choose another setup");
    expect(start).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('#test-run-setup section[aria-label="Run configuration"]'),
    ).not.toBeNull();
  });

  it("directs unknown start outcomes to status without repeating the start", async () => {
    const fake = fakeRunService();
    const start = vi.fn(async () => ({
      status: "failed" as const,
      recovery: {
        code: "mutation-outcome-unknown" as const,
        title: "Unknown start",
        detail: "Acknowledgement lost",
        recovery: "Inspect before repeating.",
        retryable: true,
      },
    }));
    fake.service.start = start;
    fake.service.listTargets = async () => [
      {
        kind: "device",
        platform: "android",
        targetId: "emulator-5554",
        name: "QA phone",
        detail: "Android emulator",
      },
    ];
    const { history } = await renderRun(
      "/tests/test-1",
      fake.service,
      platformWithStorage().platform,
    );
    await click(button("Run"));
    const link = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
      (item) => item.textContent === "Check run status",
    );
    expect(link).toBeDefined();
    await click(link!);
    expect(history.location.pathname).toBe("/runs");
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("offers step review when saved capture controls block compilation", async () => {
    const fake = fakeRunService();
    fake.service.start = async () => ({
      status: "failed",
      recovery: {
        code: "compile-blocked",
        sourceCode: "raw-evidence-variant-recapture-required",
        title: "The test has 5 compile blockers",
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
    await click(button("Run"));
    expect(document.body.textContent).toContain("Saved controls need review");
    expect(document.body.textContent).not.toContain("restore this work");
    const review = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === "Review steps",
    );
    expect(review).toBeDefined();
  });

  it("opens run settings directly from a library setup link", async () => {
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
    await click(button("Run"));
    expect(String(history.location.search)).not.toContain("setup=run");
    await act(async () => fake.complete());
    await settle();
    expect(document.querySelector("#test-run-setup")).toBeNull();
    expect(document.body.textContent).toContain("Test passed");
  });

  it("selects the only ready target so a test can run immediately", async () => {
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
    expect(button("Run now").disabled).toBe(false);
  });

  it("blocks run when the saved test revision changes after the editor loads", async () => {
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
    const editor = fakeEditorService();
    const getSaved = editor.get.bind(editor);
    let remoteRevision = 1;
    editor.get = async (testId, appMapId) => {
      const document = await getSaved(testId, appMapId);
      return document ? { ...document, revision: remoteRevision } : undefined;
    };
    await renderRun(
      "/tests/test-1",
      fake.service,
      platformWithStorage().platform,
      undefined,
      editor,
    );
    await openRunSettings();
    expect(button("Run now").disabled).toBe(false);

    remoteRevision = 2;
    await click(button("Run now"));
    expect(fake.startInputs).toHaveLength(0);
    expect(document.body.textContent).toContain("saved test changed");
    await click(button("Reload test"));
    await openRunSettings();
    await click(button("Run now"));
    expect(fake.startInputs[0]).toMatchObject({ documentRevision: 2 });
  });

  it("refreshes the owned test after completion so the same flow can run again", async () => {
    const fake = fakeRunService();
    const editor = fakeEditorService();
    const get = editor.get.bind(editor);
    let revision = 1;
    editor.get = async (id, app) => {
      const document = await get(id, app);
      return document ? { ...document, revision } : undefined;
    };
    await renderRun(
      "/tests/test-1?target=browser-golden",
      fake.service,
      platformWithStorage().platform,
      undefined,
      editor,
    );
    await click(button("Run"));
    expect(fake.startInputs[0]).toMatchObject({ documentRevision: 1 });
    revision = 2;
    await act(async () => fake.complete());
    await settle();
    await click(button("Run"));
    expect(fake.startInputs).toHaveLength(2);
    expect(fake.startInputs[1]).toMatchObject({ documentRevision: 2 });
    expect(document.body.textContent).not.toContain("The saved test changed.");
  });

  it("keeps the recording browser over a different workspace destination", async () => {
    const fake = fakeRunService();
    const stored = platformWithStorage({
      [WORKSPACE_DESTINATION_KEY]: JSON.stringify({ targetId: "emulator-5554" }),
    });
    await renderRun("/tests/test-1?target=browser-golden", fake.service, stored.platform);
    await openRunSettings();
    expect(
      document.querySelector<HTMLButtonElement>('button[aria-label="Device or browser"]')
        ?.textContent,
    ).toContain("Checkout browser");
    await click(button("Run now"));
    expect(fake.startInputs[0]).toMatchObject({ targetId: "browser-golden" });
  });

  it.each([
    { buildId: undefined, expanded: false },
    { buildId: "build-android-1", expanded: true },
  ])(
    "shows Advanced options only for an explicit build ($buildId)",
    async ({ buildId, expanded }) => {
      const fake = fakeRunService();
      const storage = platformWithStorage({
        [runConfigurationStorageKey({
          server: "http://127.0.0.1:8787",
          appId: "settings-language-proof",
          entity: "test-run:test-1",
        })]: JSON.stringify({ targetId: "emulator-5554", startupMode: "cold", buildId }),
      });
      await renderRun("/tests/test-1", fake.service, storage.platform);
      await openRunSettings();
      const summary = [...document.querySelectorAll("summary")].find(
        (candidate) => candidate.textContent?.trim() === "Advanced run options",
      )!;
      expect(summary.closest("details")!.open).toBe(expanded);
      const restart = [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].find(
        (input) => input.parentElement?.textContent?.includes("Restart app before running"),
      )!;
      expect(restart.getAttribute("aria-checked")).toBe("true");
      expect(fake.startInputs).toHaveLength(0);
    },
  );

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
    expect(button("Run settings menu").textContent).toContain(
      "Run onCheckout browser · Android QA · Restart app",
    );
    await click(button("Run now"));
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
    await selectOption("Saved setup", "Pixel 9 reviewed");
    await selectOption("Device or browser", "Checkout browser");
    expect(document.body.textContent).toContain("saved for another destination");
    await click(button("Fix setup"));
    expect(fake.startInputs).toHaveLength(0);
  });

  it("returns run setup focus to the header control that opened it", async () => {
    const fake = fakeRunService();
    await renderRun("/tests/test-1", fake.service, platformWithStorage().platform);
    const trigger = button("Run settings menu");
    expect(
      document.querySelector('button[aria-label="Run configuration — opens run setup"]'),
    ).toBeNull();
    await openRunSettings();
    const popup = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Run settings"]',
    )!;
    expect(popup).not.toBeNull();
    expect(popup.getAttribute("data-side")).toBe("bottom");
    await act(async () => {
      popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(document.activeElement).toBe(trigger);
    expect(fake.startInputs).toHaveLength(0);
  });

  it("keeps a saved test browser and profile over workspace and recording defaults", async () => {
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
    await renderRun("/tests/test-1?target=emulator-5554", fake.service, storage.platform);

    // The destination and account must be visible before opening settings;
    // title attributes alone do not establish a useful Run context.
    expect(button("Run settings menu").textContent).toContain("Run onMember · Checkout browser");
    expect(document.querySelector('[role="dialog"][aria-label="Run settings"]')).toBeNull();
    expect(button("Run").title).toContain("Checkout browser · Member · Current build");
    expect(button("Run settings menu").title).toContain(
      "Checkout browser · Member · Current build",
    );
    await openRunSettings();

    // Account repair happens in context and returns to this Test's run setup.
    const repair = document.querySelector<HTMLAnchorElement>('a[href*="returnTo="]');
    expect(repair?.textContent).toContain("Refresh sign-in");
    expect(decodeURIComponent(repair?.getAttribute("href") ?? "")).toContain(
      encodeURIComponent('"kind":"run-setup"'),
    );
    expect(
      document.querySelector<HTMLButtonElement>('button[aria-label="Device or browser"]')
        ?.textContent,
    ).toContain("Checkout browser");
    expect(
      document.querySelector<HTMLButtonElement>('button[aria-label="Sign in as"]')?.textContent,
    ).toContain("Member");
  });

  it("names and binds the sole saved account on the last-used browser before run", async () => {
    const fake = fakeRunService();
    fake.service.listProfiles = async () => [
      {
        id: "profile-admin",
        name: "Admin setup",
        targetId: "browser-golden",
        platform: "browser",
        account: { id: "acct-admin", name: "Admin" },
      },
    ];
    await renderRun(
      "/tests/test-1?target=browser-golden",
      fake.service,
      platformWithStorage().platform,
    );
    expect(button("Run settings menu").textContent).toContain("Admin · Checkout browser");
    expect(button("Run settings menu").getAttribute("aria-label")).toBe(
      "Run settings: Admin · Checkout browser",
    );
    expect(button("Run settings menu").getAttribute("aria-description")).toContain(
      "Run settings: Checkout browser · Admin",
    );
    expect(button("Run").getAttribute("aria-description")).toContain("Admin");
    await openRunSettings();
    expect(document.querySelector('button[aria-label="Sign in as"]')?.textContent).toContain(
      "Admin",
    );
    await click(button("Run now"));
    expect(fake.startInputs[0]).toMatchObject({
      targetId: "browser-golden",
      targetProfileId: "profile-admin",
    });
  });

  it.each([false, true])(
    "shows only a chosen setup without inventing an account (%s)",
    async (chosen) => {
      const fake = fakeRunService();
      fake.service.listProfiles = async () => [
        {
          id: "profile-review",
          name: "Checkout review setup",
          targetId: "browser-golden",
          platform: "browser",
        },
      ];
      const storage = platformWithStorage({
        [runConfigurationStorageKey({
          server: "http://127.0.0.1:8787",
          appId: "settings-language-proof",
          entity: "test-run:test-1",
        })]: JSON.stringify({
          targetId: "browser-golden",
          ...(chosen ? { savedProfileId: "profile-review" } : {}),
        }),
      });
      await renderRun("/tests/test-1?target=browser-golden", fake.service, storage.platform);
      const visible = button("Run settings menu").textContent;
      expect(visible).toContain(
        chosen ? "Run onCheckout review setup · Checkout browser" : "Run onCheckout browser",
      );
      if (!chosen) expect(visible).not.toContain("Checkout review setup");
      expect(visible).not.toContain("Admin");
      expect(visible).not.toContain("Signed out");
      expect(visible).not.toContain("Current build");
      expect(fake.startInputs).toHaveLength(0);
    },
  );

  it("exposes the canonical live run before a slow pointer write finishes", async () => {
    const fake = fakeRunService();
    const stored = platformWithStorage();
    let finishWrite!: () => void;
    const write = stored.platform.storage.set;
    stored.platform.storage.set = (key, value) =>
      key === "activeRunWorkflow"
        ? new Promise<void>((resolve) => {
            finishWrite = () => {
              void write(key, value);
              resolve();
            };
          })
        : write(key, value);
    await renderRun("/tests/test-1?target=browser-golden", fake.service, stored.platform);
    await click(button("Run"));
    expect(stored.values.has("activeRunWorkflow")).toBe(false);
    expect(document.querySelector('a[href="/runs/run-1"]')?.textContent).toContain("View live run");
    await act(async () => finishWrite());
    await settle();
    expect(stored.values.has("activeRunWorkflow")).toBe(true);
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

  it("starts one canonical run, follows progress, and renders only real evidence", async () => {
    const fake = fakeRunService();
    const storage = platformWithStorage();
    const { history } = await renderRun("/tests/test-1", fake.service, storage.platform);

    expect(button("Run").disabled).toBe(false);
    expect(
      document.querySelectorAll(
        'button[aria-label="More test actions"], button[aria-label^="Run settings:"]',
      ),
    ).toHaveLength(2);
    await openRunSettings();
    expect(document.body.textContent).toContain("Checkout browser");
    expect(document.body.textContent).toContain("Pixel 9 Pro");
    expect(document.body.textContent).not.toContain("browser-golden");
    expect(document.body.textContent).not.toContain("emulator-5554");
    expect(document.body.textContent).toContain("Run the test and its screenshots show up here.");
    const savedSteps = editorSteps();
    expect(savedSteps).toHaveLength(3);
    await click(savedSteps[1]!);
    expect(editorSteps()[1]?.getAttribute("aria-pressed")).toBe("true");
    await openRunSettings();
    await selectOption("Device or browser", "Checkout browser");
    expect(button("Run now").disabled).toBe(false);
    await click(button("Run now"));

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
    await click(button("More test actions"));
    expect(document.body.textContent).toContain("Review result");
    expect(document.body.textContent).not.toContain("Investigate this failure");
    expect(document.body.textContent).toMatch(/\d+(?:\.\d+)?\s?s/);
    expect(
      [...document.querySelectorAll('[role="tablist"][aria-label="Test views"] [role="tab"]')].map(
        (tab) => tab.textContent,
      ),
    ).toEqual(["Test", "Result"]);
    expect(storage.values.has("activeRunWorkflow")).toBe(false);

    const fullReport = [...document.querySelectorAll("a")].find((item) =>
      item.textContent?.includes("Review result"),
    );
    if (!fullReport) throw new Error("Review result not found");
    await click(fullReport);
    expect(history.location.pathname).toBe("/runs/run-1");
    expect(reportOutcome()).toBe("Passed");
    expect(document.body.textContent).toContain("Language settings");
    expect(
      document.querySelector<HTMLImageElement>('[data-slot="evidence-image-frame"] img')?.src,
    ).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(fake.calls).not.toContain("raw-evidence:run-1");

    await click(button("More run actions"));
    const auditTrigger = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === "Raw event log",
    )!;
    expect(document.querySelector('[aria-label="Raw evidence JSON"]')).toBeNull();
    await click(auditTrigger);
    expect(fake.calls).toContain("raw-evidence:run-1");
    const rawJson = document.querySelector('[aria-label="Raw evidence JSON"]');
    expect(rawJson?.textContent).toContain('\n  "channels": {\n');
    expect(rawJson?.querySelector('[data-slot="json-token"][data-kind="key"]')?.textContent).toBe(
      '"channels"',
    );
    expect(
      rawJson?.querySelector('[data-slot="json-token"][data-kind="string"]')?.textContent,
    ).toBe('"checkpoint.passed"');
    expect(
      rawJson?.querySelector('[data-slot="json-token"][data-kind="number"]')?.textContent,
    ).toBe("2");
    expect(
      rawJson?.querySelector('[data-slot="json-token"][data-kind="boolean"]')?.textContent,
    ).toBe("true");
    expect(rawJson?.querySelector('[data-slot="json-token"][data-kind="null"]')?.textContent).toBe(
      "null",
    );
    expect(document.body.textContent).toContain("checkpoint.passed");

    await act(async () => history.back());
    await settle();
    expect(history.location.pathname).toBe("/tests/test-1");
  });

  it("keeps a replay on the source report until the person opens its completed result", async () => {
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
    expect(history.location.pathname).toBe("/runs/run-1");
    expect(document.body.textContent).toContain("Replay completed");
    await click(button("View replay result"));
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
    expect(document.body.textContent).toContain("Automation running · Relay controls the target");
  });

  it("surfaces a terminal replay with no report id as an unavailable result", async () => {
    const fake = fakeRunService(runState("succeeded"));
    fake.service.replay = async () => ({ jobId: "job-replay" });
    let finishReplayJob!: (state: { status: string }) => void;
    const readReplayJob = vi.fn(
      () =>
        new Promise<{ status: string }>((resolve) => {
          finishReplayJob = resolve;
        }),
    );
    fake.service.getReplayJob = readReplayJob;

    await renderRun("/runs/run-raw-1", fake.service, platformWithStorage().platform);
    await click(button("Rerun…"));
    await click(button("Start run"));
    await vi.waitFor(() => expect(readReplayJob).toHaveBeenCalledWith("job-replay"));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => finishReplayJob({ status: "ok" }));
    await vi.waitFor(
      async () => {
        await settle();
        expect(document.querySelector('[role="alert"]')?.textContent).toContain(
          "Replay report unavailable",
        );
      },
      { timeout: 3_000 },
    );
    expect(document.body.textContent).not.toContain("Replaying saved steps on the saved target");
  });

  it.each([
    ["error", "Replay failed"],
    ["cancelled", "Replay cancelled"],
  ] as const)(
    "shows the actual %s replay outcome before opening its report",
    async (status, label) => {
      const fake = fakeRunService(runState("succeeded"));
      fake.service.getReplayJob = async () => ({ status, runId: "run-2" });
      const { history } = await renderRun(
        "/runs/run-1?replayJob=job-replay",
        fake.service,
        platformWithStorage().platform,
      );
      expect(document.body.textContent).toContain(label);
      expect(history.location.pathname).toBe("/runs/run-1");
      await click(button("View replay result"));
      expect(history.location.pathname).toBe("/runs/run-2");
    },
  );

  it("reconnects to a replay from the URL without starting another execution", async () => {
    const fake = fakeRunService(runState("succeeded"));
    let starts = 0;
    let reads = 0;
    fake.service.replay = async () => {
      starts += 1;
      return { jobId: "unexpected" };
    };
    fake.service.getReplayJob = async (jobId) => {
      expect(jobId).toBe("job-replay");
      reads += 1;
      if (reads === 1) throw new Error("Connection lost");
      return { status: "running", runId: "run-provisional" };
    };
    const { history } = await renderRun(
      "/runs/run-1?replayJob=job-replay",
      fake.service,
      platformWithStorage().platform,
    );
    expect(document.body.textContent).toContain("Could not check replay progress");
    await click(button("Try again"));
    expect(document.body.textContent).toContain("Automation running");
    expect(document.body.textContent).not.toContain("Could not check replay progress");
    expect(history.location.pathname).toBe("/runs/run-1");
    expect(starts).toBe(0);
  });

  it("keeps failed cancellation recoverable and confirms the stopped replay", async () => {
    const fake = fakeRunService(runState("succeeded"));
    let cancellations = 0;
    let stopped = false;
    fake.service.getReplayJob = async () =>
      stopped ? { status: "cancelled", runId: "run-2" } : { status: "running" };
    fake.service.cancelReplay = async (jobId) => {
      expect(jobId).toBe("job-replay");
      cancellations += 1;
      if (cancellations === 1) throw new Error("Connection lost");
      stopped = true;
    };
    await renderRun(
      "/runs/run-1?replayJob=job-replay",
      fake.service,
      platformWithStorage().platform,
    );
    await click(button("Stop automation"));
    expect(document.body.textContent).toContain("Could not stop the replay");
    expect(document.body.textContent).toContain("Automation running");
    await click(button("Stop automation"));
    expect(document.body.textContent).toContain("Replay cancelled");
    expect(document.body.textContent).not.toContain("Could not stop the replay");
    expect(cancellations).toBe(2);
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

  it("shows live authored steps and a passive device beside an attached running test", async () => {
    const fake = fakeRunService();
    fake.service.liveJob = async () => ({
      status: "running",
      recipeSnapshot: {
        id: "root",
        steps: [
          {
            kind: "module",
            id: "open",
            check: { id: "step-open", title: "Open Language settings" },
          },
          {
            kind: "module",
            id: "check",
            check: { id: "step-check", title: "Confirm selected language" },
          },
        ],
      },
      steps: [
        {
          id: "opening",
          recipeId: "root",
          recipeStepId: "open",
          title: "Run saved test",
          status: "running",
        },
      ],
    });
    const storage = platformWithStorage({
      activeRunWorkflow: JSON.stringify({
        workflowId: "workflow-run-1",
        runId: "run-1",
        testId: "test-1",
      }),
    });
    await renderRun("/tests/test-1?view=run&run=run-1", fake.service, storage.platform);
    const execution = document.querySelector('[aria-label="Run"]')!;
    expect(execution).not.toBeNull();
    expect(execution.querySelector('[aria-current="step"]')?.textContent).toContain(
      "Open Language settings",
    );
    expect(execution.querySelector('[aria-label="Steps"]')?.textContent).toContain(
      "Confirm selected language",
    );
    expect(execution.querySelector('[aria-label="Live device preview"]')).not.toBeNull();
    expect(execution.textContent).not.toContain("Checking Language");
    expect(execution.querySelector("h1")).toBeNull();
    expect(button("Stop").disabled).toBe(false);
    await click(button("Stop"));
    expect(fake.calls).toContain("cancel");
  });

  it("restores an active run from canonical server state without local storage", async () => {
    const fake = fakeRunService();
    fake.service.inspectExecution = async (runId) => {
      fake.calls.push(`execution:${runId}`);
      return workflowless(runState("running", ["inspect", "cancel"]));
    };

    await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);

    expect(fake.calls).not.toContain("restore:run-1");
    expect(fake.calls).toContain("execution:run-1");
    expect(document.body.textContent).toContain("Checking Language");
    expect(document.body.textContent).toContain("Cancel run");
    expect(document.body.textContent).not.toContain("Run unavailable");
  });

  it("keeps an active run scoped while moving test A to test B and back", async () => {
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
    expect(document.body.textContent).toContain("View live run");
    history.push("/tests/test-2");
    await settle();
    expect(document.body.textContent).not.toContain("Checking Language");
    expect(
      document.querySelector(
        'button[aria-label="More test actions"], button[aria-label^="Run settings:"]',
      ),
    ).not.toBeNull();

    history.push("/tests/test-1");
    await settle();
    expect(document.body.textContent).toContain("Checking Language");
  });

  it("restores the URL Run when local storage points at a different run", async () => {
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
    expect(document.body.textContent).not.toContain("Cancel run");
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
    expect(reportOutcome()).toBe("Passed");
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
    expect(reportOutcome()).toBe("Passed");
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
    expect(button("Cancel run").disabled).toBe(false);
    await click(button("Cancel run"));
    expect(fake.calls).toContain("cancel-execution:run-raw-1");
    expect(document.body.textContent).not.toContain("Cancel run");
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
    expect(reportOutcome()).toBe("Passed");
  });

  it("shows only one centered recovery state when an in-progress run disconnects", async () => {
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

    const recovery = document.querySelector('[data-slot="recovery-centered"]');
    expect(recovery).not.toBeNull();
    expect(recovery?.textContent).toContain("Relay is not connected");
    expect(document.body.textContent).not.toContain("Restoring progress");
    expect(document.body.textContent).not.toContain("Loading the run");
    expect(document.querySelector('[data-slot="run-progress"]')).toBeNull();
    const recoveryHeading = document.querySelector("h1");
    expect(recoveryHeading?.classList.contains("sr-only")).toBe(true);
    expect(button("Try again")).not.toBeNull();
  });

  it("attaches an active run to the test instead of starting another", async () => {
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
    await click(button("More test actions"));
    expect(
      [...document.querySelectorAll('[role="menuitem"]')].some((item) =>
        item.textContent?.includes("Run settings"),
      ),
    ).toBe(false);
    await click(button("More test actions"));
    expect(
      [...document.querySelectorAll("a")].some((item) =>
        item.textContent?.includes("View live run"),
      ),
    ).toBe(true);
    expect(history.location.pathname).toBe("/tests/test-1");
    expect(fake.calls.some((call) => call.startsWith("start:"))).toBe(false);

    await act(async () => fake.complete());
    await settle();
    expect(history.location.pathname).toBe("/tests/test-1");
    expect(storage.values.has("activeRunWorkflow")).toBe(false);
    expect(document.body.textContent).toContain("Test passed");
    await click(button("More test actions"));
    expect(
      [...document.querySelectorAll("a")].some((item) =>
        item.textContent?.includes("Review result"),
      ),
    ).toBe(true);
    expect(
      document.querySelector(
        'button[aria-label="More test actions"], button[aria-label^="Run settings:"]',
      ),
    ).not.toBeNull();
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
    await click(button("Cancel run"));

    expect(fake.calls).toContain("cancel");
    expect(reportOutcome()).toBe("Cancelled");
    expect(document.body.textContent).toContain("Pixel 9");
    expect(document.body.textContent).not.toContain("Cancel run");
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
    expect(document.body.textContent).not.toContain("Cancel run");
  });

  it("loads a durable terminal report directly without a local pointer", async () => {
    const fake = fakeRunService();
    const storage = platformWithStorage();
    await renderRun("/runs/run-1", fake.service, storage.platform);

    expect(fake.calls).not.toContain("inspect:workflow-run-1");
    expect(fake.calls).toContain("report:run-1");
    expect(reportOutcome()).toBe("Passed");
    expect(document.body.textContent).not.toContain("Draft issue");
  });

  it("keeps the same header and Passed verdict across run views", async () => {
    const fake = fakeRunService();
    await renderRun("/runs/run-1?reportView=story", fake.service, platformWithStorage().platform);
    const header = () => document.querySelector('[data-slot="test-workspace-header"]')!;
    const markup = () => header().innerHTML.replace(/id="base-ui-[^"]+"/g, 'id="generated"');
    const original = markup();
    expect(header().querySelector('[data-state="passed"]')).not.toBeNull();
    for (const label of ["Steps", "Overview"]) {
      // Steps lives under Details; Overview is a tab.
      const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (item) => item.textContent === label,
      );
      if (tab) await click(tab);
      else {
        await click(document.querySelector<HTMLElement>('[aria-label="More run details"]')!);
        await click(
          [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
            (item) => item.textContent?.trim() === label,
          )!,
        );
      }
      expect(markup()).toBe(original);
      expect(header().querySelector('[data-state="passed"]')).not.toBeNull();
    }
  });

  it("restores an available report destination from the URL", async () => {
    const fake = fakeRunService();
    await renderRun("/runs/run-1?view=evidence", fake.service, platformWithStorage().platform);

    expect(document.body.textContent).toContain("Language settings");
    expect(reportOutcome()).toBe("Passed");
    expect(document.querySelector('[aria-label="Run evidence"]')).not.toBeNull();
    expect(document.querySelector('[role="tablist"][aria-label="Run views"]')).not.toBeNull();
  });

  it("routes durable run review decisions with the canonical run identity", async () => {
    const fake = fakeRunService();
    const review = vi.fn().mockResolvedValue({ status: "approved" } as never);
    fake.service.review = review;
    await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);

    await click(button("More run actions"));
    await click(
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent?.trim() === "Compare with reference…",
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
      "Only a person can change the reference screenshots",
    );

    await click(button("Use as new reference"));
    expect(approveVisualBaseline).toHaveBeenCalledWith({
      runId: "run-1",
      action: "approve-new-baseline",
      note: "Reviewed in Relay",
    });

    await click(button("Keep current reference"));
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

  it("leaves a missing visual baseline pending without Keep baseline", async () => {
    const fake = fakeRunService();
    const comparison = {
      id: "comparison-pending",
      code: "VISUAL_BASELINE_MISSING",
      diff: { changedFrames: 0, addedFrames: 1, removedFrames: 0 },
      policy: { regions: [] },
    } as never;
    const compareVisual = vi.fn().mockResolvedValue(comparison);
    const reviewVisual = vi.fn().mockResolvedValue({ status: "reviewed" } as never);
    fake.service.compareVisual = compareVisual;
    fake.service.reviewVisual = reviewVisual;
    await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);

    await click(button("Review screenshots"));
    await click(button("Compare screenshots"));
    expect(document.body.textContent).toContain("No reference screenshots yet");
    expect(document.body.textContent).toContain("Pick a reference so future runs");
    expect(document.body.textContent).toContain("Only a person can");
    expect(document.body.textContent).not.toContain("Keep current reference");
    await click(button("Leave pending"));
    expect(reviewVisual).toHaveBeenCalledWith({
      runId: "run-1",
      comparisonId: "comparison-pending",
      action: "retry",
      note: "Reviewed in Relay",
    });
  });

  it("loads the original last screenshot in the test preview", async () => {
    const fake = fakeRunService();
    fake.service.listTestRuns = async () =>
      [
        {
          id: "run-1",
          queuedAt: 1,
          finishedAt: 2,
          phase: "completed",
          identity: { runId: "run-1", appMapId: "settings-language-proof" },
          links: { self: "/runs/run-1" },
        },
      ] as never;
    const original = "data:image/png;base64,original-full-resolution";
    const evidence = report();
    evidence.evidence[0]!.items[1]!.media!.src = original;
    fake.service.getReport = async () => evidence;
    await renderRun("/tests/test-1?view=definition", fake.service, platformWithStorage().platform);
    expect(
      document.querySelector<HTMLImageElement>('img[alt="Last screen of the latest run"]')?.src,
    ).toBe(original);
  });

  it("labels test reliability as partial while loaded run history is incomplete", async () => {
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
    await click(button("More test actions"));
    const historyAction = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Run history",
    );
    if (!historyAction) throw new Error("Run history action not found");
    await click(historyAction);
    expect(document.body.textContent).toContain("Run history");
    expect(document.body.textContent).toContain("Showing loaded runs. Totals may be incomplete.");
  });

  it("labels test reliability complete only when the explicit complete-history read is available", async () => {
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

    await click(button("More test actions"));
    const historyAction = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Run history",
    );
    if (!historyAction) throw new Error("Run history action not found");
    await click(historyAction);
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

    expect(reportOutcome()).toBe("Passed");
    expect(document.body.textContent).not.toContain("Draft issue");
    expect(document.body.textContent).toContain("Evidence details are temporarily unavailable");
    expect(document.body.textContent).toContain("saved outcome above is unchanged");
    expect(document.body.textContent).not.toContain("run-1");
  });

  it("keeps a failed report compact and opens technical details without expanding the page", async () => {
    const fake = fakeRunService();
    fake.service.getReport = async () => ({
      runId: "run-1",
      title: "Change the app language",
      outcome: "harness-failure",
      targetName: "Golden Chromium",
      cause:
        "page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173\nCall log:\n - navigating",
      category: "Browser connection",
      timeline: [],
      evidence: [],
    });
    await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);

    expect(document.body.textContent).toContain("Could not complete");
    expect(document.body.textContent).not.toContain("The app took too long to respond");
    expect(document.querySelector('button[aria-label="Technical details"]')).not.toBeNull();
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
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "Overview",
    );
  });

  it("returns to the selected Review screenshot even when the run has no test", async () => {
    const fake = fakeRunService();
    const { history } = await renderRun(
      "/runs/run-1?returnTo=" +
        encodeURIComponent("/review?item=run-1%3A%3Acapture-2&filter=new&app=app-1"),
      fake.service,
      platformWithStorage().platform,
    );
    const back = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.textContent?.trim() === "Review",
    )!;
    expect(back).toBeDefined();
    await click(back);
    expect(history.location.pathname).toBe("/review");
    expect(history.location.search).toContain("capture-2");
    expect(history.location.search).toContain("filter=new");
    expect(history.location.search).toContain("app=app-1");
  });

  it("returns to runs with its filters even when the run belongs to a test", async () => {
    const fake = fakeRunService();
    fake.service.getReport = async () => ({ ...report(), testId: "test-1" });
    const { history } = await renderRun(
      "/runs/run-1?returnTo=" + encodeURIComponent("/runs?view=failed&q=checkout&app=app-1"),
      fake.service,
      platformWithStorage().platform,
    );
    const back = [...document.querySelectorAll<HTMLAnchorElement>("main a")].find(
      (link) => link.textContent?.trim() === "Runs",
    )!;
    await click(back);
    expect(history.location.pathname).toBe("/runs");
    expect(String(history.location.search)).toContain("view=failed");
    expect(String(history.location.search)).toContain("checkout");
    expect(String(history.location.search)).toContain("app=app-1");
  });

  it("returns from the run to the test with its plan context", async () => {
    const fake = fakeRunService();
    fake.service.getReport = async () => ({ ...report(), testId: "test-1" });
    const { history } = await renderRun(
      "/runs/run-1?plan=suite-1&planApp=app-1&app=app-1",
      fake.service,
      platformWithStorage().platform,
    );
    const back = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.textContent?.trim() === "Test",
    )!;
    await click(back);
    expect(history.location.pathname).toBe("/tests/test-1");
    expect(String(history.location.search)).toContain("plan=suite-1");
    expect(String(history.location.search)).toContain("planApp=app-1");
    expect(String(history.location.search)).toContain("view=definition");
  });

  it("opens configuration directly when setting up another run", async () => {
    const fake = fakeRunService();
    fake.service.getReport = async () => ({ ...report(), testId: "test-1" });
    const { history } = await renderRun(
      "/runs/run-1",
      fake.service,
      platformWithStorage().platform,
    );
    await click(button("More run actions"));
    const setup = [...document.querySelectorAll<HTMLElement>("a,button")].find(
      (item) => item.textContent?.trim() === "Change run settings…",
    );
    if (!setup) throw new Error("Change run settings action not found");
    await click(setup);
    expect(history.location.pathname).toBe("/tests/test-1");
    expect(String(history.location.search)).toContain("setup=run");
    expect(document.querySelector("#test-run-setup")).not.toBeNull();
    expect(fake.calls.some((call) => call.startsWith("start:"))).toBe(false);
  });

  it("exports the attached run as a TracePack named for that run", async () => {
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
      expect(document.body.textContent).toContain("Download all files");
      if (!document.querySelector('[role="menu"]')) await click(button("More run actions"));
      await click(
        [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
          (item) => item.textContent?.trim() === "Download all files",
        )!,
      );
      await click(button("Prepare download"));
      expect(fake.calls).toContain("export:run-1");
      const link = document.querySelector<HTMLAnchorElement>('a[download="relay-run-run-1.json"]');
      expect(link).not.toBeNull();
      expect(link?.textContent).toContain("Save files");
      expect(created).toEqual(["application/json"]);
    } finally {
      URL.createObjectURL = originalCreate;
    }
  });

  it("does not offer a pack from a different run as this run's export", async () => {
    const fake = fakeRunService(runState("succeeded"));
    fake.service.exportEvidence = async (runId) =>
      runEvidenceExportDocument(runId, tracePackForRun("run-from-test-B"));
    await renderRun("/runs/run-1", fake.service, platformWithStorage().platform);
    if (!document.querySelector('[role="menu"]')) await click(button("More run actions"));
    await click(
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent?.trim() === "Download all files",
      )!,
    );
    await click(button("Prepare download"));
    expect(document.body.textContent).toContain("TracePack evidence for a different run");
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
          resolution: "Replay the frozen test on the intended target.",
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
