import type { AppResourcesProductService } from "../data/app-resources-product-service";
/** @jsxImportSource react */
import {
  reviewAndroidTalkBack,
  type AuthoringRecordingEdit,
  type AuthoringSession,
} from "@relay/protocol";
import { createProductRecordingJourney } from "@relay/product/recording-journey";
import { createRelayRecordingOutcomeJobs } from "@relay/workflows/recording-outcomes";
import { focusManager } from "@tanstack/react-query";
import * as queryClients from "../data/query-client";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelayApp } from "../app";
import type {
  ProductRecordingState,
  RecordingProductService,
} from "../data/recording-product-service";
import type { LiveTargetSession } from "../data/live-target-session";
import { rememberRecordingInto } from "../data/record-into-test";
import { RecordingInputNotSentError } from "../data/recording-input-outcome";
import { ApiError, RelayClient } from "@relay/client";
import type { DeviceProductService } from "../data/device-product-service";
import type { MapProductService } from "../data/map-product-service";
import type { Platform } from "../platform/types";
import type {
  BrowserSpacesProductService,
  ProductBrowserSpace,
} from "../data/browser-spaces-product-service";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const target = { kind: "device", platform: "android", targetId: "emulator-5554" } as const;
const roots: Root[] = [];
const emptyBrowserSpaces = {
  listSpaces: async () => [],
} as unknown as BrowserSpacesProductService;
const emptyAppResources = {
  createApp: async (name: string) => ({ id: name, name }),
  listBrowserAccounts: async () => [],
  listBrowserTargets: async () => [],
} satisfies AppResourcesProductService;

beforeEach(() => {
  // The journey services are in-memory fakes. Shell queries must not contact a
  // live Relay server whose response can outlive happy-dom's test window.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline test fixture")));
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
});

function state(
  stage: NonNullable<ProductRecordingState["snapshot"]>["stage"],
  actions: NonNullable<ProductRecordingState["snapshot"]>["allowedNextActions"],
  options: { replay?: "passed" | "failed"; committed?: boolean } = {},
): ProductRecordingState {
  const reviewing = stage === "reviewing";
  return {
    status: stage === "committed" ? "saved" : reviewing ? "reviewing" : "recording",
    targets: [target],
    selectedTarget: target,
    snapshot: {
      schemaVersion: 1,
      kind: "author-test",
      title: "Change the app language",
      phase: stage === "committed" ? "succeeded" : "running",
      stage,
      version: `state-${stage}-${options.replay ?? "none"}`,
      workflow: { workflowId: "workflow-1", expectedVersion: 4 },
      frozen: {
        title: "Change the app language",
        actorId: "human:test",
        appMapId: "app-1",
        appMapRevision: 2,
        target,
      },
      authoring: {
        sessionId: "recording-1",
        ...(options.committed ? { committedTestId: "test-1" } : {}),
      },
      ...(reviewing
        ? {
            review: {
              actionCount: 2,
              actions: [
                {
                  id: "step-1",
                  intent: "Open Settings",
                  stepCount: 1,
                  proofStatus: "verified" as const,
                  evidence: [
                    {
                      id: "shot-1",
                      kind: "screenshot" as const,
                      capturedAt: 1,
                      roles: ["exit" as const],
                    },
                  ],
                  captureProof: options.replay
                    ? ("replay-proved" as const)
                    : ("relay-controlled" as const),
                },
                {
                  id: "step-2",
                  intent: "Language",
                  label: "Language screen",
                  stepCount: 1,
                  proofStatus: "pixels-only" as const,
                  captureProof: options.replay
                    ? ("replay-proved" as const)
                    : ("relay-controlled" as const),
                },
              ],
              ...(options.replay
                ? {
                    latestReplay: {
                      id: "replay-1",
                      takeRevision: 1,
                      outcome: options.replay,
                    },
                  }
                : {}),
              replayRequired: options.replay !== "passed",
            },
          }
        : {}),
      progress: { label: stage === "reviewing" ? "Ready to review" : stage },
      allowedNextActions: actions,
      problems: [],
      evidenceRefs: [],
    },
  };
}

function fakeService(initial = state("recording", ["inspect", "record", "checkpoint", "stop"])) {
  let current = initial;
  const calls: string[] = [];
  const edits: AuthoringRecordingEdit[] = [];
  async function targetSession(selected: typeof target): Promise<LiveTargetSession> {
    let status: ReturnType<LiveTargetSession["snapshot"]> = {
      status: "connecting",
      target: selected,
    };
    const listeners = new Set<Parameters<LiveTargetSession["subscribe"]>[0]>();
    return {
      snapshot: () => status,
      subscribe(listener) {
        listeners.add(listener);
        listener(status);
        return () => listeners.delete(listener);
      },
      mount() {
        status = { status: "streaming", target: selected, frameSequence: 1 };
        for (const listener of listeners) listener(status);
        return () => undefined;
      },
      async input(input) {
        calls.push(`input:${input.kind}`);
      },
      close() {
        status = { status: "closed", target: selected };
      },
    };
  }
  const service: RecordingProductService = {
    async listApps() {
      calls.push("list-apps");
      return [{ id: "app-1", name: "Grok" }];
    },
    async connect() {
      calls.push("connect");
      return { status: "target-selection", targets: [target], selectedTarget: target };
    },
    async presentTargets(selected) {
      calls.push("present-targets");
      return selected.map((item) => ({
        ...item,
        name: "Pixel 9 Pro",
        detail: "Android emulator · 15 · Ready",
      }));
    },
    async begin(input) {
      calls.push(`begin:${input.title}:${input.appMapId}:${input.targetId}`);
      current = state("recording", ["inspect", "record", "checkpoint", "stop"]);
      return current;
    },
    async inspect(workflowId) {
      calls.push(`inspect:${workflowId}`);
      return current;
    },
    async getOptimization() {
      return { proposal: null };
    },
    async getEvidencePreview() {
      return {
        bytes: new Uint8Array([1]),
        mime: "image/png",
        controls: [
          {
            id: "preferred-language",
            name: "Preferred language",
            role: "button",
            rect: { x: 48, y: 280, width: 240, height: 48 },
            target: { label: "Preferred language" },
            why: "Matched the visible name “Preferred language”.",
          },
        ],
      };
    },
    async recordCurrent() {
      calls.push("record");
      return current;
    },
    async checkpoint(label) {
      calls.push(`checkpoint:${label ?? ""}`);
      return current;
    },
    async stop() {
      calls.push("stop");
      current = state("reviewing", ["inspect", "replay"]);
      return current;
    },
    async edit(edit) {
      calls.push(`edit:${edit.kind}`);
      edits.push(edit);
      const previousReview = current.snapshot?.review;
      current = state("reviewing", ["inspect", "edit", "replay"]);
      if (current.snapshot?.review && previousReview?.currentRevision) {
        Object.assign(current.snapshot.review, {
          currentRevision: previousReview.currentRevision + 1,
          revisionCount: (previousReview.revisionCount ?? previousReview.currentRevision) + 1,
          ...(previousReview.timeline ? { timeline: previousReview.timeline } : {}),
          ...(previousReview.videoClip ? { videoClip: previousReview.videoClip } : {}),
        });
      }
      return current;
    },
    async replay() {
      calls.push("replay");
      current = state("reviewing", ["inspect", "replay", "approve"], { replay: "passed" });
      return current;
    },
    async approve() {
      calls.push("approve");
      current = state("committed", [], { committed: true });
      return current;
    },
    previewTarget: targetSession,
    liveTarget: targetSession,
    async reconcileInput(input) {
      calls.push(`reconcile:${input.mutationId}:${input.outcome}`);
      if (input.clientUnknown) {
        return {
          mutationId: input.mutationId,
          resolutionId: input.resolutionId,
          outcome: input.outcome === "ambiguous" ? "ambiguous" : "acknowledged",
          review: {
            source: "operator-review",
            observed:
              input.outcome === "applied"
                ? "applied"
                : input.outcome === "not-applied"
                  ? "not-observed"
                  : "uncertain",
            actorId: "agent:reviewer",
          },
          observation: { capturedAt: 20 },
          health: { state: "ready" },
        };
      }
      return input;
    },
    async inspectTargetHealth() {
      calls.push("inspect-target-health");
      return { input: { state: "ready" as const } };
    },
    async observeTarget() {
      calls.push("observe-target");
      return [
        {
          id: "preferred-language",
          name: "Preferred language",
          role: "button",
          rect: { x: 80, y: 400, width: 240, height: 48 },
          target: { label: "Preferred language" },
          why: "Matched the visible name “Preferred language”.",
        },
      ];
    },
  };
  return { service, calls, edits };
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

async function renderJourney(
  path: string,
  productService: RecordingProductService,
  platform: Platform,
  mapService?: MapProductService,
  browserSpacesService?: BrowserSpacesProductService,
  appResourcesService?: AppResourcesProductService,
  quickStart = false,
  deviceService?: DeviceProductService,
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
        productService={productService}
        deviceService={deviceService}
        mapService={mapService}
        browserSpacesService={browserSpacesService ?? emptyBrowserSpaces}
        appResourcesService={appResourcesService ?? emptyAppResources}
      />,
    );
  });
  await settle();
  // These journeys cover the detailed setup; a new Test first asks for a website.
  const detailed = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === "Phone or tablet",
  );
  if (detailed && !quickStart && document.querySelector('form[aria-label="Start a test"]'))
    await click(detailed);
  return { history, host };
}

async function settle() {
  for (let index = 0; index < 4; index++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}

async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function beginRecording() {
  await click(button("Start recording"));
}

async function interactWithLiveTarget() {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-slot="capture-live-target"]');
  if (!canvas) throw new Error("Live target canvas not found");
  canvas.width = 320;
  canvas.height = 240;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 240 }) as DOMRect;
  canvas.setPointerCapture = () => undefined;
  await act(async () => {
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 40, clientY: 50 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 40, clientY: 50 }),
    );
  });
  await settle();
  await act(async () => {
    canvas.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 100,
        deltaY: 30,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 160));
  });
  await settle();
  await act(async () => {
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }),
    );
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "pasted العربية" },
    });
    canvas.dispatchEvent(paste);
  });
  await settle();
}

describe("record, review, replay, and save", () => {
  it.each([
    [
      "check",
      'Step 1 (check text "Account: member" visible): expect: "text "Account: member"" not visible after 10s',
    ],
    [
      "wait",
      'Step 1 (wait for text "Account: member"): wait-for: timed out waiting for text "Account: member" (60000ms) (pixels unchanged for 60000ms). Next: Unchanged pixels are diagnostic, not a reason to stop waiting.',
    ],
  ] as const)(
    "keeps an unsuccessful %s and its text open after a healthy inspection, then allows correction",
    async (kind, detail) => {
      const initial = state("recording", ["inspect", "record", "checkpoint", "stop"]);
      const fake = fakeService(initial);
      let finishCheck!: (result: ProductRecordingState) => void;
      fake.service.recordCondition = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<ProductRecordingState>((resolve) => {
              finishCheck = resolve;
            }),
        )
        .mockResolvedValueOnce(initial);
      await renderJourney("/recordings/workflow-1", fake.service, platformWithStorage().platform);
      await click(button("Wait or check"));
      if (kind === "check") await click(button("Check it is on screen"));
      await fill(document.querySelector<HTMLInputElement>("#condition-text")!, "Account: member");
      await click(button("Add step"));

      expect(document.querySelector<HTMLInputElement>("#condition-text")?.disabled).toBe(true);
      expect(
        [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
          (choice) => choice.textContent?.trim() === "Cancel",
        )?.disabled,
      ).toBe(true);
      expect(
        [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] [role="radio"]')].every(
          (choice) => choice.disabled,
        ),
      ).toBe(true);
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      await act(async () => {
        finishCheck({
          ...initial,
          status: "needs-attention",
          recovery: {
            code: "operation-unavailable",
            sourceCode: "AUTHORING_INTERACTION_FAILED",
            title: "The condition did not match",
            detail,
            recovery: "Choose the exact text and try again.",
            retryable: true,
          },
        });
      });
      await settle();

      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog?.querySelector('[role="alert"]')?.textContent).toContain(
        "“Account: member” wasn’t found. Check the text on screen and try again.",
      );
      expect(document.querySelector<HTMLInputElement>("#condition-text")?.value).toBe(
        "Account: member",
      );
      expect(fake.service.recordCondition).toHaveBeenCalledTimes(1);
      await fill(document.querySelector<HTMLInputElement>("#condition-text")!, "Account member");
      await click(button("Add step"));
      expect(fake.service.recordCondition).toHaveBeenCalledTimes(2);
      expect(fake.service.recordCondition).toHaveBeenLastCalledWith({
        kind,
        text: "Account member",
        timeoutMs: kind === "check" ? 10_000 : 60_000,
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    },
  );

  it("keeps an unknown recorded Wait draft paused after healthy inspection without repeating any input", async () => {
    const initial = state("recording", ["inspect", "record", "checkpoint", "stop"]);
    const fake = fakeService(initial);
    fake.service.recordCondition = vi.fn(async (): Promise<ProductRecordingState> => ({
      ...initial,
      recovery: {
        code: "mutation-outcome-unknown",
        title: "The Wait response was lost",
        detail: "Relay cannot confirm that the condition was recorded.",
        recovery: "Check its exact receipt before continuing.",
        retryable: false,
      },
    }));
    await renderJourney("/recordings/workflow-1", fake.service, platformWithStorage().platform);
    await click(button("Wait or check"));
    await fill(document.querySelector<HTMLInputElement>("#condition-text")!, "Copy");
    await click(button("Add step"));
    await settle();
    expect(document.querySelector<HTMLInputElement>("#condition-text")?.value).toBe("Copy");
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain(
      "Relay cannot confirm that the condition was recorded.",
    );
    expect(button("Add step").disabled).toBe(true);
    await click(button("Add step"));
    expect(fake.service.recordCondition).toHaveBeenCalledOnce();
    await click(button("Cancel"));
    await tapLiveTarget();
    expect(fake.calls.filter((call) => call.startsWith("input:"))).toEqual([]);
    await click(button("Stop and review"));
    expect(fake.calls).not.toContain("stop");
  });

  it("aligns browser labels with the current live frame, without using content extents as viewport", async () => {
    const browser = { kind: "browser", platform: "browser", targetId: "browser-checkout" } as const;
    const recording = state("recording", ["inspect", "record", "checkpoint", "stop"]);
    const initial = {
      ...recording,
      targets: [browser],
      selectedTarget: browser,
      snapshot: {
        ...recording.snapshot!,
        frozen: { ...recording.snapshot!.frozen!, target: browser },
      },
    };
    const fake = fakeService(initial);
    const review = reviewAndroidTalkBack([
      {
        role: "button",
        label: "Continue as Member",
        hittable: true,
        rect: { x: 24, y: 319, width: 152, height: 44 },
        index: 0,
      },
    ]);
    fake.service.reviewTalkBack = vi.fn(async () => ({
      inspectable: true,
      review,
      bounds: { width: 1256, height: 363 },
    }));
    const inspection = vi.fn();
    let listener: Parameters<LiveTargetSession["subscribe"]>[0] | undefined;
    fake.service.liveTarget = async () => {
      const snapshot = {
        target: browser,
        status: "streaming" as const,
        accessibility: { inspectable: true, review, bounds: { width: 1280, height: 720 } },
      };
      return {
        snapshot: () => snapshot,
        subscribe(next) {
          listener = next;
          return () => {};
        },
        mount(canvas) {
          canvas.width = 1280;
          canvas.height = 720;
          canvas.getBoundingClientRect = () =>
            ({ left: 0, top: 0, width: 640, height: 360 }) as DOMRect;
          canvas.parentElement!.getBoundingClientRect = () =>
            ({ left: 0, top: 0, width: 640, height: 600 }) as DOMRect;
          listener?.(snapshot);
          return () => {};
        },
        input: async () => {},
        close() {},
        setAccessibilityInspection: inspection,
      };
    };
    await renderJourney(
      "/recordings/workflow-1",
      fake.service,
      platformWithStorage({ "live.accessibilityLabels": "always" }).platform,
    );
    const outline = document.querySelector<HTMLElement>('[style*="--box-top"]');
    expect(outline?.style.getPropertyValue("--box-top")).toBe("159.5px");
    expect(outline?.style.getPropertyValue("--box-left")).toBe("12px");
    expect(fake.service.reviewTalkBack).not.toHaveBeenCalled();
    expect(inspection).toHaveBeenCalledWith(true);
    await act(async () => listener?.({ target: browser, status: "degraded" }));
    expect(document.querySelector('[style*="--box-top"]')).toBeNull();
  });
  it("describes a verified recording without claiming that a replay ran", async () => {
    const recorded = state("reviewing", ["inspect", "replay", "approve"], { replay: "passed" });
    recorded.snapshot!.review!.latestReplay!.source = "recording";
    await renderJourney(
      "/recordings/workflow-1/review",
      fakeService(recorded).service,
      platformWithStorage().platform,
    );
    expect(document.querySelector('[aria-label="Recording status"]')?.textContent).toBe("Verified");
    expect(
      document.querySelector('[aria-label="Recording status"]')?.getAttribute("title"),
    ).toContain("Recording verified on Pixel 9 Pro");
    expect(document.body.textContent).not.toContain("Verified on the selected configuration");
    expect(document.body.textContent).not.toContain("Replay passed.");
    expect(button("Save test").disabled).toBe(false);
  });
  it("keeps an input failure visible when healthy preview frames arrive", async () => {
    const fake = fakeService();
    const originalLiveTarget = fake.service.liveTarget!;
    let publish: Parameters<LiveTargetSession["subscribe"]>[0] | undefined;
    fake.service.liveTarget = async (selected) => {
      const session = await originalLiveTarget(selected);
      return {
        ...session,
        subscribe(listener) {
          publish = listener;
          return session.subscribe(listener);
        },
        async input() {
          throw new RecordingInputNotSentError("The menu control could not be reached.");
        },
      };
    };
    await renderJourney("/recordings/workflow-1", fake.service, platformWithStorage().platform);
    await tapLiveTarget();
    expect(document.body.textContent).toContain("The menu control could not be reached.");
    await act(async () => publish!({ status: "streaming", target, frameSequence: 2 }));
    expect(document.body.textContent).toContain("The menu control could not be reached.");
  });
  it("reopens an ended live preview without starting or mutating the recording", async () => {
    const fake = fakeService();
    const originalLiveTarget = fake.service.liveTarget!;
    const close = vi.fn();
    let attempts = 0;
    fake.service.liveTarget = async (selected) => {
      attempts += 1;
      if (attempts > 1) return originalLiveTarget(selected);
      return {
        snapshot: () => ({ status: "offline", target: selected }),
        subscribe(listener) {
          listener({ status: "offline", target: selected, issue: "The live target stream ended." });
          return () => undefined;
        },
        mount: () => () => undefined,
        input: vi.fn(),
        close,
      };
    };
    const { history } = await renderJourney(
      "/recordings/workflow-1",
      fake.service,
      platformWithStorage().platform,
    );
    expect(document.body.textContent).toContain("Live view unavailable");
    await click(button("Reconnect live view"));
    expect(attempts).toBe(2);
    expect(close).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("Live view unavailable");
    expect(button("Android Back").disabled).toBe(false);
    expect(history.location.pathname).toBe("/recordings/workflow-1");
    expect(fake.calls.some((call) => /^(begin|input|record|stop)/u.test(call))).toBe(false);
  });
  it("disables live recording tools until the disconnected stream returns", async () => {
    const fake = fakeService();
    fake.service.captureFullPage = vi.fn(async () => state("recording", []));
    fake.service.recordCondition = vi.fn(async () => state("recording", []));
    const originalLiveTarget = fake.service.liveTarget!;
    let publish!: Parameters<LiveTargetSession["subscribe"]>[0];
    fake.service.liveTarget = async (selected) => {
      const session = await originalLiveTarget(selected);
      return {
        ...session,
        subscribe(listener) {
          publish = listener;
          return session.subscribe(listener);
        },
      };
    };
    const { history } = await renderJourney(
      "/recordings/workflow-1",
      fake.service,
      platformWithStorage().platform,
    );
    const tools = ["Full page", "Wait or check", "Save screenshot", "Inspect elements"];
    for (const label of tools) expect(button(label).disabled).toBe(false);

    for (const status of ["offline", "degraded", "connecting"] as const) {
      await act(async () => publish({ status, target }));
      for (const label of tools) expect(button(label).disabled).toBe(true);
      expect(button("Android Back").disabled).toBe(true);
      expect(button("Stop and review").disabled).toBe(false);
      expect(history.location.pathname).toBe("/recordings/workflow-1");
    }
    await act(async () => publish({ status: "streaming", target, frameSequence: 2 }));
    for (const label of tools) expect(button(label).disabled).toBe(false);
    expect(fake.service.captureFullPage).not.toHaveBeenCalled();
    expect(fake.service.recordCondition).not.toHaveBeenCalled();
    expect(fake.calls.some((call) => /^(begin|input|record|stop|checkpoint)/u.test(call))).toBe(
      false,
    );
  });
  it("keeps capture admission closed when the preview streams without allowed capture actions", async () => {
    const fake = fakeService(state("recording", ["inspect", "stop"]));
    fake.service.captureFullPage = vi.fn(async () => state("recording", []));
    fake.service.recordCondition = vi.fn(async () => state("recording", []));
    await renderJourney("/recordings/workflow-1", fake.service, platformWithStorage().platform);
    for (const label of ["Full page", "Wait or check", "Save screenshot"])
      expect(button(label).disabled).toBe(true);
    expect(button("Android Back").disabled).toBe(true);
    expect(button("Stop and review").disabled).toBe(false);
    expect(fake.service.captureFullPage).not.toHaveBeenCalled();
    expect(fake.service.recordCondition).not.toHaveBeenCalled();
  });
  it.each(["condition", "screenshot"] as const)(
    "retains an open %s draft and blocks submission after a disconnect",
    async (kind) => {
      const fake = fakeService();
      fake.service.recordCondition = vi.fn(async () => state("recording", []));
      const originalLiveTarget = fake.service.liveTarget!;
      let publish!: Parameters<LiveTargetSession["subscribe"]>[0];
      fake.service.liveTarget = async (selected) => {
        const session = await originalLiveTarget(selected);
        return {
          ...session,
          subscribe(listener) {
            publish = listener;
            return session.subscribe(listener);
          },
        };
      };
      await renderJourney("/recordings/workflow-1", fake.service, platformWithStorage().platform);
      await click(button(kind === "condition" ? "Wait or check" : "Save screenshot"));
      const input = document.querySelector<HTMLInputElement>(
        kind === "condition" ? "#condition-text" : "#checkpoint-label",
      )!;
      await fill(input, "Order confirmation");
      await act(async () => publish({ status: "offline", target }));
      const dialog = document.querySelector('[role="dialog"]')!;
      const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(submit.disabled).toBe(true);
      expect(input.value).toBe("Order confirmation");
      await act(async () => {
        dialog
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      expect(fake.service.recordCondition).not.toHaveBeenCalled();
      expect(fake.calls.some((call) => call.startsWith("checkpoint"))).toBe(false);

      await act(async () => publish({ status: "streaming", target, frameSequence: 2 }));
      expect(submit.disabled).toBe(false);
      expect(input.value).toBe("Order confirmation");
      await act(async () => publish({ status: "offline", target }));
      const cancel = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent?.trim() === "Cancel",
      )!;
      expect(cancel.disabled).toBe(false);
      await click(cancel);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(button("Stop and review").disabled).toBe(false);
    },
  );
  it("isolates naming and edit mode when navigating between recordings", async () => {
    const fake = fakeService(state("reviewing", ["inspect", "edit", "replay"]));
    const storage = platformWithStorage({ "recordingName:workflow-2": "Second recording" });
    const { history } = await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      storage.platform,
    );
    await fill(
      document.querySelector<HTMLInputElement>("#review-test-name")!,
      "First recording draft",
    );
    await settle();
    await click(button("Edit steps"));
    await act(async () => history.push("/recordings/workflow-2/review"));
    await settle();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLInputElement>("#review-test-name")?.value).toBe(
        "Second recording",
      ),
    );
    expect(button("Edit steps").getAttribute("aria-pressed")).toBe("false");
    expect(storage.values.get("recordingName:workflow-1")).toBe("First recording draft");
    expect(storage.values.get("recordingName:workflow-2")).toBe("Second recording");
  });

  it("carries a verified Map path into the recording setup", async () => {
    const fake = fakeService();
    const mapService: MapProductService = {
      async get(appMapId) {
        expect(appMapId).toBe("app-1");
        return {
          appMapId,
          appName: "Grok",
          revision: 1,
          screens: [],
          paths: [
            {
              id: "settings-language",
              label: "Open Language",
              fromScreenId: "settings",
              toScreenId: "language",
              fromTitle: "Settings",
              toTitle: "Language",
              coveringTests: [],
            },
          ],
          coverage: {
            screenCount: 0,
            coveredScreenCount: 0,
            pathCount: 1,
            coveredPathCount: 0,
            testCount: 0,
          },
          pendingProposalCount: 0,
          navigation: { route: "/apps/app-1/map", href: "/apps/app-1/map" },
        };
      },
    };
    await renderJourney(
      "/tests/new?app=app-1&view=path&path=settings-language",
      fake.service,
      platformWithStorage().platform,
      mapService,
    );

    expect(document.querySelector('[aria-label="App"]')?.textContent).toContain("Grok");
    expect(document.body.textContent).toContain("Settings → Language");
    expect(document.querySelector("#test-name")).toBeNull();
  });

  it("uses the changed URL app in both the selection and recording submission", async () => {
    const fake = fakeService();
    fake.service.listApps = async () => [
      { id: "app-1", name: "Grok" },
      { id: "app-2", name: "Relay Demo" },
    ];
    const { history } = await renderJourney(
      "/tests/new?app=app-1",
      fake.service,
      platformWithStorage().platform,
    );
    await act(async () => {
      history.push("/tests/new?app=app-2");
    });
    await settle();
    expect(document.querySelector('[aria-label="App"]')?.textContent).toContain("Relay Demo");
    await click(button("Start recording"));
    expect(fake.calls.some((call) => call.startsWith("begin:") && call.includes(":app-2:"))).toBe(
      true,
    );
  });

  it("preserves a missing device selection without asking the user to select it again", async () => {
    const fake = fakeService();
    fake.service.connect = async () => ({ status: "target-selection", targets: [] });
    await renderJourney(
      "/tests/new?app=app-1&target=emulator-5554",
      fake.service,
      platformWithStorage().platform,
    );
    expect(document.body.textContent).toContain("Your selected device isn’t ready");
    expect(document.body.textContent).not.toContain("Choose where to record");
    expect(document.querySelector('[aria-label="Record on"]')?.textContent).toContain(
      "Selected device unavailable",
    );
    expect(button("Start recording").disabled).toBe(true);
    expect(button("Check again")).toBeTruthy();
  });

  it("keeps app and device in a compact toolbar instead of a setup form", async () => {
    const fake = fakeService();
    fake.service.connect = async () => ({ status: "target-selection", targets: [] });
    fake.service.presentTargets = async () => [];
    await renderJourney("/tests/new?app=app-1", fake.service, platformWithStorage().platform);

    expect(document.querySelector('[aria-label="App"]')?.textContent).toContain("Grok");
    expect(document.querySelector('[aria-label="Record on"]')?.textContent).toContain(
      "Choose a device or browser",
    );
    expect(document.body.textContent).toContain("Start a browser to record");
    expect(document.body.textContent).toContain("Start a browser");
    expect(document.body.textContent).not.toContain("Open devices");
    expect(document.body.textContent).not.toContain("Manage browser Spaces");
    expect(document.body.textContent).not.toContain("Where this test belongs");
    expect(document.body.textContent).not.toContain("Stay on this page");
    expect(button("Start recording").disabled).toBe(true);
  });

  it("offers a new recording instead of replaying zero saved steps", async () => {
    const empty = state("reviewing", ["inspect", "replay", "approve"]);
    empty.snapshot!.review!.actions = [];
    empty.snapshot!.review!.actionCount = 0;
    const fake = fakeService(empty);
    fake.service.cancel = async () => {
      fake.calls.push("cancel-empty");
      return state("cancelled", []);
    };
    const { history } = await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    expect(document.body.textContent).not.toContain("Replay on Pixel");
    expect(document.body.textContent).not.toContain("Save test");
    await click(button("Start new recording"));
    expect(fake.calls).toContain("cancel-empty");
    expect(history.location.pathname).toBe("/tests/new");
  });

  it("starts a browser on this page instead of sending the user away", async () => {
    const fake = fakeService();
    const ready = {
      kind: "browser" as const,
      platform: "browser" as const,
      targetId: "browser-checkout",
    };
    fake.service.connect = async () =>
      fake.calls.includes("create-browser")
        ? { status: "target-selection", targets: [ready], selectedTarget: ready }
        : { status: "target-selection", targets: [] };
    fake.service.presentTargets = async (selected) =>
      selected.map((item) => ({
        ...item,
        name: "checkout.example",
        detail: "Managed browser · Ready",
      }));
    const created: string[] = [];
    const { history } = await renderJourney(
      "/tests/new?app=app-1",
      fake.service,
      platformWithStorage().platform,
      undefined,
      {
        listSpaces: async () => [],
        createSpace: async (input) => {
          fake.calls.push("create-browser");
          created.push(input.startUrl);
          return {
            id: "browser-checkout",
            name: input.name,
            startUrl: input.startUrl,
            createdAt: 1,
            updatedAt: 1,
            profileRetention: "ephemeral",
            persistent: false,
            source: { kind: "managed-browser-target", id: "browser-checkout" },
          };
        },
        openSpace: async () => ({
          targetId: "browser-checkout",
          name: "checkout.example",
          url: "https://checkout.example",
        }),
        removeSpace: async () => undefined,
        listAuthenticationFixtures: async () => [],
        saveAuthenticationFixture: async () => {
          throw new Error("unused");
        },
        refreshAuthenticationFixture: async () => {
          throw new Error("unused");
        },
        revokeAuthenticationFixture: async () => {
          throw new Error("unused");
        },
        listCompareSets: async () => [],
        saveCompareSet: async () => {
          throw new Error("unused");
        },
        removeCompareSet: async () => undefined,
      },
    );

    const url = document.querySelector<HTMLInputElement>("#record-browser-url");
    if (!url) throw new Error("Website field not found");
    await fill(url, "https://checkout.example");
    await click(button("Start a browser"));
    expect(history.location.pathname).toBe("/tests/new");
    expect(created).toEqual(["https://checkout.example/"]);
    expect(document.querySelector('[aria-label="Record on"]')?.textContent).toContain(
      "checkout.example",
    );
    expect(button("Start recording").disabled).toBe(false);
  });

  it("starts only one browser for repeated Enter and click before a render", async () => {
    const fake = fakeService();
    const ready = {
      kind: "browser" as const,
      platform: "browser" as const,
      targetId: "browser-checkout",
    };
    fake.service.connect = async () =>
      fake.calls.includes("create-browser")
        ? { status: "target-selection", targets: [ready], selectedTarget: ready }
        : { status: "target-selection", targets: [] };
    fake.service.presentTargets = async (selected) =>
      selected.map((item) => ({
        ...item,
        name: "checkout.example",
        detail: "Managed browser · Ready",
      }));
    const created: string[] = [];
    const { history } = await renderJourney(
      "/tests/new?app=app-1",
      fake.service,
      platformWithStorage().platform,
      undefined,
      {
        listSpaces: async () => [],
        createSpace: async (input) => {
          fake.calls.push("create-browser");
          created.push(input.startUrl);
          return {
            id: "browser-checkout",
            name: input.name,
            startUrl: input.startUrl,
            createdAt: 1,
            updatedAt: 1,
            profileRetention: "ephemeral",
            persistent: false,
            source: { kind: "managed-browser-target", id: "browser-checkout" },
          };
        },
        openSpace: async () => ({
          targetId: "browser-checkout",
          name: "checkout.example",
          url: "https://checkout.example",
        }),
        removeSpace: async () => undefined,
        listAuthenticationFixtures: async () => [],
        saveAuthenticationFixture: async () => {
          throw new Error("unused");
        },
        refreshAuthenticationFixture: async () => {
          throw new Error("unused");
        },
        revokeAuthenticationFixture: async () => {
          throw new Error("unused");
        },
        listCompareSets: async () => [],
        saveCompareSet: async () => {
          throw new Error("unused");
        },
        removeCompareSet: async () => undefined,
      },
    );

    const url = document.querySelector<HTMLInputElement>("#record-browser-url");
    if (!url) throw new Error("Website field not found");
    await fill(url, "https://checkout.example");
    await act(async () => {
      url.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      url.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      button("Start a browser").click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(history.location.pathname).toBe("/tests/new");
    expect(created).toEqual(["https://checkout.example/"]);
    expect(document.querySelector('[aria-label="Record on"]')?.textContent).toContain(
      "checkout.example",
    );
    expect(button("Start recording").disabled).toBe(false);
  });

  it("can create a browser with a connected device and preserves it in the URL", async () => {
    const fake = fakeService();
    const ready = {
      kind: "browser" as const,
      platform: "browser" as const,
      targetId: "browser-checkout",
    };
    fake.service.connect = async () =>
      fake.calls.includes("create-browser")
        ? { status: "target-selection", targets: [ready], selectedTarget: ready }
        : { status: "target-selection", targets: [target], selectedTarget: target };
    fake.service.presentTargets = async (selected) =>
      selected.map((item) => ({
        ...item,
        name: "checkout.example",
        detail: "Managed browser · Ready",
      }));
    const created: string[] = [];
    const { history } = await renderJourney(
      "/tests/new?app=app-1",
      fake.service,
      platformWithStorage().platform,
      undefined,
      {
        listSpaces: async () => [],
        createSpace: async (input) => {
          fake.calls.push("create-browser");
          created.push(input.startUrl);
          return {
            id: "browser-checkout",
            name: input.name,
            startUrl: input.startUrl,
            createdAt: 1,
            updatedAt: 1,
            profileRetention: "ephemeral",
            persistent: false,
            source: { kind: "managed-browser-target", id: "browser-checkout" },
          };
        },
        openSpace: async () => ({
          targetId: "browser-checkout",
          name: "checkout.example",
          url: "https://checkout.example",
        }),
        removeSpace: async () => undefined,
        listAuthenticationFixtures: async () => [],
        saveAuthenticationFixture: async () => {
          throw new Error("unused");
        },
        refreshAuthenticationFixture: async () => {
          throw new Error("unused");
        },
        revokeAuthenticationFixture: async () => {
          throw new Error("unused");
        },
        listCompareSets: async () => [],
        saveCompareSet: async () => {
          throw new Error("unused");
        },
        removeCompareSet: async () => undefined,
      },
    );

    await click(button("New browser"));
    const url = document.querySelector<HTMLInputElement>("#record-browser-url");
    if (!url) throw new Error("Website field not found");
    await fill(url, "https://checkout.example");
    await click(button("Start a browser"));
    expect(history.location.pathname).toBe("/tests/new");
    expect(history.location.search).toContain("target=browser-checkout");
    expect(created).toEqual(["https://checkout.example/"]);
    expect(document.querySelector('[aria-label="Record on"]')?.textContent).toContain(
      "checkout.example",
    );
    expect(button("Start recording").disabled).toBe(false);
  });

  it("opens a saved browser without leaking host errors", async () => {
    const fake = fakeService();
    const ready = {
      kind: "browser" as const,
      platform: "browser" as const,
      targetId: "checkout-staging",
    };
    fake.service.connect = async () =>
      fake.calls.includes("open-browser")
        ? { status: "target-selection", targets: [ready], selectedTarget: ready }
        : { status: "target-selection", targets: [] };
    fake.service.presentTargets = async (selected) =>
      selected.map((item) => ({
        ...item,
        name: "Checkout staging",
        detail: "Managed browser · Ready",
      }));
    await renderJourney(
      "/tests/new?app=app-1",
      fake.service,
      platformWithStorage().platform,
      undefined,
      {
        listSpaces: async () => [
          {
            id: "checkout-staging",
            name: "Checkout staging",
            startUrl: "https://checkout.example",
            createdAt: 1,
            updatedAt: 1,
            profileRetention: "retain",
            persistent: true,
            source: { kind: "managed-browser-target", id: "checkout-staging" },
          },
        ],
        createSpace: async () => {
          throw new Error("unused");
        },
        openSpace: undefined as never,
        removeSpace: async () => undefined,
        listAuthenticationFixtures: async () => [],
        saveAuthenticationFixture: async () => {
          throw new Error("unused");
        },
        refreshAuthenticationFixture: async () => {
          throw new Error("unused");
        },
        revokeAuthenticationFixture: async () => {
          throw new Error("unused");
        },
        listCompareSets: async () => [],
        saveCompareSet: async () => {
          throw new Error("unused");
        },
        removeCompareSet: async () => undefined,
      },
    );

    expect(document.body.textContent).toContain("Choose a browser");
    expect(document.body.textContent).toContain("Checkout staging");
    expect(document.body.textContent).toContain("checkout.example");
    expect(document.body.textContent).not.toContain("Start a browser to record");
    const row = [...document.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("Checkout staging"),
    );
    if (!row) throw new Error("Saved browser row not found");
    fake.calls.push("open-browser");
    await click(row);
    expect(document.body.textContent).not.toContain("openSpace is not a function");
    expect(document.querySelector('[aria-label="Record on"]')?.textContent).toContain(
      "Checkout staging",
    );
  });

  it("refreshes the native preview after Open app and waits for its first new frame", async () => {
    const fake = fakeService();
    let sessions = 0;
    let deliverFrame!: () => void;
    const closed = vi.fn();
    fake.service.previewTarget = async (selected) => {
      const index = ++sessions;
      let current: ReturnType<LiveTargetSession["snapshot"]> = {
        status: "connecting",
        target: selected,
      };
      let listener: Parameters<LiveTargetSession["subscribe"]>[0] | undefined;
      const publish = () => {
        current = {
          status: "streaming",
          target: selected,
          frameSequence: 1,
          lastFrameAt: Date.now(),
        };
        listener?.(current);
      };
      return {
        snapshot: () => current,
        subscribe(next) {
          listener = next;
          next(current);
          return () => {
            listener = undefined;
          };
        },
        mount() {
          if (index === 1) publish();
          else deliverFrame = publish;
          return () => {};
        },
        input: vi.fn(),
        close: closed,
      };
    };
    const launchApp = vi.fn(async () => ({}));
    const deviceService = {
      list: async () => [],
      get: async () => undefined,
      actions: async () => [],
      listInstalledApps: async () => [{ name: "Grok", package: "ai.x.grok" }],
      launchApp,
    } as unknown as DeviceProductService;
    await renderJourney(
      "/tests/new?app=app-1&target=emulator-5554&originApplication=ai.x.grok",
      fake.service,
      platformWithStorage().platform,
      undefined,
      undefined,
      undefined,
      false,
      deviceService,
    );
    await click(button("Open app"));
    expect(launchApp).toHaveBeenCalledWith("emulator-5554", "ai.x.grok", true);
    expect(sessions).toBe(2);
    expect(closed).toHaveBeenCalledOnce();
    expect(button("Start recording").disabled).toBe(true);
    await act(async () => deliverFrame());
    await settle();
    expect(button("Start recording").disabled).toBe(false);
    expect(fake.calls.some((call) => call.startsWith("begin:"))).toBe(false);
  });

  it("cannot start recording from a stopped native preview even without an error message", async () => {
    const fake = fakeService();
    fake.service.previewTarget = async (selected) => ({
      snapshot: () => ({ status: "offline", target: selected }),
      subscribe(listener) {
        listener({ status: "offline", target: selected });
        return () => {};
      },
      mount: () => () => {},
      input: vi.fn(),
      close() {},
    });
    await renderJourney(
      "/tests/new?app=app-1&target=emulator-5554",
      fake.service,
      platformWithStorage().platform,
    );
    expect(button("Start recording").disabled).toBe(true);
  });

  it("opens setup with a starting app carried from the device", async () => {
    const fake = fakeService();
    const connect = vi.fn(fake.service.connect);
    fake.service.connect = connect;
    await renderJourney(
      "/tests/new?target=emulator-5554&originApplication=com.android.settings",
      fake.service,
      platformWithStorage().platform,
    );
    expect(document.querySelector('form[aria-label="Record setup"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("This page couldn’t load");
    expect(connect).toHaveBeenCalledWith({ targetKind: "device", targetId: "emulator-5554" });
    expect(button("Phone or tablet").getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).not.toContain("New browser");
  });

  it("keeps unavailable native setup visible and reconnects explicitly without replaying input", async () => {
    const fake = fakeService();
    const ipad = { kind: "device", platform: "ios", targetId: "ipad-fixture" } as const;
    let ready = false;
    let finishRecovery!: () => void;
    const connect = vi.fn(async () =>
      ready
        ? {
            status: "target-selection" as const,
            targets: [ipad],
            selectedTarget: ipad,
          }
        : {
            status: "idle" as const,
            targets: [],
            recovery: {
              code: "transport" as const,
              sourceCode: "native-recording-target-not-ready",
              title: "Device needs reconnecting",
              detail: "Relay can show the screen, but recording control is unavailable.",
              recovery: "Reconnect the iOS target and capture a fresh observation before retrying.",
              retryable: false,
            },
          },
    );
    fake.service.connect = connect;
    fake.service.listApps = async () => [{ id: "app-1", name: "Grok", platform: "ios" }];
    const recover = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<DeviceProductService["recover"]>>>((resolve) => {
          finishRecovery = () => {
            ready = true;
            resolve({
              serial: ipad.targetId,
              recovered: true,
              ready: true,
              summary: "Ready",
              actions: [],
              session: { status: "ready", detail: "Ready" },
            });
          };
        }),
    );
    const launchApp = vi.fn();
    const deviceService = {
      list: async () => [],
      get: async () => undefined,
      actions: async () => [],
      recover,
      launchApp,
    } satisfies DeviceProductService;
    const { history } = await renderJourney(
      "/tests/new?app=app-1&target=ipad-fixture&targetKind=device&originApplication=Grok",
      fake.service,
      platformWithStorage().platform,
      undefined,
      undefined,
      undefined,
      false,
      deviceService,
    );
    expect(document.querySelector('form[aria-label="Record setup"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Grok");
    expect(document.body.textContent).toContain("Device needs reconnecting");
    expect(document.body.textContent).not.toContain("Something went wrong");
    expect(button("Start recording").disabled).toBe(true);
    expect(recover).not.toHaveBeenCalled();
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    vi.useRealTimers();
    expect(connect).toHaveBeenCalledOnce();
    await click(button("Reconnect device"));
    expect(button("Reconnecting…").disabled).toBe(true);
    expect(button("Website").disabled).toBe(true);
    expect(button("Start recording").disabled).toBe(true);
    expect(recover).toHaveBeenCalledExactlyOnceWith("ipad-fixture", "connect");
    await act(async () => finishRecovery());
    await settle();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(document.querySelector<HTMLInputElement>("#device-app-identifier")?.value).toBe("Grok");
    expect(history.location.search).toContain("originApplication=Grok");
    expect(button("Start recording").disabled).toBe(true);
    expect(launchApp).not.toHaveBeenCalled();
    expect(fake.calls.some((call) => /^(?:begin:|input:|record$)/u.test(call))).toBe(false);
  });

  it("creates an app inline without losing the chosen device or starting recording", async () => {
    const fake = fakeService();
    const createdNames: string[] = [];
    const { history } = await renderJourney(
      "/tests/new?target=emulator-5554",
      fake.service,
      platformWithStorage().platform,
      undefined,
      undefined,
      {
        createApp: async (name: string) => {
          createdNames.push(name);
          if (createdNames.length === 1)
            throw new Error("Couldn’t create the app. Your name is kept here—try again.");
          return { id: "new-app", name };
        },
      } as AppResourcesProductService,
    );
    await click(button("App"));
    await click(
      [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
        item.textContent?.includes("Create app"),
      )!,
    );
    expect(button("Start recording").disabled).toBe(true);
    await fill(document.querySelector<HTMLInputElement>("#recording-app-name")!, "Acme");
    await click(button("Create app"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn’t create the app",
    );
    expect(document.querySelector<HTMLInputElement>("#recording-app-name")?.value).toBe("Acme");
    await click(button("Create app"));
    expect(createdNames).toEqual(["Acme", "Acme"]);
    expect(history.location.pathname).toBe("/tests/new");
    expect(String(history.location.search)).toContain("new-app");
    expect(String(history.location.search)).toContain("emulator-5554");
    expect(document.querySelector('[aria-label="App"]')?.textContent).toContain("Acme");
    expect(button("Start recording").disabled).toBe(false);
    expect(fake.calls.some((call) => call.startsWith("begin:"))).toBe(false);
  });

  it("keeps website quick start outside the device setup form", async () => {
    await renderJourney(
      "/tests/new",
      fakeService().service,
      platformWithStorage().platform,
      undefined,
      undefined,
      undefined,
      true,
    );
    expect(document.querySelector('form[aria-label="Start a test"]')).not.toBeNull();
    expect(document.querySelector("form form")).toBeNull();
  });

  it("opens a scoped website in the address form and preserves a cleared address", async () => {
    const fake = fakeService();
    fake.service.listApps = async () => [{ id: "app-1", name: "shop.example", platform: "web" }];
    const spaces = {
      listSpaces: async () => [
        {
          id: "browser-shop",
          name: "Shop",
          startUrl: "https://shop.example/login",
          createdAt: 1,
          updatedAt: 2,
          profileRetention: "ephemeral",
          persistent: false,
          source: { kind: "managed-browser-target", id: "browser-shop" },
        },
      ],
    } as unknown as BrowserSpacesProductService;
    await renderJourney(
      "/tests/new?app=app-1",
      fake.service,
      platformWithStorage().platform,
      undefined,
      spaces,
      undefined,
      true,
    );
    expect(document.querySelector('form[aria-label="Start a test"]')).not.toBeNull();
    const address = document.querySelector<HTMLInputElement>("#new-test-website")!;
    expect(address.value).toBe("https://shop.example/login");
    await fill(address, "");
    await settle();
    expect(address.value).toBe("");
    expect(button("Start recording").disabled).toBe(true);
    await click(button("Phone or tablet"));
    expect(document.querySelector('form[aria-label="Start a test"]')).toBeNull();
    await click(button("Website"));
    expect(document.querySelector<HTMLInputElement>("#new-test-website")?.value).toBe("");
  });

  it("defers unrelated target readiness until the user opens Phone setup", async () => {
    const fake = fakeService();
    const scopes: unknown[] = [];
    fake.service.connect = async (input) => {
      scopes.push(input);
      if (input?.targetKind !== "device") return new Promise(() => {});
      return { status: "target-selection", targets: [target], selectedTarget: target };
    };
    await renderJourney(
      "/tests/new",
      fake.service,
      platformWithStorage().platform,
      undefined,
      undefined,
      undefined,
      true,
    );
    expect(scopes).toEqual([]);
    await click(button("Phone or tablet"));
    await settle();
    expect(scopes).toEqual([{ targetKind: "device" }]);
    expect(document.body.textContent).toContain("Pixel 9 Pro");
    expect(document.body.textContent).not.toContain("Checking…");
  });

  it("can open website setup after an existing browser readiness failure", async () => {
    const fake = fakeService();
    fake.service.listApps = async () => [{ id: "app-1", name: "shop.example", platform: "web" }];
    fake.service.connect = async () => ({
      status: "target-selection",
      targets: [],
      recovery: {
        code: "transport",
        title: "Browser unavailable",
        detail: "The selected browser is offline.",
        recovery: "Choose another browser.",
        retryable: true,
      },
    });
    await renderJourney(
      "/tests/new?app=app-1&target=old-browser",
      fake.service,
      platformWithStorage().platform,
      undefined,
      undefined,
      undefined,
      true,
    );
    expect(document.body.textContent).toContain("Browser unavailable");
    await click(button("Website"));
    expect(document.querySelector('form[aria-label="Start a test"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("Browser unavailable");
  });

  it("preserves the website address across mode switches and filters browsers out of phone setup", async () => {
    const fake = fakeService();
    fake.service.connect = async () => ({
      status: "target-selection",
      targets: [{ kind: "browser", platform: "browser", targetId: "signed-in-browser" }],
    });
    await renderJourney(
      "/tests/new",
      fake.service,
      platformWithStorage().platform,
      undefined,
      undefined,
      undefined,
      true,
    );
    await fill(document.querySelector<HTMLInputElement>("#new-test-website")!, "shop.example");
    await click(button("Phone or tablet"));
    expect(document.body.textContent).toContain("Connect your device");
    expect(document.querySelector('[aria-label="Record on"]')?.textContent).not.toContain(
      "Pixel 9 Pro",
    );
    expect(document.querySelector('form[aria-label="Record setup"]')).toBeNull();
    await click(button("Website"));
    expect(document.querySelector<HTMLInputElement>("#new-test-website")?.value).toBe(
      "shop.example",
    );
    expect(fake.calls.some((call) => call.startsWith("begin:"))).toBe(false);
  });

  it.each([false, true, undefined])(
    "keeps app context and respects an explicit saved account choice (%s)",
    async (useAccount) => {
      const fake = fakeService();
      const begin = vi.spyOn(fake.service, "begin");
      const open = vi.fn().mockImplementation(async (spaceId: string) => ({
        targetId: spaceId,
        name: "Shop",
        url: "https://shop.example/",
      }));
      const create = vi.fn().mockResolvedValue({ id: "guest-browser" });
      const savedSpace = {
        id: "signed-in-browser",
        name: "Shop",
        startUrl: "https://shop.example/",
        createdAt: 1,
        updatedAt: 1,
        profileRetention: "retain",
        persistent: true,
        source: { kind: "managed-browser-target", id: "signed-in-browser" },
      } satisfies ProductBrowserSpace;
      const account = {
        target: { id: "signed-in-browser", name: "Shop", startUrl: "https://shop.example/" },
        fixture: {
          id: "member",
          reference: "authfx:member:1",
          revision: 1,
          targetId: "signed-in-browser",
          name: "Member",
          origins: ["https://shop.example"],
          cookieCount: 1,
          createdAt: 1,
        },
      };
      await renderJourney(
        "/tests/new?app=app-1",
        fake.service,
        platformWithStorage().platform,
        undefined,
        {
          listSpaces: async () => [savedSpace],
          createSpace: create,
          openSpace: open,
        } as unknown as BrowserSpacesProductService,
        {
          ...emptyAppResources,
          listBrowserAccounts: async () => (useAccount === undefined ? [] : [account]),
        },
        true,
      );
      await click(button("Website"));
      await fill(
        document.querySelector<HTMLInputElement>("#new-test-website")!,
        "https://shop.example/",
      );
      if (useAccount) {
        await click(document.querySelector<HTMLButtonElement>("#new-test-account")!);
        await click(
          [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
            (option) => option.textContent === "Member",
          )!,
        );
      }
      await click(button("Start recording"));
      expect(begin).toHaveBeenCalledWith(expect.objectContaining({ targetKind: "browser" }));
      expect(create).toHaveBeenCalledTimes(useAccount ? 0 : 1);
      if (!useAccount)
        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({
            startUrl: "https://shop.example/",
            profileRetention: "ephemeral",
          }),
        );
      expect(open.mock.calls[0]?.[0]).toBe(useAccount ? "signed-in-browser" : "guest-browser");
      expect(fake.calls).toContain(
        `begin:Test on shop.example:app-1:${useAccount ? "signed-in-browser" : "guest-browser"}`,
      );
    },
  );

  it("offers run and save for edited steps and includes the current instruction", async () => {
    const initial = state("reviewing", ["inspect", "edit", "replay"]);
    initial.snapshot!.review!.currentRevision = 7;
    const fake = fakeService(initial);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.service.save = vi.fn(async (input) => {
      input.onProgress?.("checking");
      await waiting;
      input.onProgress?.("saving");
      return fake.service.approve(input.testName);
    });
    const storage = platformWithStorage({ activeRecordingWorkflowId: "workflow-1" });
    const { history } = await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      storage.platform,
    );
    expect(button("Run and save").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Save test");
    expect(document.body.textContent).not.toContain("Run test");
    await click(button("Edit steps"));
    await fill(
      document.querySelector<HTMLInputElement>("#review-action-intent")!,
      "Open app settings",
    );
    await click(button("Run and save"));
    expect(button("Running…").disabled).toBe(true);
    expect(fake.service.save).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewRevision: 7,
        rename: { actionId: "step-1", intent: "Open app settings" },
      }),
    );
    await act(async () => release());
    await settle();
    expect(history.location.pathname).toBe("/tests/test-1");
    expect(fake.calls).not.toContain("replay");
    expect(fake.calls).toContain("approve");
  });

  it.each(["replay", "save"] as const)(
    "watches native review %s without taking control and restores the selected capture",
    async (operation) => {
      const initial = state("reviewing", ["inspect", "edit", "replay"]);
      initial.snapshot!.review!.currentRevision = 7;
      const fake = fakeService(initial);
      let finishReplay!: () => void;
      const replaying = new Promise<void>((resolve) => {
        finishReplay = resolve;
      });
      let finishSave!: () => void;
      const saving = new Promise<void>((resolve) => {
        finishSave = resolve;
      });
      const replay = fake.service.replay;
      fake.service.replay = async () => {
        await replaying;
        return replay();
      };
      if (operation === "save") {
        fake.service.save = async (input) => {
          input.onProgress?.("checking");
          await replaying;
          input.onProgress?.("saving");
          await saving;
          return fake.service.approve(input.testName);
        };
      }
      const input = vi.fn(async () => {});
      const inspection = vi.fn();
      const close = vi.fn();
      const stop = vi.fn();
      let publish!: (status: "streaming" | "degraded") => void;
      fake.service.previewTarget = vi.fn(async (selected): Promise<LiveTargetSession> => {
        let current: ReturnType<LiveTargetSession["snapshot"]> = {
          status: "connecting",
          target: selected,
        };
        let listener: Parameters<LiveTargetSession["subscribe"]>[0] | undefined;
        publish = (status) => {
          current = {
            status,
            target: selected,
            issue: status === "degraded" ? "Stream ended" : undefined,
          };
          listener?.(current);
        };
        return {
          snapshot: () => current,
          subscribe(next) {
            listener = next;
            next(current);
            return () => {
              listener = undefined;
            };
          },
          mount(canvas) {
            canvas.width = 1080;
            canvas.height = 1920;
            return stop;
          },
          setAccessibilityInspection: inspection,
          input,
          close,
        };
      });
      await renderJourney(
        "/recordings/workflow-1/review",
        fake.service,
        platformWithStorage().platform,
      );
      await click(button("Open Settings"));
      const recordedSource = document.querySelector<HTMLImageElement>(
        'img[alt="After the step: Open Settings"]',
      )?.src;
      expect(recordedSource).toBeTruthy();
      expect(fake.service.previewTarget).not.toHaveBeenCalled();
      await click(button(operation === "save" ? "Run and save" : "Run test"));
      expect(fake.service.previewTarget).toHaveBeenCalledExactlyOnceWith(target, undefined);
      expect(inspection).toHaveBeenCalledExactlyOnceWith(false);
      expect(
        document.querySelector('[aria-label="Connecting to live device preview"]'),
      ).not.toBeNull();
      expect(document.body.textContent).not.toContain("Recorded screenshot · not live");
      await act(async () => publish("streaming"));
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-slot="live-native-run-canvas"]',
      )!;
      expect(canvas).not.toBeNull();
      expect(canvas.tabIndex).toBe(-1);
      expect(document.body.textContent).toContain("Live device · read only");
      await act(async () => {
        canvas.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, clientX: 30, clientY: 40 }),
        );
        canvas.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
        publish("degraded");
      });
      expect(input).not.toHaveBeenCalled();
      expect(fake.calls).not.toContain("observe-target");
      expect(fake.calls).not.toContain("inspect-target-health");
      expect(document.body.textContent).toContain("Recorded screenshot · not live");
      expect(document.querySelector<HTMLImageElement>('img[alt="Recorded screenshot"]')?.src).toBe(
        recordedSource,
      );
      await act(async () => finishReplay());
      await settle();
      expect(close).toHaveBeenCalledOnce();
      expect(stop).toHaveBeenCalledOnce();
      expect(document.querySelector('[data-slot="live-native-run-preview"]')).toBeNull();
      expect(
        document.querySelector<HTMLImageElement>('img[alt="After the step: Open Settings"]')?.src,
      ).toBe(recordedSource);
      expect(
        document.querySelector('[aria-label="Recorded actions"] li.bg-muted\\/60')?.textContent,
      ).toContain("Open Settings");
      if (operation === "save") {
        expect(button("Saving…").disabled).toBe(true);
        await act(async () => finishSave());
        await settle();
      }
    },
  );

  it("keeps a verified recording as Save test without a separate execution", async () => {
    const initial = state("reviewing", ["inspect", "edit", "replay", "approve"], {
      replay: "passed",
    });
    initial.snapshot!.review!.currentRevision = 7;
    const fake = fakeService(initial);
    const preview = vi.spyOn(fake.service, "previewTarget");
    fake.service.save = vi.fn((input) => fake.service.approve(input.testName));
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    expect(button("Save test").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Run and save");
    await click(button("Save test"));
    expect(fake.service.save).toHaveBeenCalledWith(expect.objectContaining({ reviewRevision: 7 }));
    expect(fake.calls).not.toContain("replay");
    expect(preview).not.toHaveBeenCalled();
  });

  it("names execution when an unsaved instruction changes a verified recording", async () => {
    const initial = state("reviewing", ["inspect", "edit", "replay", "approve"], {
      replay: "passed",
    });
    initial.snapshot!.review!.currentRevision = 7;
    const fake = fakeService(initial);
    fake.service.save = vi.fn(async () => initial);
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    expect(button("Save test").disabled).toBe(false);
    await click(button("Edit steps"));
    await fill(document.querySelector<HTMLInputElement>("#review-action-intent")!, "Open profile");
    expect(button("Run and save").disabled).toBe(false);
    await click(button("Run and save"));
    expect(fake.service.save).toHaveBeenCalledWith(
      expect.objectContaining({ rename: { actionId: "step-1", intent: "Open profile" } }),
    );
    expect(fake.calls).not.toContain("replay");
  });

  it.each([false, true])(
    "discloses whether adding recorded steps will run first (%s)",
    async (verified) => {
      const initial = state(
        "reviewing",
        verified ? ["inspect", "edit", "replay", "approve"] : ["inspect", "edit", "replay"],
        verified ? { replay: "passed" } : {},
      );
      initial.snapshot!.review!.currentRevision = 7;
      const fake = fakeService(initial);
      fake.service.save = vi.fn(async () => initial);
      const storage = platformWithStorage();
      await rememberRecordingInto(storage.platform, "workflow-1", {
        testId: "checkout",
        testName: "Complete checkout",
        appMapId: "app-1",
      });
      await renderJourney("/recordings/workflow-1/review", fake.service, storage.platform);
      const label = verified ? "Add to “Complete checkout”" : "Run and add to “Complete checkout”";
      expect(button(label).disabled).toBe(false);
      expect(document.body.textContent).not.toContain("Save test");
      await click(button(label));
      expect(fake.service.save).toHaveBeenCalledWith(
        expect.objectContaining({
          testName: "Complete checkout · added steps",
          reviewRevision: 7,
        }),
      );
      expect(fake.calls).not.toContain("replay");
      expect(fake.calls).not.toContain("approve");
      expect(storage.values.get("relay:recording-into:workflow-1")).toContain("checkout");
    },
  );

  it("keeps explicit replay available in More review actions", async () => {
    const initial = state("reviewing", ["inspect", "replay"]);
    initial.snapshot!.review!.currentRevision = 7;
    const fake = fakeService(initial);
    fake.service.save = vi.fn();
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    await click(button("More review actions"));
    const run = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === "Run without saving",
    );
    expect(run).toBeDefined();
    await click(run!);
    expect(fake.calls).toContain("replay");
    expect(fake.service.save).not.toHaveBeenCalled();
  });

  it("saves an unverified draft and its pending instruction without operating the app", async () => {
    const initial = state("reviewing", ["inspect", "edit", "replay"]);
    initial.snapshot!.review!.currentRevision = 7;
    const fake = fakeService(initial);
    fake.service.save = vi.fn();
    fake.service.saveDraft = vi.fn(async (input) =>
      input.rename
        ? fake.service.edit({ kind: "rename", ...input.rename })
        : fake.service.inspect("workflow-1"),
    );
    const { history } = await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    await click(button("Edit steps"));
    await fill(
      document.querySelector<HTMLInputElement>("#review-action-intent")!,
      "My saved instruction",
    );
    await click(button("Save draft"));
    expect(fake.service.saveDraft).toHaveBeenCalledWith({
      reviewRevision: 7,
      rename: { actionId: "step-1", intent: "My saved instruction" },
    });
    expect(history.location.pathname).toBe("/tests");
    expect(fake.calls).not.toContain("replay");
    expect(fake.calls).not.toContain("approve");
    expect(fake.service.save).not.toHaveBeenCalled();
    expect(history.location.search).toContain("view=drafts");
    expect(history.location.search).toContain("app=app-1");
  });

  it("keeps a failed Save visible when a subsequent inspection is healthy", async () => {
    const initial = state("reviewing", ["inspect", "edit", "replay"]);
    initial.snapshot!.review!.currentRevision = 7;
    const fake = fakeService(initial);
    fake.service.save = async () => ({
      ...initial,
      recovery: {
        code: "unexpected-authoring-state",
        title: "The steps changed",
        detail: "The reviewed steps changed before this test could be saved.",
        recovery: "Review the updated steps and save again.",
        retryable: true,
      },
    });
    const { history } = await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    await click(button("Run and save"));
    expect(history.location.pathname).toBe("/recordings/workflow-1/review");
    expect(document.body.textContent).toContain("The steps changed");
    expect(fake.calls).not.toContain("approve");
    await click(button("Check status"));
    expect(document.body.textContent).toContain("The steps changed");
    expect(document.querySelector('[aria-label="Run and save"]')).toBeNull();
  });

  it("follows the full server-owned progression with one dominant review action", async () => {
    const fake = fakeService();
    const storage = platformWithStorage();
    const { history } = await renderJourney("/tests/new", fake.service, storage.platform);

    await beginRecording();
    expect(history.location.pathname).toBe("/recordings/workflow-1");
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Taps and typing appear here."),
    );
    expect(document.querySelector('[aria-label="Interactive Device: Pixel 9 Pro"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("emulator-5554");
    const liveTextInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="Type into the app"]',
    );
    expect(liveTextInput?.id).toMatch(/^live-target-text-/);
    expect(document.querySelector(`label[for="${liveTextInput?.id}"]`)).not.toBeNull();

    await interactWithLiveTarget();
    await fill(
      document.querySelector<HTMLInputElement>('input[placeholder="Type into the app"]')!,
      "Arabic",
    );
    await click(button("Type text into app"));
    await click(button("Save screenshot"));
    const checkpoint = document.querySelector<HTMLInputElement>("#checkpoint-label")!;
    await fill(checkpoint, "Language screen");
    await click(button("Save"));
    await click(button("Stop and review"));

    expect(history.location.pathname).toBe("/recordings/workflow-1/review");
    expect(String(history.location.search)).toBe("");
    expect(document.querySelector("#recording-actions-title")?.getAttribute("aria-label")).toBe(
      "2 steps",
    );
    expect(button("Run test").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Save test");

    await click(button("Run test"));
    expect(document.body.textContent).toContain("Verified");
    expect(document.body.textContent).not.toContain(
      "Replay runs these steps on Pixel 9 Pro before saving.",
    );
    expect(document.body.textContent).not.toContain("Replay recording");
    expect(document.body.textContent).not.toContain("Replay again");
    expect(document.body.textContent).not.toContain("Save draft");
    expect(button("Save test").disabled).toBe(false);

    await fill(document.querySelector<HTMLInputElement>("#review-test-name")!, "Language tour");
    expect(document.querySelector('[aria-label="Recording status"]')?.textContent).toBe("Verified");
    await click(button("Save test"));
    expect(history.location.pathname).toBe("/tests/test-1");
    expect(document.body.textContent).not.toContain("Open test");
    expect(storage.values.has("activeRecordingWorkflowId")).toBe(false);
    expect(fake.calls).toEqual(
      expect.arrayContaining([
        "begin:Grok recording:app-1:emulator-5554",
        "input:touch",
        "input:scroll",
        "input:key",
        "input:key",
        "checkpoint:Language screen",
        "stop",
        "replay",
        "approve",
      ]),
    );
    expect(fake.calls.filter((call) => call === "input:key").length).toBeGreaterThanOrEqual(3);
  });

  it("drains a delayed live input before Stop and review", async () => {
    const fake = fakeService();
    const originalLiveTarget = fake.service.liveTarget!;
    let releaseInput!: () => void;
    let inputStarted = false;
    const inputGate = new Promise<void>((resolve) => {
      releaseInput = resolve;
    });
    fake.service.liveTarget = async (selected) => {
      const session = await originalLiveTarget(selected);
      return {
        ...session,
        async input(input) {
          if (input.kind === "key") {
            inputStarted = true;
            await inputGate;
          }
          await session.input(input);
        },
      };
    };

    const { history } = await renderJourney(
      "/tests/new",
      fake.service,
      platformWithStorage().platform,
    );
    await beginRecording();
    await fill(
      document.querySelector<HTMLInputElement>('input[placeholder="Type into the app"]')!,
      "Arabic",
    );
    await click(button("Type text into app"));
    expect(inputStarted).toBe(true);

    await act(async () => {
      button("Stop and review").click();
    });
    await settle();
    expect(fake.calls).not.toContain("stop");
    expect(document.body.textContent).toContain("Finishing interaction…");
    expect(history.location.pathname).toBe("/recordings/workflow-1");

    releaseInput();
    await settle();
    await settle();
    expect(history.location.pathname).toBe("/recordings/workflow-1/review");
    expect(document.querySelector("#recording-actions-title")?.getAttribute("aria-label")).toBe(
      "2 steps",
    );
    expect(fake.calls.indexOf("input:key")).toBeLessThan(fake.calls.indexOf("stop"));
  });

  it("renames a recorded action through the canonical edit transition", async () => {
    const fake = fakeService(state("reviewing", ["inspect", "edit", "replay"]));
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );

    await click(button("Edit steps"));
    const instruction = document.querySelector<HTMLInputElement>("#review-action-intent");
    if (!instruction) throw new Error("Action instruction editor was not rendered");
    await fill(instruction, "Open language settings");
    await click(button("Save instruction"));

    expect(fake.calls).toContain("edit:rename");
    expect(document.body.textContent).not.toContain("Replay to verify edits");
    expect(button("Run test").disabled).toBe(false);
  });

  it("replaces a tap target by picking a control from evidence", async () => {
    const reviewing = state("reviewing", ["inspect", "edit", "replay"]);
    if (!reviewing.snapshot?.review) throw new Error("Review fixture was not created");
    reviewing.snapshot.review.actions[0]!.kind = "tap";
    reviewing.snapshot.review.currentRevision = 2;
    reviewing.snapshot.review.revisionCount = 2;
    const fake = fakeService(reviewing);
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );

    await click(button("Edit steps"));
    expect(document.querySelector("#review-replacement-label")).toBeNull();
    await click(button("Change target"));
    for (
      let attempt = 0;
      attempt < 12 && !document.body.textContent?.includes("Preferred language");
      attempt += 1
    ) {
      await settle();
    }
    await click(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
        item.textContent?.includes("Preferred language"),
      )!,
    );
    expect(document.body.textContent).toContain("Matched the visible name");
    await click(button("Try on device"));
    expect(document.body.textContent).toContain(
      "Relay tried Preferred language as the saved binding.",
    );
    expect(fake.calls.filter((call) => call === "input:tap")).toEqual(["input:tap"]);
    await click(button("Use target"));

    expect(fake.edits).toContainEqual({
      kind: "replace",
      actionId: "step-1",
      interaction: { kind: "tap", target: { label: "Preferred language" } },
    });
  });

  it("trims the reviewed time range", async () => {
    const reviewing = state("reviewing", ["inspect", "edit", "replay"]);
    if (!reviewing.snapshot?.review) throw new Error("Review fixture was not created");
    Object.assign(reviewing.snapshot.review, {
      currentRevision: 3,
      revisionCount: 3,
      timeline: {
        startedAt: 1_000,
        finishedAt: 11_000,
        durationMs: 10_000,
        actionCount: 2,
        evidenceCount: 2,
        observationCount: 3,
      },
    });
    const trimFake = fakeService(reviewing);
    await renderJourney(
      "/recordings/workflow-1/review",
      trimFake.service,
      platformWithStorage().platform,
    );
    await click(button("Edit steps"));
    const ranges = document.querySelectorAll<HTMLInputElement>('input[type="range"]');
    await fill(ranges[0]!, "1000");
    await click(button("Apply trim"));
    expect(trimFake.edits[0]).toEqual({ kind: "clip", fromMs: 1_000, toMs: 10_000 });
  });

  it("restores a prior immutable revision for Undo", async () => {
    const undoReview = state("reviewing", ["inspect", "edit", "replay"]);
    if (!undoReview.snapshot?.review) throw new Error("Review fixture was not created");
    undoReview.snapshot.review.currentRevision = 3;
    undoReview.snapshot.review.revisionCount = 3;
    const undoFake = fakeService(undoReview);
    await renderJourney(
      "/recordings/workflow-2/review",
      undoFake.service,
      platformWithStorage().platform,
    );
    await click(button("Edit steps"));
    await click(button("Undo"));
    expect(undoFake.edits[0]).toEqual({ kind: "restore", sourceRevision: 2 });
    await click(button("Redo"));
    expect(undoFake.edits[1]).toEqual({ kind: "restore", sourceRevision: 3 });
  });

  it("labels optimizer output as review-only and never applies it automatically", async () => {
    const fake = fakeService(state("reviewing", ["inspect", "edit", "replay"]));
    fake.service.getOptimization = async () => ({
      proposal: {
        schemaVersion: 1,
        kind: "authoring-raw-optimization",
        reviewOnly: true,
        takeId: "take-1",
        captureVersion: 2,
        baseRevision: 1,
        sourceEventIds: ["raw-1"],
        suggestions: [
          {
            kind: "review-wait",
            rawEventId: "raw-1",
            actionId: "step-1",
            reason: "This wait may be longer than the visible transition needs.",
          },
        ],
      },
    });
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );

    await click(button("Edit steps"));
    await click(button("Suggest improvements"));
    expect(document.body.textContent).toContain("suggested improvements");
    expect(document.body.textContent).toContain("Select a suggestion to inspect its step.");
    expect(fake.edits).toHaveLength(0);
  });

  it("opens and controls the selected target before recording begins", async () => {
    const fake = fakeService();
    const { history } = await renderJourney(
      "/tests/new",
      fake.service,
      platformWithStorage().platform,
    );
    expect(document.querySelector('[aria-label="Recording stage"]')).not.toBeNull();
    expect(button("Start recording").disabled).toBe(false);
    await interactWithLiveTarget();
    expect(fake.calls).toContain("input:touch");
    expect(fake.calls.some((call) => call.startsWith("begin:"))).toBe(false);

    await click(button("Start recording"));
    expect(history.location.pathname).toBe("/recordings/workflow-1");
  });

  it("restores a compatible returning-user app and target default", async () => {
    const fake = fakeService();
    const storage = platformWithStorage({
      newTestDraft: JSON.stringify({ appId: "app-1", targetId: "emulator-5554" }),
    });
    await renderJourney("/tests/new", fake.service, storage.platform);

    expect(document.querySelector('[aria-label="App"]')?.textContent).toContain("Grok");
    expect(document.querySelector('[aria-label="Record on"]')?.textContent).toContain(
      "Pixel 9 Pro",
    );
    expect(button("Start recording").disabled).toBe(false);
  });

  it("asks for a destination when the remembered device is gone and several targets are ready", async () => {
    const fake = fakeService();
    const phone = { kind: "device", platform: "android", targetId: "samsung-phone" } as const;
    const browser = { kind: "browser", platform: "browser", targetId: "browser-one" } as const;
    fake.service.connect = async () => ({
      status: "target-selection",
      targets: [browser, phone, { ...phone, targetId: "second-phone" }],
    });
    fake.service.presentTargets = async (targets) =>
      targets.map((target) => ({ ...target, name: target.targetId, detail: "Ready" }));
    const storage = platformWithStorage({
      newTestDraft: JSON.stringify({ appId: "app-1", targetId: "old-emulator" }),
    });
    await renderJourney("/tests/new", fake.service, storage.platform);
    expect(document.querySelector('[aria-label="Record on"]')?.textContent).toContain(
      "Choose a phone, tablet or emulator",
    );
    expect(document.body.textContent).not.toContain("Your selected device isn’t ready");
    expect(document.body.textContent).not.toContain("Start recording");
    expect(fake.calls.some((call) => call.startsWith("begin:"))).toBe(false);
  });

  it("does not replace an explicitly requested unavailable device with a different phone", async () => {
    const fake = fakeService();
    await renderJourney(
      "/tests/new?app=app-1&target=other-phone",
      fake.service,
      platformWithStorage().platform,
    );
    expect(document.body.textContent).toContain("Your selected device isn’t ready");
    expect(button("Start recording").disabled).toBe(true);
    expect(fake.calls.some((call) => call.startsWith("begin:"))).toBe(false);
  });

  it("uses the route parameter to adopt a recording after refresh", async () => {
    const fake = fakeService();
    const storage = platformWithStorage();
    await renderJourney("/recordings/workflow-1", fake.service, storage.platform);

    expect(document.body.textContent).toContain("Taps and typing appear here.");
    expect(fake.calls).toContain("inspect:workflow-1");
    expect(storage.values.get("activeRecordingWorkflowId")).toBe("workflow-1");
  });

  it("projects low-level capture actions as human review moments", async () => {
    const reviewing = state("reviewing", ["inspect", "replay", "approve"], {
      replay: "passed",
    });
    if (!reviewing.snapshot?.review) throw new Error("Review fixture was not created");
    const actualProjection: ProductRecordingState = {
      ...reviewing,
      snapshot: {
        ...reviewing.snapshot,
        review: {
          ...reviewing.snapshot.review,
          actionCount: 5,
          actions: [
            {
              id: "tap-target",
              intent: "Tap target",
              stepCount: 1,
              proofStatus: "pixels-only",
              captureProof: "replay-proved",
            },
            {
              id: "tap-named-target",
              intent: "Tap “Arabic”",
              stepCount: 1,
              proofStatus: "verified",
              captureProof: "replay-proved",
            },
            {
              id: "observed-state",
              intent: "0 recorded steps",
              stepCount: 0,
              proofStatus: "pixels-only",
              captureProof: "replay-proved",
            },
            {
              id: "pause",
              intent: "Recorded pause",
              label: "Recorded pause",
              stepCount: 1,
              captureProof: "replay-proved",
            },
            {
              id: "checkpoint",
              intent: "Language settings visible",
              label: "Language settings visible",
              stepCount: 0,
              proofStatus: "pixels-only",
              captureProof: "replay-proved",
            },
          ],
        },
      },
    };
    const fake = fakeService(actualProjection);
    const storage = platformWithStorage();
    await renderJourney("/recordings/workflow-1/review", fake.service, storage.platform);

    expect(document.querySelector("#recording-actions-title")?.getAttribute("aria-label")).toBe(
      "5 steps",
    );
    expect(document.body.textContent).toContain("Tap the highlighted control");
    expect(document.body.textContent).toContain("Tap Arabic");
    expect(document.body.textContent).not.toContain("Tap target");
    expect(document.body.textContent).toContain("Screen capture");
    expect(document.body.textContent).toContain("Pause");
    expect(document.body.textContent).toContain("Language settings visible");
    expect(document.body.textContent).toContain("Verified");
    expect(document.body.textContent).not.toContain("0 recorded steps");
    expect(document.body.textContent).not.toContain("Recorded pause");
    expect(document.body.textContent).not.toContain(
      "Replay runs these steps on Pixel 9 Pro before saving.",
    );
    expect(document.body.textContent).not.toContain("replay it before saving the test");
    expect(document.body.textContent).not.toContain("Replay again");
  });

  it("keeps a failed replay calm and does not expose its internal error", async () => {
    const reviewing = state("reviewing", ["inspect", "replay"], { replay: "failed" });
    if (!reviewing.snapshot?.review?.latestReplay) throw new Error("Replay fixture missing");
    const failed: ProductRecordingState = {
      ...reviewing,
      snapshot: {
        ...reviewing.snapshot,
        review: {
          ...reviewing.snapshot.review,
          latestReplay: {
            ...reviewing.snapshot.review.latestReplay,
            error: "selector app:id/language failed against raw accessibility geometry",
          },
        },
      },
    };
    const fake = fakeService(failed);
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );

    expect(document.body.textContent).toContain("Run failed");
    expect(button("Run test").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("app:id/language");
    expect(document.body.textContent).not.toContain("accessibility geometry");
  });

  it("points to the exact failed reviewed step and its replay screen without hiding unknown status", async () => {
    const failed = state("reviewing", ["inspect", "edit", "replay"], { replay: "failed" });
    const review = failed.snapshot!.review!;
    const frame = {
      id: "failure-frame",
      kind: "screenshot" as const,
      capturedAt: 7,
      roles: ["entrance"] as const,
    };
    review.actions = Array.from({ length: 4 }, (_, index) => ({
      ...review.actions[0]!,
      id: `step-${index + 1}`,
      intent: index === 3 ? "Settings" : `Action ${index + 1}`,
      kind: "tap" as const,
      evidence: [
        {
          id: `recorded-${index + 1}`,
          kind: "screenshot" as const,
          capturedAt: 1,
          roles: ["entrance", "exit"] as const,
        },
      ],
    }));
    review.latestReplay!.failedAction = {
      actionId: "step-4",
      ordinal: 4,
      intent: "Settings",
      detail: "The control is not available on this screen.",
      evidence: [frame],
    };
    review.latestReplay!.error =
      "Step 1: selector open-settings is not present in the accessibility tree";
    Object.assign(failed, {
      recovery: {
        code: "operation-unavailable",
        title: "Replay did not prove the reviewed recording",
        detail: "Step 4 · Settings: The control is not available on this screen.",
        recovery: "Review this step before running again.",
        retryable: true,
      },
    });
    const fake = fakeService(failed);
    const evidence = vi.spyOn(fake.service, "getEvidencePreview");
    const { history } = await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    expect(document.body.textContent).toContain("Step 4 · Settings");
    expect(document.body.textContent).toContain("The control is not available on this screen.");
    expect(document.body.textContent).not.toContain("selector open-settings");
    expect(document.querySelector("#recording-evidence-title")?.textContent).toContain("Step 4");
    expect(evidence).toHaveBeenCalledWith("recording-1", "failure-frame");
    expect(button("At failure").getAttribute("aria-pressed")).toBe("true");
    await click(button("Before"));
    expect(button("Before").getAttribute("aria-pressed")).toBe("true");
    expect(button("At failure").getAttribute("aria-pressed")).toBe("false");
    expect(evidence).toHaveBeenCalledWith("recording-1", "recorded-4");
    await click(button("Edit step"));
    expect(button("At failure").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector<HTMLInputElement>("#review-action-intent")?.value).toBe(
      "Settings",
    );
    expect(button("Remove action").disabled).toBe(false);
    expect(fake.edits).toEqual([]);
    expect(history.location.pathname).toBe("/recordings/workflow-1/review");
  });

  it("keeps replay uncertainty fenced even when an earlier failed action is retained", async () => {
    const unavailable = state("reviewing", ["inspect"], { replay: "failed" });
    unavailable.snapshot!.phase = "needs-attention";
    unavailable.snapshot!.review!.latestReplay!.failedAction = {
      actionId: unavailable.snapshot!.review!.actions[0]!.id,
      ordinal: 1,
      intent: "Settings",
      detail: "Earlier failure",
      evidence: [],
    };
    Object.assign(unavailable, {
      recovery: {
        code: "mutation-outcome-unknown",
        title: "Replay status unknown",
        detail: "Receipt pending",
        recovery: "Inspect",
        retryable: false,
      },
    });
    const fake = fakeService(unavailable);
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    expect(document.body.textContent).toContain("Recording status needs checking.");
    expect(document.body.textContent).not.toContain("Earlier failure");
    expect(document.body.textContent).not.toContain("Step status needs checking");
    expect(document.querySelector('[aria-label="Edit steps"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Edit step");
    expect(fake.calls).not.toContain("replay");
  });

  it("never presents a retained snapshot as live while recovery is required", async () => {
    const unavailable: ProductRecordingState = {
      ...state("recording", ["inspect"]),
      status: "needs-attention",
      recovery: {
        code: "transport",
        title: "Relay could not inspect this recording",
        detail: "The connection was interrupted.",
        recovery: "Restore the connection and inspect again.",
        retryable: true,
      },
    };
    const fake = fakeService(unavailable);
    const storage = platformWithStorage();
    await renderJourney("/recordings/workflow-1", fake.service, storage.platform);

    expect(document.body.textContent).toMatch(/Recording (?:paused|interrupted)/);
    expect(document.body.textContent).not.toContain("Continue on the connected target");
    expect(document.body.textContent).not.toContain("Taps and typing appear here.");
    expect(document.body.textContent).not.toContain("Capture screen");
    expect(button("Stop and review").disabled).toBe(true);
  });

  it("does not show target choices from a failed connection", async () => {
    const fake = fakeService();
    fake.service.connect = async () => ({
      status: "needs-attention",
      targets: [target],
      selectedTarget: target,
      recovery: {
        code: "transport",
        title: "Relay could not load ready devices",
        detail: "The connection was interrupted.",
        recovery: "Check the connection, then try again.",
        retryable: true,
      },
    });
    await renderJourney("/tests/new", fake.service, platformWithStorage().platform);

    expect(document.body.textContent).toContain("Relay could not load ready devices");
    expect(document.body.textContent).not.toContain("Start recording");
    expect(document.body.textContent).not.toContain("Pixel 9 Pro");
  });

  it("keeps saved review content visible without offering mutations during recovery", async () => {
    const unavailable: ProductRecordingState = {
      ...state("reviewing", ["inspect", "replay", "approve"], { replay: "passed" }),
      status: "needs-attention",
      recovery: {
        code: "transport",
        title: "Relay could not inspect this recording",
        detail: "The connection was interrupted.",
        recovery: "Restore the connection and inspect again.",
        retryable: true,
      },
    };
    const fake = fakeService(unavailable);
    const storage = platformWithStorage();
    await renderJourney("/recordings/workflow-1/review", fake.service, storage.platform);

    expect(document.body.textContent).toContain("Relay could not inspect this recording");
    expect(document.body.textContent).toContain("Steps");
    expect(document.body.textContent).not.toContain("Run test");
    expect(document.body.textContent).not.toContain("Save test");
  });

  it("recovers interrupted replay by observing once, then offers an explicit run", async () => {
    const interrupted: ProductRecordingState = {
      ...state("reviewing", ["inspect"]),
      recovery: {
        code: "mutation-outcome-unknown",
        title: "Interrupted replay",
        action: "replay",
        detail: "Replay response was lost",
        recovery: "Review saved steps",
        retryable: false,
      },
    };

    interrupted.snapshot!.phase = "needs-attention";
    interrupted.snapshot!.review!.recovery = "observe";
    const fake = fakeService(interrupted);
    fake.service.recoverForReview = vi.fn(async () => {
      fake.service.inspect = async () => state("reviewing", ["inspect", "edit", "replay"]);
      return fake.service.inspect("workflow-1");
    });
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    expect(document.body.textContent).toContain("Your saved steps are safe");
    expect(document.body.textContent).not.toContain("Save test");
    await act(async () => button("Review saved steps").click());
    await settle();
    expect(fake.service.recoverForReview).toHaveBeenCalledWith("recording-1");
    expect(button("Run test").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Save test");
  });

  it("clears a capture warning once canonical inspection confirms the saved step", async () => {
    const healthy = state("recording", ["inspect", "record", "stop"]);
    const fake = fakeService(healthy);
    fake.service.captureFullPage = async () => ({
      ...healthy,
      status: "needs-attention",
      recovery: {
        code: "mutation-outcome-unknown",
        title: "Checking the last step",
        detail: "Awaiting confirmation",
        recovery: "Inspect again",
        retryable: true,
      },
    });
    await renderJourney("/recordings/workflow-1", fake.service, platformWithStorage().platform);
    await click(button("Full page"));
    expect(document.querySelector('[data-slot="recording-problem"]')).toBeNull();
    expect(button("Stop and review").disabled).toBe(false);
  });

  it("retains a failed review recovery when status lacks an exact recovery receipt", async () => {
    const interrupted: ProductRecordingState = {
      ...state("reviewing", ["inspect"]),
      status: "needs-attention",
      recovery: {
        code: "mutation-outcome-unknown",
        title: "Replay status unknown",
        detail: "Receipt pending",
        recovery: "Inspect",
        retryable: false,
      },
    };
    interrupted.snapshot!.phase = "needs-attention";
    interrupted.snapshot!.review!.recovery = "observe";
    const fake = fakeService(interrupted);
    fake.service.recoverForReview = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    await click(button("Review saved steps"));
    expect(document.body.textContent).toContain("Could not confirm opening saved steps");
    const other = state("reviewing", ["inspect", "edit", "replay"]);
    other.snapshot!.workflow!.workflowId = "other-workflow";
    fake.service.inspect = async () => other;
    await click(button("Check status"));
    expect(document.body.textContent).toContain("Could not confirm opening saved steps");
    fake.service.inspect = async () => interrupted;
    await click(button("Check status"));
    expect(document.body.textContent).toContain("Could not confirm opening saved steps");
    fake.service.inspect = async () => state("reviewing", ["inspect"]);
    await click(button("Check status"));
    expect(document.body.textContent).toContain("Could not confirm opening saved steps");
    fake.service.inspect = async () => state("reviewing", ["inspect", "edit", "replay"]);
    await click(button("Check status"));
    expect(document.body.textContent).toContain("Could not confirm opening saved steps");
    expect(fake.service.recoverForReview).toHaveBeenCalledOnce();
    expect(fake.calls).not.toContain("replay");
  });

  it.each(["New unsaved instruction", "Open Settings"])(
    "clears a failed draft save only when inspection proves its exact revision and preserves %s",
    async (newInstruction) => {
      const initial = state("reviewing", ["inspect", "edit", "replay"]);
      initial.snapshot!.review!.currentRevision = 7;
      const fake = fakeService(initial);
      fake.service.saveDraft = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      });
      await renderJourney(
        "/recordings/workflow-1/review",
        fake.service,
        platformWithStorage().platform,
      );
      await click(button("Edit steps"));
      await fill(
        document.querySelector<HTMLInputElement>("#review-action-intent")!,
        "Saved instruction",
      );
      await click(button("Save draft"));
      expect(document.body.textContent).toContain("Could not confirm the draft save");
      await click(button("Check status"));
      expect(document.body.textContent).toContain("Could not confirm the draft save");
      expect(document.querySelector<HTMLInputElement>("#review-action-intent")?.value).toBe(
        "Saved instruction",
      );
      await fill(
        document.querySelector<HTMLInputElement>("#review-action-intent")!,
        newInstruction,
      );
      const confirmed = structuredClone(initial);
      confirmed.snapshot!.review!.currentRevision = 8;
      fake.service.inspect = async () => confirmed;
      await click(button("Check status"));
      expect(document.body.textContent).toContain("Could not confirm the draft save");
      confirmed.snapshot!.review!.actions[0]!.intent = "Saved instruction";
      await click(button("Check status"));
      expect(document.body.textContent).not.toContain("Could not confirm the draft save");
      expect(document.querySelector<HTMLInputElement>("#review-action-intent")?.value).toBe(
        newInstruction,
      );
      expect(fake.service.saveDraft).toHaveBeenCalledOnce();
      expect(fake.calls).not.toContain("replay");
      expect(fake.calls).not.toContain("approve");
    },
  );

  it("retains a domain review recovery error after a healthy status read", async () => {
    const interrupted: ProductRecordingState = {
      ...state("reviewing", ["inspect"]),
      status: "needs-attention",
      recovery: {
        code: "mutation-outcome-unknown",
        title: "Replay status unknown",
        detail: "Receipt pending",
        recovery: "Inspect",
        retryable: false,
      },
    };
    interrupted.snapshot!.phase = "needs-attention";
    interrupted.snapshot!.review!.recovery = "observe";
    const fake = fakeService(interrupted);
    fake.service.recoverForReview = vi.fn(async () => {
      throw {
        title: "Saved steps need repair",
        detail: "One step needs a new captured control.",
        recovery: "Review the affected step.",
        retryable: true,
      };
    });
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    await click(button("Review saved steps"));
    fake.service.inspect = async () => state("reviewing", ["inspect", "edit", "replay"]);
    await click(button("Check status"));
    expect(document.body.textContent).toContain("Saved steps need repair");
    expect(document.body.textContent).not.toContain("Relay is not connected");
    expect(fake.service.recoverForReview).toHaveBeenCalledOnce();
    expect(fake.calls).not.toContain("replay");
  });

  it("does not call a local draft validation error a connection failure or render it twice", async () => {
    const initial = state("reviewing", ["inspect", "edit", "replay"]);
    initial.snapshot!.review!.currentRevision = 7;
    const fake = fakeService(initial);
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    await click(button("Edit steps"));
    await fill(
      document.querySelector<HTMLInputElement>("#review-action-intent")!,
      "Unsaved instruction",
    );
    await click(button("Back to tests"));
    expect(document.body.textContent).toContain("Save the instruction before closing this draft");
    expect(document.body.textContent).not.toContain("when the connection returns");
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>("#review-action-intent")?.value).toBe(
      "Unsaved instruction",
    );
    expect(fake.calls).not.toContain("replay");
  });

  it("retains an unconfirmed replay warning when canonical inspection has no matching proof", async () => {
    const healthy = state("reviewing", ["inspect", "replay"], { replay: "failed" });
    const fake = fakeService(healthy);
    fake.service.replay = async () => ({
      ...healthy,
      status: "needs-attention",
      recovery: {
        code: "transport",
        title: "Checking the last step",
        detail: "Awaiting confirmation",
        recovery: "Inspect again",
        retryable: true,
      },
    });
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    await click(button("Run test"));
    expect(document.querySelector("#recording-actions-title")?.getAttribute("aria-label")).toBe(
      "2 steps",
    );
    expect(document.body.textContent).toContain("Checking the last step");
  });

  it("keeps steps and repair controls visible after a known replay failure", async () => {
    const failed: ProductRecordingState = {
      ...state("reviewing", ["inspect", "edit", "replay"], { replay: "failed" }),
      recovery: {
        code: "operation-unavailable",
        title: "Replay did not prove the reviewed recording",
        detail: "Return to the recorded source",
        recovery: "Repair and replay",
        retryable: true,
      },
    };
    const fake = fakeService(failed);
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    expect(document.querySelector("#recording-actions-title")?.getAttribute("aria-label")).toBe(
      "2 steps",
    );
    expect(button("Run test").disabled).toBe(false);
    expect(document.body.textContent).toContain("Return to the recorded source");
  });

  it("keeps an unfinished recording as a resumable draft without approving it", async () => {
    const fake = fakeService(state("reviewing", ["inspect", "replay"], { replay: "failed" }));
    const storage = platformWithStorage({ activeRecordingWorkflowId: "workflow-1" });
    const { history } = await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      storage.platform,
    );
    await click(button("Back to tests"));
    expect(history.location.pathname).toBe("/tests");
    expect(storage.values.get("activeRecordingWorkflowId")).toBe("workflow-1");
    expect(fake.calls).not.toContain("approve");
  });

  it("keeps the draft open when the server cannot confirm its saved revision", async () => {
    const fake = fakeService(state("reviewing", ["inspect", "replay"], { replay: "failed" }));
    const { history } = await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    fake.service.inspect = async () => {
      throw new TypeError("Failed to fetch");
    };
    await click(button("Back to tests"));
    expect(history.location.pathname).toBe("/recordings/workflow-1/review");
    expect(document.body.textContent).toContain("Could not confirm the draft save");
    expect(document.body.textContent).not.toContain("when the connection returns");
    expect(fake.calls).not.toContain("approve");
  });

  it("leaves an interrupted recording for scoped tests without retrying Stop or cancelling its draft", async () => {
    const interrupted: ProductRecordingState = {
      ...state("recording", ["inspect"]),
      status: "needs-attention",
      recovery: {
        code: "mutation-outcome-unknown",
        title: "Relay could not confirm that authoring-stop finished",
        detail: "Pending authoring-stop receipt",
        recovery: "Inspect the saved workflow without repeating the request.",
        retryable: false,
      },
    };
    interrupted.snapshot!.phase = "needs-attention";
    const fake = fakeService(interrupted);
    fake.service.cancel = vi.fn(async () => state("cancelled", []));
    fake.service.stop = vi.fn(fake.service.stop);
    const storage = platformWithStorage({ activeRecordingWorkflowId: "workflow-1" });
    const { history } = await renderJourney(
      "/recordings/workflow-1",
      fake.service,
      storage.platform,
    );
    expect(document.body.textContent).toContain("Recording interrupted");
    expect(button("Stop and review").disabled).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(
      [...document.querySelectorAll("button")].some(
        (item) => item.textContent?.trim() === "Cancel",
      ),
    ).toBe(false);
    await click(button("Back to tests"));
    expect(history.location.pathname).toBe("/tests");
    expect(new URLSearchParams(history.location.search).get("app")).toBe("app-1");
    expect(storage.values.get("activeRecordingWorkflowId")).toBe("workflow-1");
    expect(fake.service.cancel).not.toHaveBeenCalled();
    expect(fake.service.stop).not.toHaveBeenCalled();
  });

  it("Cancel recording returns to the recording's app", async () => {
    let current = state("recording", ["inspect", "record", "stop"]);
    const fake = fakeService(current);
    fake.service.inspect = async () => current;
    fake.service.cancel = vi.fn(async () => (current = state("cancelled", [])));
    const { history } = await renderJourney(
      "/recordings/workflow-1",
      fake.service,
      platformWithStorage().platform,
    );
    await click(button("Cancel"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Cancel recording?");
    expect(fake.service.cancel).not.toHaveBeenCalled();
    expect(history.location.pathname).toBe("/recordings/workflow-1");
    await click(button("Cancel recording"));
    expect(fake.service.cancel).toHaveBeenCalledOnce();
    expect(history.location.pathname).toBe("/tests");
    expect(new URLSearchParams(history.location.search).get("app")).toBe("app-1");
  });

  it("cancelled recording falls back to All apps when canonical app identity is absent", async () => {
    const cancelled = state("cancelled", []);
    cancelled.snapshot!.frozen = undefined;
    const { history } = await renderJourney(
      "/recordings/workflow-1",
      fakeService(cancelled).service,
      platformWithStorage().platform,
    );
    expect(history.location.pathname).toBe("/tests");
    expect(new URLSearchParams(history.location.search).has("app")).toBe(false);
  });

  it("clears a matching recovery pointer after refreshing a committed workflow", async () => {
    const fake = fakeService(state("committed", [], { committed: true }));
    const storage = platformWithStorage({ activeRecordingWorkflowId: "workflow-1" });
    const { history } = await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      storage.platform,
    );

    expect(history.location.pathname).toBe("/tests/test-1");
    expect(storage.values.has("activeRecordingWorkflowId")).toBe(false);
  });

  it("clears a matching recovery pointer after a recording is cancelled", async () => {
    const fake = fakeService(state("cancelled", []));
    const storage = platformWithStorage({ activeRecordingWorkflowId: "workflow-1" });
    const { history } = await renderJourney(
      "/recordings/workflow-1",
      fake.service,
      storage.platform,
    );

    expect(storage.values.has("activeRecordingWorkflowId")).toBe(false);
    expect(history.location.pathname).toBe("/tests");
    expect(new URLSearchParams(history.location.search).get("app")).toBe("app-1");
  });

  it("reconciles and removes a terminal pointer before blocking a new recording", async () => {
    const fake = fakeService(state("cancelled", []));
    const storage = platformWithStorage({ activeRecordingWorkflowId: "workflow-1" });
    await renderJourney("/tests/new", fake.service, storage.platform);

    expect(fake.calls).toContain("inspect:workflow-1");
    expect(storage.values.has("activeRecordingWorkflowId")).toBe(false);
    expect(document.body.textContent).toContain("Start recording");
    expect(document.body.textContent).not.toContain("A recording is already in progress");
  });

  it("blocks a second recording after Back and offers the stored pointer", async () => {
    const fake = fakeService();
    const storage = platformWithStorage();
    const { history } = await renderJourney("/tests/new", fake.service, storage.platform);
    await beginRecording();

    await act(async () => history.back());
    await settle();
    expect(history.location.pathname).toBe("/tests/new");
    expect(document.body.textContent).toContain("A recording is already in progress");
    expect(document.body.textContent).not.toContain("Start recording");

    await click(button("Open recording"));
    expect(history.location.pathname).toBe("/recordings/workflow-1");
  });

  it("does not discard server-owned work from an unfinished recording", async () => {
    const fake = fakeService();
    const storage = platformWithStorage({ activeRecordingWorkflowId: "workflow-uncertain" });
    await renderJourney("/tests/new", fake.service, storage.platform);

    expect(storage.values.get("activeRecordingWorkflowId")).toBe("workflow-uncertain");
    expect(document.body.textContent).toContain(
      "Continue the recording you started before creating another test",
    );
    expect(document.body.textContent).toContain("Open recording");
    expect(document.body.textContent).not.toContain("Start over");
    expect(document.body.textContent).not.toContain("Start recording");
    expect(document.body.textContent).toContain("A recording is already in progress");
  });

  it("adopts uncertain server-owned work and hides the creation form", async () => {
    const fake = fakeService();
    fake.service.begin = async () => ({
      ...state("recording", ["inspect"]),
      status: "needs-attention",
      recovery: {
        code: "mutation-outcome-unknown",
        title: "Relay is checking whether recording started",
        detail: "The start response was interrupted.",
        recovery: "Open the recording to inspect its latest saved state.",
        retryable: true,
      },
    });
    const storage = platformWithStorage();
    const { history } = await renderJourney("/tests/new", fake.service, storage.platform);

    await beginRecording();

    expect(history.location.pathname).toBe("/tests/new");
    expect(storage.values.get("activeRecordingWorkflowId")).toBe("workflow-1");
    expect(document.body.textContent).toContain("Recording status needs review");
    expect(document.body.textContent).toContain("Open recording");
    expect(document.body.textContent).not.toContain("Start recording");

    await click(button("Open recording"));
    expect(history.location.pathname).toBe("/recordings/workflow-1");
  });

  it("resumes after the exact delayed recording receipt without repeating input", async () => {
    const fake = fakeService();
    const originalLiveTarget = fake.service.liveTarget!;
    const receipt = {
      mutationId: "recording-1",
      workflowId: "workflow-1",
      sessionId: "recording-1",
      transitionVersion: 5,
      target,
    };
    let finishReceipt!: (value: { outcome: "applied" }) => void;
    const fetchReceipt = vi.fn(
      () =>
        new Promise<{ outcome: "applied" }>((resolve) => {
          finishReceipt = resolve;
        }),
    );
    Object.assign(fake.service, { fetchRecordingInputReceipt: fetchReceipt });
    let inputCount = 0;
    fake.service.liveTarget = async (selected) => {
      const session = await originalLiveTarget(selected);
      return {
        ...session,
        async input() {
          inputCount += 1;
          throw Object.assign(new Error("record response arrived after transport timeout"), {
            recordingMutation: receipt,
          });
        },
      };
    };
    const storage = platformWithStorage();
    await renderJourney("/tests/new", fake.service, storage.platform);
    await beginRecording();
    await tapLiveTarget();
    expect(document.body.textContent).toContain("Recording paused: Relay lost confirmation");
    await tapLiveTarget();
    expect(inputCount).toBe(1);
    expect(fetchReceipt).toHaveBeenCalledWith(receipt);
    await act(async () => finishReceipt({ outcome: "applied" }));
    await settle();
    expect(document.body.textContent).not.toContain("Recording paused: Relay lost confirmation");
    expect(inputCount).toBe(1);
    expect(fake.calls.some((call) => call.startsWith("reconcile:"))).toBe(false);
    await click(button("Stop and review"));
    expect(fake.calls).toContain("stop");
  });

  it("blocks live input after an unknown dispatch until the user observes and reconciles", async () => {
    const fake = fakeService();
    const originalLiveTarget = fake.service.liveTarget!;
    let inputCount = 0;
    fake.service.liveTarget = async (selected) => {
      const session = await originalLiveTarget(selected);
      return {
        ...session,
        async input(input) {
          inputCount += 1;
          if (inputCount === 1) {
            throw new Error("Input submitted; runner not ready to acknowledge");
          }
          await session.input(input);
        },
      };
    };

    const { history } = await renderJourney(
      "/tests/new",
      fake.service,
      platformWithStorage().platform,
    );
    await beginRecording();
    await tapLiveTarget();

    expect(inputCount).toBe(1);
    expect(document.body.textContent).toContain("Recording paused: Relay lost confirmation");
    expect(document.body.textContent).not.toMatch(/was not sent/i);
    expect(document.body.textContent).not.toContain("Refresh recording");
    expect(button("It applied")).toBeTruthy();
    expect(button("It did not apply")).toBeTruthy();
    expect(document.body.textContent).toContain("Keep it paused to avoid repeating the action.");

    await tapLiveTarget();
    expect(inputCount).toBe(1);
    await click(button("Stop and review"));
    expect(fake.calls).not.toContain("stop");
    expect(history.location.pathname).toBe("/recordings/workflow-1");

    await click(button("It applied"));
    expect(
      fake.calls.some((call) => call.startsWith("reconcile:") && call.endsWith(":applied")),
    ).toBe(true);
    expect(document.body.textContent).not.toContain("Recording paused: Relay lost confirmation");
    await tapLiveTarget();
    expect(inputCount).toBe(2);
    await click(button("Stop and review"));
    expect(fake.calls).toContain("stop");
    expect(history.location.pathname).toBe("/recordings/workflow-1/review");
    expect(String(history.location.search)).toBe("");
  });

  it("lets the user retry after observing that the unknown interaction did not apply", async () => {
    const fake = fakeService();
    const originalLiveTarget = fake.service.liveTarget!;
    let inputCount = 0;
    fake.service.liveTarget = async (selected) => {
      const session = await originalLiveTarget(selected);
      return {
        ...session,
        async input(input) {
          inputCount += 1;
          if (inputCount === 1) {
            throw new Error("Input submitted; runner not ready to acknowledge");
          }
          await session.input(input);
        },
      };
    };

    await renderJourney("/tests/new", fake.service, platformWithStorage().platform);
    await beginRecording();
    await tapLiveTarget();
    expect(inputCount).toBe(1);
    await tapLiveTarget();
    expect(inputCount).toBe(1);
    await click(button("It did not apply"));
    expect(fake.calls.some((call) => call.endsWith(":not-applied"))).toBe(true);
    expect(document.body.textContent).not.toContain("Recording paused: Relay lost confirmation");
    expect(document.body.textContent).not.toMatch(/was not sent/i);
    // Acknowledging the exact old input only releases the pause. The next
    // native action is still an explicit tap, with no automatic repeat.
    expect(inputCount).toBe(1);
    await tapLiveTarget();
    expect(inputCount).toBe(2);
  });

  it("restores an uncertain Device mutation after remount without a local ledger", async () => {
    const fake = fakeService();
    fake.service.inspectTargetHealth = async () => {
      fake.calls.push("inspect-target-health");
      return {
        input: {
          state: "uncertain",
          pendingMutationId: "ios-input-reviewed",
          reason: "acknowledgement lost",
        },
      };
    };
    let inputCount = 0;
    const originalLiveTarget = fake.service.liveTarget!;
    fake.service.liveTarget = async (selected) => {
      const session = await originalLiveTarget(selected);
      return {
        ...session,
        async input(input) {
          inputCount += 1;
          await session.input(input);
        },
      };
    };

    await renderJourney("/recordings/workflow-1", fake.service, platformWithStorage().platform);
    await settle();
    await settle();

    expect(fake.calls).toContain("inspect-target-health");
    expect(document.body.textContent).toContain("Recording paused: Relay lost confirmation");
    expect(button("It applied")).toBeTruthy();
    expect(button("It did not apply")).toBeTruthy();
    expect(document.body.textContent).toContain("Keep it paused to avoid repeating the action.");
    await tapLiveTarget();
    expect(inputCount).toBe(0);
    await click(button("It applied"));
    expect(fake.calls).toContain("reconcile:ios-input-reviewed:applied");
    expect(document.body.textContent).not.toContain("Recording paused: Relay lost confirmation");
    await tapLiveTarget();
    expect(inputCount).toBe(1);
  });
});

describe("recording review request recovery", () => {
  it("shows a temporary service response from the actual Review loader and preserves drafts on recovery", async () => {
    const queryClient = queryClients.createRelayQueryClient();
    queryClient.setDefaultOptions({ queries: { retry: false, refetchOnWindowFocus: true } });
    vi.spyOn(queryClients, "createRelayQueryClient").mockReturnValue(queryClient);
    const session: AuthoringSession = {
      schemaVersion: 1,
      id: "recording-1",
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
      appMapId: "app-1",
      testName: "Change the app language",
      state: "reviewing",
      target,
      leaseId: "lease-fixture",
      expectedAppMapRevision: 2,
      captureProvenance: { schemaVersion: 1, mode: "control-and-record", origin: "relay-control" },
      createdAt: 1,
      updatedAt: 2,
      take: {
        id: "take-fixture",
        state: "reviewing",
        createdAt: 1,
        updatedAt: 2,
        currentRevision: 1,
        revisions: [
          {
            id: "revision-fixture",
            takeId: "take-fixture",
            revision: 1,
            createdAt: 1,
            createdBy: "human:test",
            reason: "recording",
            actions: [
              {
                id: "step-1",
                source: "captured",
                recordedAt: 1,
                startedAt: 1,
                finishedAt: 2,
                label: "Open Settings",
                steps: [{ kind: "tap", target: { label: "Settings" } }],
                evidenceIds: [],
                proofStatus: "verified",
              },
            ],
            evidence: [],
          },
        ],
        replayAttempts: [],
      },
    };
    let unavailable = false;
    let replyUnavailable!: (response: Response) => void;
    const requests: Request[] = [];
    const client = new RelayClient(
      {
        url: "https://relay.test",
        auth: { type: "none" },
        organizationId: "local",
        projectId: "default",
        actorId: "human:test",
        actorKind: "human",
      },
      {
        fetch: async (input, init) => {
          requests.push(new Request(input, init));
          if (unavailable)
            return new Promise<Response>((resolve) => {
              replyUnavailable = resolve;
            });
          return Response.json({
            workflow: {
              record: {
                schemaVersion: 1,
                workflowId: "workflow-1",
                organizationId: "local",
                projectId: "default",
                kind: "author-test",
                version: 4,
                status: "active",
                lastTransition: "authoring-stop-completed",
                frozenIdentity: {
                  title: session.testName,
                  actorId: session.actorId,
                  appMapId: session.appMapId,
                  appMapRevision: 2,
                  target,
                },
                resource: { kind: "authoring-session", id: session.id },
                createdBy: session.actorId,
                lastActorId: session.actorId,
                createdAt: 1,
                updatedAt: 2,
                expiresAt: 100_000,
              },
              audit: [],
            },
            session,
          });
        },
      },
    );
    const journey = createProductRecordingJourney({
      jobs: createRelayRecordingOutcomeJobs(client, { actorId: "human:test" }),
    });
    const fake = fakeService(state("reviewing", ["inspect", "edit", "replay"]));
    fake.service.inspect = (workflowId) => journey.inspect(workflowId);
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    expect(journey.state().recovery).toBeUndefined();
    await fill(
      document.querySelector<HTMLInputElement>("#review-test-name")!,
      "My unsaved test name",
    );
    await click(button("Edit steps"));
    await fill(
      document.querySelector<HTMLInputElement>("#review-action-intent")!,
      "My unsaved instruction",
    );
    unavailable = true;
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await settle();
    expect(document.body.textContent).not.toContain("Could not load the recording");
    expect(document.body.textContent).not.toContain("Recording status is temporarily unavailable");
    expect(document.querySelector<HTMLInputElement>("#review-action-intent")?.value).toBe(
      "My unsaved instruction",
    );
    await act(async () =>
      replyUnavailable(
        Response.json({ error: "private device serial and token" }, { status: 503 }),
      ),
    );
    await settle();
    expect(document.body.textContent).toContain("Recording status is temporarily unavailable");
    expect(document.body.textContent).toContain("Wait a moment, then check status.");
    expect(document.body.textContent).toContain("HTTP status: 503");
    expect(document.body.textContent).not.toContain("private device serial and token");
    expect(document.querySelector<HTMLInputElement>("#review-action-intent")?.disabled).toBe(true);
    unavailable = false;
    await click(button("Check status"));
    expect(document.body.textContent).not.toContain("Recording status is temporarily unavailable");
    expect(document.querySelector<HTMLInputElement>("#review-test-name")?.value).toBe(
      "My unsaved test name",
    );
    expect(document.querySelector<HTMLInputElement>("#review-action-intent")?.value).toBe(
      "My unsaved instruction",
    );
    expect(requests.length).toBe(3);
    expect(
      requests.every((request) => request.headers.get("x-relay-operation-id") === "workflow.get"),
    ).toBe(true);
    expect(fake.calls).not.toContain("replay");
    expect(fake.edits).toEqual([]);
    focusManager.setFocused(undefined);
  });

  it("keeps a follow-up read failure separate from a successful recovery action", async () => {
    const interrupted = state("reviewing", ["inspect"]);
    interrupted.snapshot!.phase = "needs-attention";
    interrupted.snapshot!.review!.recovery = "observe";
    Object.assign(interrupted, {
      recovery: {
        code: "mutation-outcome-unknown",
        action: "replay",
        title: "Unknown",
        detail: "Pending",
        recovery: "Inspect",
        retryable: false,
      },
    });
    const fake = fakeService(interrupted);
    const healthy = state("reviewing", ["inspect", "edit", "replay"]);
    let followUpFails = false;
    fake.service.inspect = async () => {
      if (followUpFails) throw new TypeError("Failed to fetch");
      return interrupted;
    };
    fake.service.recoverForReview = vi.fn(async () => {
      followUpFails = true;
      return healthy;
    });
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    await click(button("Review saved steps"));
    await act(async () => {
      await vi.waitFor(
        () => expect(document.body.textContent).toContain("Could not refresh the recording status"),
        { timeout: 2_500 },
      );
    });
    expect(document.body.textContent).not.toContain("Could not confirm opening saved steps");
    expect(document.body.textContent).toContain("Replay status needs checking");
    expect(document.body.textContent).toContain("Operation: Check recording status");
    fake.service.inspect = async () => healthy;
    await click(button("Check status"));
    expect(document.body.textContent).not.toContain("Could not refresh the recording status");
    expect(fake.service.recoverForReview).toHaveBeenCalledOnce();
    expect(fake.calls).not.toContain("replay");
  });

  it("clears a query-only interruption after a healthy status read without replay", async () => {
    const fake = fakeService(state("reviewing", ["inspect", "replay"]));
    const inspect = fake.service.inspect;
    let unavailable = true;
    fake.service.inspect = async (id) => {
      if (unavailable) throw new TypeError("Failed to fetch");
      return inspect(id);
    };
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    await act(async () => {
      await vi.waitFor(
        () => expect(document.body.textContent).toContain("Recording status is unavailable"),
        { timeout: 2_500 },
      );
    });
    unavailable = false;
    await click(button("Check status"));
    expect(document.body.textContent).not.toContain("Recording status is unavailable");
    expect(button("Run test").disabled).toBe(false);
    expect(fake.calls).not.toContain("replay");
  });

  it("retains a failed replay request after a healthy read with only an older passing replay", async () => {
    const fake = fakeService(
      state("reviewing", ["inspect", "replay", "approve"], { replay: "passed" }),
    );
    const replay = vi.fn(async () => {
      throw new ApiError(500, "private action details", { code: "ACTION_FAILED" });
    });
    fake.service.replay = replay;
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    await click(button("Run test"));
    expect(document.body.textContent).toContain("Could not confirm the replay");
    await click(button("Check status"));
    expect(document.body.textContent).toContain("Could not confirm the replay");
    expect(document.body.textContent).not.toContain("private action details");
    expect(replay).toHaveBeenCalledOnce();
  });

  it("retains an unsafe action result when inspection cannot prove that replay succeeded", async () => {
    const healthy = state("reviewing", ["inspect", "replay", "approve"], { replay: "passed" });
    const fake = fakeService(healthy);
    fake.service.replay = vi.fn(async (): Promise<ProductRecordingState> => ({
      ...healthy,
      recovery: {
        code: "mutation-outcome-unknown",
        action: "replay",
        title: "Replay status unknown",
        detail: "Receipt pending",
        recovery: "Inspect",
        retryable: false,
      },
    }));
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );
    await click(button("Run test"));
    expect(document.body.textContent).toContain("Replay status needs checking");
    await click(button("Check status"));
    expect(document.body.textContent).toContain("Replay status needs checking");
    expect(fake.service.replay).toHaveBeenCalledOnce();
    expect(
      [...document.querySelectorAll("button")].some(
        (item) => item.textContent?.trim() === "Run test" && !item.disabled,
      ),
    ).toBe(false);
  });
});

async function tapLiveTarget() {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-slot="capture-live-target"]');
  if (!canvas) throw new Error("Live target canvas not found");
  canvas.width = 320;
  canvas.height = 240;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 240 }) as DOMRect;
  canvas.setPointerCapture = () => undefined;
  await act(async () => {
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 40, clientY: 50 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 40, clientY: 50 }),
    );
  });
  await settle();
  await settle();
}
