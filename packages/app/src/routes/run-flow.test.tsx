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

describe("recorded Test destinations", () => {
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
    "uses the intended initial startup for a fresh Android Test with $label",
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
    "preserves %s for an Android Test with a bound app",
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

  it("offers an Android reconnect path instead of browsers for a disconnected Android Test", async () => {
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

  it("does not start a recorded Android Test on a ready browser selected in its URL", async () => {
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

  it("blocks a restored browser workspace for a recorded Android Test", async () => {
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

describe("Run and Report", () => {
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
      expect(document.body.textContent).toContain(
        result === "passed"
          ? "Passed"
          : result === "empty"
            ? "Not run yet"
            : "Run history unavailable",
      );
      if (result !== "empty") expect(document.body.textContent).not.toContain("Not run yet");
    },
  );

  it("keeps saved Test steps separate from historical evidence and preserves definition selection", async () => {
    const fake = fakeRunService(runState("succeeded"));
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
    await click(button("Test"));
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
    await click(button("Run"));
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
    await click(button("Run"));
    expect(String(history.location.search)).not.toContain("setup=run");
    await act(async () => fake.complete());
    await settle();
    expect(document.querySelector("#test-run-setup")).toBeNull();
    expect(document.body.textContent).toContain("Test passed");
  });

  it("shows an actionable empty state when a saved data dimension has no values", async () => {
    const dimensions = [{ id: "language", name: "Language", kind: "language", values: [] }];
    const fake = fakeRunService();
    const preview = vi.fn();
    const runAcross = {
      getSetup: vi.fn(async () => ({
        appMapId: "settings-language-proof",
        appMapRevision: 1,
        testId: "test-1",
        testName: "Change the app language",
        appName: "Settings Language Proof",
        dataSet: { name: "Default data", dimensions },
      })),
      preview,
    } as unknown as RunAcrossProductService;
    await renderRun(
      "/tests/test-1/run-across",
      fake.service,
      platformWithStorage().platform,
      runAcross,
    );
    expect(document.body.textContent).toContain("This data set has no values yet");
    expect(document.querySelector('[aria-label="Search values"]')).toBeNull();
    expect(document.querySelector('[aria-label="Run configuration"]')).toBeNull();
    const link = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
      (item) => item.textContent === "Run this Test once",
    );
    expect(link?.getAttribute("href")).toContain("/tests/test-1?setup=run");
    expect(preview).not.toHaveBeenCalled();
  });

  it("keeps colliding Test IDs scoped to the selected App through setup, cache, and return links", async () => {
    const fake = fakeRunService();
    const original = await fake.service.getTest("test-1");
    const getTest = vi.fn(async (id: string, app?: string) => ({
      ...original!,
      id,
      appMapId: app!,
      name: `${app} Test`,
    }));
    fake.service.getTest = getTest;
    const getSetup = vi.fn(async (appMapId: string, testId: string) => ({
      appMapId,
      appMapRevision: 1,
      testId,
      testName: `${appMapId} Test`,
      appName: appMapId,
      dataSet: { name: "Languages", dimensions: [] },
    }));
    const runAcross = {
      getSetup,
      preview: vi.fn(),
      startPilot: vi.fn(),
    } as unknown as RunAcrossProductService;
    const { history } = await renderRun(
      "/tests/test-1/run-across?app=first-app",
      fake.service,
      platformWithStorage().platform,
      runAcross,
    );
    expect(getTest).toHaveBeenCalledWith("test-1", "first-app");
    expect(getSetup).toHaveBeenCalledWith("first-app", "test-1");
    expect(
      document.querySelector<HTMLAnchorElement>('nav[aria-label="Breadcrumb"] a')?.href,
    ).toContain("app=first-app");
    expect(
      document.querySelector<HTMLAnchorElement>('nav[aria-label="Breadcrumb"] a[href*="test-1"]')
        ?.href,
    ).toContain("app=first-app");
    expect(document.querySelector<HTMLAnchorElement>('a[href*="setup=run"]')?.href).toContain(
      "app=first-app",
    );
    await act(async () => history.push("/tests/test-1/run-across?app=second-app"));
    await settle();
    expect(getTest).toHaveBeenCalledWith("test-1", "second-app");
    expect(getSetup).toHaveBeenCalledWith("second-app", "test-1");
    expect(document.body.textContent).toContain("second-app Test");
    expect(document.querySelector<HTMLAnchorElement>('a[href*="setup=run"]')?.href).toContain(
      "app=second-app",
    );
  });

  it.each(["empty", "missing-account", "profiles-offline"])(
    "blocks %s saved pairs instead of using the remembered ordinary target",
    async (problem) => {
      const fake = fakeRunService();
      fake.service.listProfiles = async () => {
        if (problem === "profiles-offline") throw new Error("Profiles offline");
        return [];
      };
      const preview = vi.fn(() => ({ caseCount: 1, scopeLabel: "Wrong fallback" }));
      const startPilot = vi.fn();
      const runAcross = {
        getSetup: async () => ({
          appMapId: "settings-language-proof",
          appMapRevision: 1,
          testId: "test-1",
          testName: "Language",
          appName: "Settings",
          dataSet: {
            name: "Languages",
            dimensions: [
              { id: "language", name: "Language", values: [{ id: "en", label: "English" }] },
            ],
          },
        }),
        preview,
        startPilot,
      } as unknown as RunAcrossProductService;
      const key = runConfigurationStorageKey({
        server: "http://127.0.0.1:8787",
        appId: "settings-language-proof",
        entity: "test:test-1",
      });
      await renderRun(
        "/tests/test-1/run-across",
        fake.service,
        platformWithStorage({
          [key]: JSON.stringify({
            usePairedWorkspace: true,
            targetProfileId: "emulator-5554",
            dataSetIds: [JSON.stringify(["language", "en"])],
          }),
          [PAIRED_CONFIGURATION_STORAGE_KEY]: JSON.stringify({
            schemaVersion: 1,
            updatedAt: 1,
            rows:
              problem === "empty"
                ? []
                : [
                    {
                      id: "missing-row",
                      name: "Member",
                      browserId: "browser-golden",
                      browserName: "Checkout browser",
                      engine: "chromium",
                      accountId: "missing",
                      accountRevision: "1",
                    },
                  ],
          }),
        }).platform,
        runAcross,
      );
      if (problem === "profiles-offline") {
        await vi.waitFor(
          async () => {
            await settle();
            expect(document.body.textContent).toContain("Browser and Account pairs unavailable");
          },
          { timeout: 3_000 },
        );
      }
      expect(document.body.textContent).toContain("Browser and Account pairs unavailable");
      expect(document.body.textContent).toContain(
        problem === "empty"
          ? "Save at least one Browser and Account pair."
          : problem === "profiles-offline"
            ? "Saved Browser profiles are unavailable."
            : "Relay has no saved profile for this Browser and Account pair.",
      );
      expect(button("Run selected cases").disabled).toBe(true);
      expect(preview).not.toHaveBeenCalled();
      await click(button("Run selected cases"));
      expect(startPilot).not.toHaveBeenCalled();
    },
  );

  it("asks for saved pairs when Run Across has no data and one browser is chosen", async () => {
    const fake = fakeRunService();
    const preview = vi.fn((input) => ({
      selected: input.selected,
      target: input.target,
      caseCount: 1,
      pilot: {},
      scopeLabel: "1 case on Checkout browser",
    }));
    const startPilot = vi.fn(() => new Promise<never>(() => {}));
    const runAcross = {
      getSetup: async () => ({
        appMapId: "settings-language-proof",
        appMapRevision: 1,
        testId: "test-1",
        testName: "Change the app language",
        appName: "Settings Language Proof",
        dataSet: { name: "Default data", dimensions: [] },
      }),
      preview,
      startPilot,
    } as unknown as RunAcrossProductService;
    await renderRun(
      "/tests/test-1/run-across",
      fake.service,
      platformWithStorage().platform,
      runAcross,
    );
    await selectOption("Device or browser", "Checkout browser");
    expect(preview).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Choose saved Browser and Account pairs here");
    expect(
      [...document.querySelectorAll<HTMLAnchorElement>("a")]
        .find((item) => item.textContent?.trim() === "Run once from Test")
        ?.getAttribute("href"),
    ).toContain("/tests/test-1?setup=run");
    expect(button("Run selected cases").disabled).toBe(true);
    expect(startPilot).not.toHaveBeenCalled();
  });

  it("opens an existing Batch when starting selected cases finds one already running", async () => {
    const fake = fakeRunService();
    const startPilot = vi.fn(async () => {
      throw Object.assign(new Error("This Plan is already running"), {
        body: { code: "ACTIVE_REPEAT_EXISTS", repeatId: "batch-existing" },
      });
    });
    const runAcross = {
      getSetup: async () => ({
        appMapId: "settings-language-proof",
        appMapRevision: 1,
        testId: "test-1",
        testName: "Change the app language",
        appName: "Settings Language Proof",
        dataSet: {
          name: "Languages",
          dimensions: [
            {
              id: "language",
              name: "Language",
              values: [{ id: "en", label: "English" }],
            },
          ],
        },
      }),
      preview: () => ({ caseCount: 1, scopeLabel: "1 selected case" }),
      startPilot,
    } as unknown as RunAcrossProductService;
    await renderRun(
      "/tests/test-1/run-across",
      fake.service,
      platformWithStorage().platform,
      runAcross,
    );
    await selectOption("Device or browser", "Checkout browser");
    const value = document.querySelector<HTMLElement>(
      '[aria-label="Available values"] [role="checkbox"]',
    );
    if (!value) throw new Error("English value missing");
    await click(value.closest("label") ?? value);
    await click(button("Run selected case"));
    expect(startPilot).toHaveBeenCalledTimes(1);
    expect(
      [...document.querySelectorAll<HTMLAnchorElement>("a")]
        .find((link) => link.textContent?.trim() === "Open existing result")
        ?.getAttribute("href"),
    ).toBe("/batches/batch-existing");
  });

  it("waits for every data dimension and uses the selected target", async () => {
    const fake = fakeRunService(runState("running", ["inspect"]));
    const preview = vi.fn((input) => ({
      selected: input.selected,
      target: input.target,
      caseCount: 1,
      pilot: {},
      scopeLabel: `1 case on ${input.target.label}`,
    }));
    const startPilot = vi.fn(() => new Promise<never>(() => {}));
    const runAcross = {
      startPilot,
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
      platformWithStorage({
        [runConfigurationStorageKey({
          server: "http://127.0.0.1:8787",
          appId: "settings-language-proof",
          entity: "test:test-1",
        })]: JSON.stringify({ usePairedWorkspace: false }),
      }).platform,
      runAcross,
    );
    await selectOption("Device or browser", "Checkout browser");
    expect(preview).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Choose a value for Language, Region.");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(button("Run selected cases").disabled).toBe(true);

    const values = [
      ...document.querySelectorAll<HTMLElement>(
        '[aria-label="Available values"] [role="checkbox"]',
      ),
    ];
    expect(values).toHaveLength(2);
    await click(values[0]!.closest("label") ?? values[0]!);
    expect(preview).not.toHaveBeenCalled();
    expect(values[0]?.getAttribute("aria-checked")).toBe("true");

    await click(values[1]!.closest("label") ?? values[1]!);
    expect(values[1]?.getAttribute("aria-checked")).toBe("true");
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview.mock.calls[0]?.[0].target.label).toBe("Checkout browser");
    expect(document.body.textContent).toContain("1 case on Checkout browser");
    await click(button("Run selected case"));
    expect(startPilot).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ label: "Checkout browser" }),
        executionMode: "all",
      }),
    );
  });

  it.each([
    {
      name: "selected data",
      dimensions: [
        {
          id: "language",
          name: "Language",
          values: [
            { id: "en", label: "English" },
            { id: "pt", label: "Português" },
          ],
        },
      ],
      caseCount: 4,
      selected: { language: ["en", "pt"] },
    },
    { name: "no saved data", dimensions: [], caseCount: 2, selected: {} },
  ])("runs $name across the exact saved Browser and Account pairs", async (scenario) => {
    const fake = fakeRunService(runState("running", ["inspect"]));
    fake.service.listProfiles = async () => [
      {
        id: "admin-profile",
        targetId: "browser-golden",
        platform: "browser",
        name: "Admin",
        account: { id: "admin", name: "Admin" },
      },
      {
        id: "member-profile",
        targetId: "browser-golden",
        platform: "browser",
        name: "Member",
        account: { id: "member", name: "Member" },
      },
    ];
    const preview = vi.fn((input) => ({
      selected: input.selected,
      target: input.target,
      caseCount: scenario.caseCount,
      pilot: scenario.dimensions.length ? { language: "en" } : {},
      scopeLabel: `${scenario.caseCount} cases across 2 saved Browser and Account pairs`,
    }));
    const startPilot = vi.fn(() => new Promise<never>(() => {}));
    const runAcross = {
      getSetup: async () => ({
        appMapId: "settings-language-proof",
        appMapRevision: 3,
        testId: "test-1",
        testName: "Change the app language",
        appName: "Settings Language Proof",
        dataSet: { name: "Languages", dimensions: scenario.dimensions },
      }),
      preview,
      startPilot,
    } as unknown as RunAcrossProductService;
    const storageKey = runConfigurationStorageKey({
      server: "http://127.0.0.1:8787",
      appId: "settings-language-proof",
      entity: "test:test-1",
    });
    await renderRun(
      "/tests/test-1/run-across",
      fake.service,
      platformWithStorage({
        [storageKey]: JSON.stringify({ usePairedWorkspace: true }),
        [PAIRED_CONFIGURATION_STORAGE_KEY]: JSON.stringify({
          schemaVersion: 1,
          updatedAt: 1,
          rows: [
            {
              id: "admin-row",
              name: "Admin desktop",
              browserId: "browser-golden",
              browserName: "Checkout browser",
              engine: "chromium",
              accountId: "admin",
              accountRevision: "1",
            },
            {
              id: "member-row",
              name: "Member desktop",
              browserId: "browser-golden",
              browserName: "Checkout browser",
              engine: "chromium",
              accountId: "member",
              accountRevision: "2",
            },
          ],
        }),
      }).platform,
      runAcross,
    );
    expect(document.body.textContent).toContain("Admin desktop · Member desktop");
    expect(document.querySelector('button[aria-label="Device or browser"]')).toBeNull();
    const choices = [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].filter(
      (item) => item.closest("label")?.textContent?.match(/English|Português/u),
    );
    expect(choices).toHaveLength(scenario.dimensions.length ? 2 : 0);
    if (scenario.dimensions.length) {
      await click(choices[0]!.closest("label")!);
      await click(choices[1]!.closest("label")!);
    }
    expect(preview.mock.calls.at(-1)?.[0].selected).toEqual(scenario.selected);
    expect(
      preview.mock.calls
        .at(-1)?.[0]
        .profileTargets.map((item: { profileId: string }) => item.profileId),
    ).toEqual(["admin-profile", "member-profile"]);
    await click(button(`Run ${scenario.caseCount} selected cases`));
    expect(startPilot).toHaveBeenCalledWith(
      expect.objectContaining({
        executionMode: "all",
        profileTargets: expect.arrayContaining([
          expect.objectContaining({ profileId: "admin-profile" }),
          expect.objectContaining({ profileId: "member-profile" }),
        ]),
      }),
    );
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
    expect(button("Run now").disabled).toBe(false);
  });

  it("blocks Run when the saved Test revision changes after the editor loads", async () => {
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
    expect(document.body.textContent).toContain("saved Test changed");
    await click(button("Reload Test"));
    await openRunSettings();
    await click(button("Run now"));
    expect(fake.startInputs[0]).toMatchObject({ documentRevision: 2 });
  });

  it("refreshes the owned Test after completion so the same flow can run again", async () => {
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
    expect(document.body.textContent).not.toContain("The saved Test changed.");
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

  it("keeps a saved Test browser and profile over workspace and recording defaults", async () => {
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

  it("names and binds the sole saved account on the last-used browser before Run", async () => {
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

  it("exposes the canonical live Run before a slow pointer write finishes", async () => {
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

  it("starts one canonical Run, follows progress, and renders only real evidence", async () => {
    const fake = fakeRunService();
    const storage = platformWithStorage();
    const { history } = await renderRun("/tests/test-1", fake.service, storage.platform);

    expect(button("Run").disabled).toBe(false);
    expect(
      document.querySelectorAll(
        'button[aria-label="More Test actions"], button[aria-label^="Run settings:"]',
      ),
    ).toHaveLength(2);
    await openRunSettings();
    expect(document.body.textContent).toContain("Checkout browser");
    expect(document.body.textContent).toContain("Pixel 9 Pro");
    expect(document.body.textContent).not.toContain("browser-golden");
    expect(document.body.textContent).not.toContain("emulator-5554");
    expect(document.body.textContent).toContain("Run the Test and its screenshots show up here.");
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
    await click(button("More Test actions"));
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
    expect(document.body.textContent).toContain("Test passed");
    expect(document.body.textContent).toContain("Language settings");
    expect(
      document.querySelector<HTMLImageElement>('[data-slot="evidence-image-frame"] img')?.src,
    ).toBe("data:image/png;base64,iVBORw0KGgo=");
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

  it("shows live authored steps and a passive device beside an attached running Test", async () => {
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
          title: "Run saved Test",
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
    expect(document.body.textContent).toContain("View live run");
    history.push("/tests/test-2");
    await settle();
    expect(document.body.textContent).not.toContain("Checking Language");
    expect(
      document.querySelector(
        'button[aria-label="More Test actions"], button[aria-label^="Run settings:"]',
      ),
    ).not.toBeNull();

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

    const recovery = document.querySelector('[data-slot="recovery-centered"]');
    expect(recovery).not.toBeNull();
    expect(recovery?.textContent).toContain("Relay is not connected");
    expect(document.body.textContent).not.toContain("Restoring progress");
    expect(document.body.textContent).not.toContain("Loading the Run");
    expect(document.querySelector('[data-slot="run-progress"]')).toBeNull();
    const recoveryHeading = document.querySelector("h1");
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
    await click(button("More Test actions"));
    expect(
      [...document.querySelectorAll('[role="menuitem"]')].some((item) =>
        item.textContent?.includes("Run settings"),
      ),
    ).toBe(false);
    await click(button("More Test actions"));
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
    await click(button("More Test actions"));
    expect(
      [...document.querySelectorAll("a")].some((item) =>
        item.textContent?.includes("Review result"),
      ),
    ).toBe(true);
    expect(
      document.querySelector(
        'button[aria-label="More Test actions"], button[aria-label^="Run settings:"]',
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

  it("keeps the same header and Passed verdict across run views", async () => {
    const fake = fakeRunService();
    await renderRun("/runs/run-1?reportView=story", fake.service, platformWithStorage().platform);
    const header = () => document.querySelector('[data-slot="test-workspace-header"]')!;
    const markup = () => header().innerHTML.replace(/id="base-ui-[^"]+"/g, 'id="generated"');
    const original = markup();
    expect(header().querySelector('[data-state="passed"]')).not.toBeNull();
    for (const label of ["Steps", "Overview"]) {
      const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (item) => item.textContent === label,
      )!;
      await click(tab);
      expect(markup()).toBe(original);
      expect(header().querySelector('[data-state="passed"]')).not.toBeNull();
    }
  });

  it("restores an available Report destination from the URL", async () => {
    const fake = fakeRunService();
    await renderRun("/runs/run-1?view=evidence", fake.service, platformWithStorage().platform);

    expect(document.body.textContent).toContain("Language settings");
    expect(document.body.textContent).toContain("Test passed");
    expect(document.querySelector('[aria-label="Run evidence"]')).not.toBeNull();
    expect(document.querySelector('[role="tablist"][aria-label="Run views"]')).not.toBeNull();
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
    expect(document.body.textContent).toContain("No approved visual baseline");
    expect(document.body.textContent).toContain("This compare stays pending");
    expect(document.body.textContent).toContain("Agents cannot approve");
    expect(document.body.textContent).not.toContain("Keep baseline");
    await click(button("Leave pending"));
    expect(reviewVisual).toHaveBeenCalledWith({
      runId: "run-1",
      comparisonId: "comparison-pending",
      action: "retry",
      note: "Reviewed in Relay",
    });
  });

  it("loads the original last screenshot in the Test preview", async () => {
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
    await click(button("More Test actions"));
    const historyAction = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Run history",
    );
    if (!historyAction) throw new Error("Run history action not found");
    await click(historyAction);
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

    await click(button("More Test actions"));
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
        "page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173\nCall log:\n - navigating",
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
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "Overview",
    );
  });

  it("returns to the selected Review screenshot even when the run has no Test", async () => {
    const fake = fakeRunService();
    const { history } = await renderRun(
      "/runs/run-1?returnTo=" +
        encodeURIComponent("/review?item=run-1%3A%3Acapture-2&filter=new&app=app-1"),
      fake.service,
      platformWithStorage().platform,
    );
    const back = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.textContent?.trim() === "Back",
    )!;
    expect(back).toBeDefined();
    await click(back);
    expect(history.location.pathname).toBe("/review");
    expect(history.location.search).toContain("capture-2");
    expect(history.location.search).toContain("filter=new");
    expect(history.location.search).toContain("app=app-1");
  });

  it("returns to Runs with its filters even when the run belongs to a Test", async () => {
    const fake = fakeRunService();
    fake.service.getReport = async () => ({ ...report(), testId: "test-1" });
    const { history } = await renderRun(
      "/runs/run-1?returnTo=" + encodeURIComponent("/runs?view=failed&q=checkout&app=app-1"),
      fake.service,
      platformWithStorage().platform,
    );
    const back = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.textContent?.trim() === "Back",
    )!;
    await click(back);
    expect(history.location.pathname).toBe("/runs");
    expect(String(history.location.search)).toContain("view=failed");
    expect(String(history.location.search)).toContain("checkout");
    expect(String(history.location.search)).toContain("app=app-1");
  });

  it("returns from the run to the Test with its plan context", async () => {
    const fake = fakeRunService();
    fake.service.getReport = async () => ({ ...report(), testId: "test-1" });
    const { history } = await renderRun(
      "/runs/run-1?plan=suite-1&planApp=app-1&app=app-1",
      fake.service,
      platformWithStorage().platform,
    );
    const back = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.textContent?.trim() === "Back",
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
      (item) => item.textContent?.trim() === "Set up another run",
    );
    if (!setup) throw new Error("Set up another run action not found");
    await click(setup);
    expect(history.location.pathname).toBe("/tests/test-1");
    expect(String(history.location.search)).toContain("setup=run");
    expect(document.querySelector("#test-run-setup")).not.toBeNull();
    expect(fake.calls.some((call) => call.startsWith("start:"))).toBe(false);
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
