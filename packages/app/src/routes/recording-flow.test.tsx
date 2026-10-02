import type { AppResourcesProductService } from "../data/app-resources-product-service";
/** @jsxImportSource react */
import type { AuthoringRecordingEdit } from "@relay/protocol";
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
import { RecordingInputNotSentError } from "../data/recording-input-outcome";
import type { MapProductService } from "../data/map-product-service";
import type { Platform } from "../platform/types";
import type { BrowserSpacesProductService } from "../data/browser-spaces-product-service";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const target = { kind: "device", platform: "android", targetId: "emulator-5554" } as const;
const roots: Root[] = [];
const emptyBrowserSpaces = {
  listSpaces: async () => [],
} as unknown as BrowserSpacesProductService;
const emptyAppResources = {
  createApp: async (name: string) => ({ id: name, name }),
  listVersions: async () => [],
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
    expect(button("Save Test").disabled).toBe(false);
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
    expect(document.querySelector<HTMLInputElement>("#review-test-name")?.value).toBe(
      "Second recording",
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

  it("carries the live page into Ask Relay without losing the workbench context", async () => {
    const fake = fakeService();
    const browserTarget = {
      kind: "browser" as const,
      platform: "browser" as const,
      targetId: "browser-checkout",
    };
    fake.service.connect = async () => ({
      status: "target-selection",
      targets: [browserTarget],
      selectedTarget: browserTarget,
    });
    fake.service.presentTargets = async () => [
      { ...browserTarget, name: "checkout.example", detail: "Managed browser · Ready" },
    ];
    fake.service.previewTarget = async () => {
      let status: ReturnType<LiveTargetSession["snapshot"]> = {
        status: "connecting",
        target: browserTarget,
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
          status = {
            status: "streaming",
            target: browserTarget,
            frameSequence: 1,
            browserContext: {
              sessionId: "session-test",
              pageUrl: "https://staging.example.test/account",
              engine: "chromium",
              viewport: { width: 1280, height: 800 },
              locale: "en",
            },
          };
          for (const listener of listeners) listener(status);
          return () => undefined;
        },
        async input() {
          fake.calls.push("input");
        },
        close() {
          status = { status: "closed", target: browserTarget };
        },
      };
    };
    const { history } = await renderJourney(
      "/tests/new?app=app-1&target=browser-checkout",
      fake.service,
      platformWithStorage().platform,
    );

    await act(async () => click(button("Explore URL in a new browser")));
    await settle();
    expect(history.location.pathname).toBe("/goals");
    expect(history.location.search).toBe(
      "?url=" + encodeURIComponent("https://staging.example.test/account"),
    );
    const urlInput = document.querySelector<HTMLInputElement>("#goal-start-url");
    expect(urlInput?.value).toBe("https://staging.example.test/account");
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
    expect(document.body.textContent).not.toContain("Where this Test belongs");
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
    expect(document.body.textContent).not.toContain("Save Test");
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

  it("opens setup with a starting app carried from the device", async () => {
    const fake = fakeService();
    await renderJourney(
      "/tests/new?target=emulator-5554&originApplication=com.android.settings",
      fake.service,
      platformWithStorage().platform,
    );
    expect(document.querySelector('form[aria-label="Record setup"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("This page couldn’t load");
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
    "keeps App context and respects an explicit saved account choice (%s)",
    async (useAccount) => {
      const fake = fakeService();
      const open = vi.fn().mockImplementation(async (spaceId: string) => ({
        targetId: spaceId,
        name: "Shop",
        url: "https://shop.example/",
      }));
      const create = vi.fn().mockResolvedValue({ id: "guest-browser" });
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
          listSpaces: async () => [{ id: "signed-in-browser", startUrl: "https://shop.example/" }],
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

  it("follows the full server-owned progression with one dominant review action", async () => {
    const fake = fakeService();
    const storage = platformWithStorage();
    const { history } = await renderJourney("/tests/new", fake.service, storage.platform);

    await beginRecording();
    expect(history.location.pathname).toBe("/recordings/workflow-1");
    expect(document.body.textContent).toContain("Taps and typing appear here.");
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
    expect(document.body.textContent).not.toContain("Save Test");

    await click(button("Run test"));
    expect(document.body.textContent).toContain("Verified");
    expect(document.body.textContent).not.toContain(
      "Replay runs these steps on Pixel 9 Pro before saving.",
    );
    expect(document.body.textContent).not.toContain("Replay recording");
    expect(document.body.textContent).not.toContain("Replay again");
    expect(document.body.textContent).not.toContain("Save draft");
    expect(button("Save Test").disabled).toBe(false);

    await fill(document.querySelector<HTMLInputElement>("#review-test-name")!, "Language tour");
    expect(document.querySelector('[aria-label="Recording status"]')?.textContent).toBe("Verified");
    await click(button("Save Test"));
    expect(history.location.pathname).toBe("/tests/test-1");
    expect(document.body.textContent).not.toContain("Open Test");
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

  it("keeps the Test-owned recording route available for a true Test ID", async () => {
    const fake = fakeService();
    const storage = platformWithStorage();
    await renderJourney("/tests/test-1/record", fake.service, storage.platform);

    expect(document.body.textContent).toContain("Taps and typing appear here.");
    expect(fake.calls).toContain("inspect:test-1");
    expect(storage.values.get("activeRecordingWorkflowId")).toBe("test-1");
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
    expect(document.body.textContent).not.toContain("replay it before saving the Test");
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

    expect(document.body.textContent).toContain("Replay failed.");
    expect(document.body.textContent).toContain("then replay again");
    expect(document.body.textContent).not.toContain("app:id/language");
    expect(document.body.textContent).not.toContain("accessibility geometry");
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
    expect(document.body.textContent).not.toContain("Save Test");
  });

  it("recovers interrupted replay by observing once, then offers an explicit run", async () => {
    const interrupted: ProductRecordingState = {
      ...state("reviewing", ["inspect"]),
      recovery: {
        code: "mutation-outcome-unknown",
        title: "Interrupted replay",
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
    expect(document.body.textContent).not.toContain("Save Test");
    await act(async () => button("Review saved steps").click());
    await settle();
    expect(fake.service.recoverForReview).toHaveBeenCalledWith("recording-1");
    expect(button("Run test").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Save Test");
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

  it("clears a replay recovery warning when canonical inspection has reconciled it", async () => {
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
    expect(document.body.textContent).not.toContain("Checking the last step");
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
    await click(button("Back to Tests"));
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
      throw new Error("Connection interrupted");
    };
    await click(button("Back to Tests"));
    expect(history.location.pathname).toBe("/recordings/workflow-1/review");
    expect(document.body.textContent).toContain("Could not confirm the saved draft");
    expect(fake.calls).not.toContain("approve");
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
    await renderJourney("/recordings/workflow-1", fake.service, storage.platform);

    expect(storage.values.has("activeRecordingWorkflowId")).toBe(false);
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
      "Continue the recording you started before creating another Test",
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
    expect(document.body.textContent).toContain("no visible effect");
    expect(document.body.textContent).not.toMatch(/was not sent/i);
    await tapLiveTarget();
    expect(inputCount).toBe(1);
    expect(document.body.textContent).toContain("Keep it paused to avoid repeating the action.");
    await tapLiveTarget();
    expect(inputCount).toBe(1);
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
