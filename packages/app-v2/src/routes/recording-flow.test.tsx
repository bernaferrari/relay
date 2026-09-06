/** @jsxImportSource react */
import type { AuthoringRecordingEdit } from "@relay/protocol";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RelayV2App } from "../app";
import type {
  ProductRecordingState,
  RecordingProductService,
} from "../data/recording-product-service";
import type { LiveTargetSession } from "../data/live-target-session";
import type { MapProductService } from "../data/map-product-service";
import type { Platform } from "../platform/types";
import type { BrowserSpacesProductService } from "../data/browser-spaces-product-service";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const target = { kind: "device", platform: "android", targetId: "emulator-5554" } as const;
const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
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
        productService={productService}
        mapService={mapService}
        browserSpacesService={browserSpacesService}
      />,
    );
  });
  await settle();
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
    (candidate) => candidate.textContent?.trim() === label,
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
  const canvas = document.querySelector<HTMLCanvasElement>(".relay-capture-live-target");
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

  it("keeps app and device in a compact toolbar instead of a setup form", async () => {
    const fake = fakeService();
    fake.service.connect = async () => ({ status: "target-selection", targets: [] });
    fake.service.presentTargets = async () => [];
    await renderJourney("/tests/new?app=app-1", fake.service, platformWithStorage().platform);

    expect(document.querySelector('[aria-label="App"]')?.textContent).toContain("Grok");
    expect(document.querySelector('[aria-label="Record on"]')).toBeNull();
    expect(document.body.textContent).toContain("Start a browser to record");
    expect(document.body.textContent).toContain("Start a browser");
    expect(document.body.textContent).not.toContain("Open devices");
    expect(document.body.textContent).not.toContain("Manage browser Spaces");
    expect(document.body.textContent).not.toContain("Where this Test belongs");
    expect(document.body.textContent).not.toContain("Stay on this page");
    expect(
      [...document.querySelectorAll("button")].some(
        (item) => item.textContent?.trim() === "Start recording",
      ),
    ).toBe(false);
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

  it("follows the full server-owned progression with one dominant review action", async () => {
    const fake = fakeService();
    const storage = platformWithStorage();
    const { history } = await renderJourney("/tests/new", fake.service, storage.platform);

    await beginRecording();
    expect(history.location.pathname).toBe("/recordings/workflow-1");
    expect(document.body.textContent).toContain("Relay records each supported interaction");
    expect(document.body.textContent).toContain("Pixel 9 Pro");
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
    await click(button("Type"));
    await click(button("Mark screen"));
    const checkpoint = document.querySelector<HTMLInputElement>("#checkpoint-label")!;
    await fill(checkpoint, "Language screen");
    await click(button("Save"));
    await click(button("Stop"));

    expect(history.location.pathname).toBe("/recordings/workflow-1/review");
    expect(document.body.textContent).toContain("2 steps");
    expect(document.body.textContent).toContain("Recorded by Relay");
    expect(document.body.textContent).toContain("replay before saving the Test");
    expect(button("Replay recording").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Save Test");

    await click(button("Replay recording"));
    expect(document.body.textContent).toContain("Ready to save");
    expect(document.body.textContent).toContain("Verified on the selected Device");
    expect(document.body.textContent).not.toContain("A passing replay is required before saving");
    expect(document.body.textContent).not.toContain("Replay recording");
    expect(document.body.textContent).not.toContain("Replay again");
    expect(document.body.textContent).not.toContain("Save draft");
    expect(button("Save Test").disabled).toBe(false);

    await fill(document.querySelector<HTMLInputElement>("#review-test-name")!, "Language tour");
    expect(document.body.textContent).toContain("Name updated — recorded steps are unchanged");
    await click(button("Save Test"));
    expect(history.location.pathname).toBe("/tests/test-1");
    expect(document.body.textContent).not.toContain("Open Test");
    expect(storage.values.has("activeRecordingWorkflowId")).toBe(false);
    expect(fake.calls).toEqual(
      expect.arrayContaining([
        "begin:Untitled recording:app-1:emulator-5554",
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
    await click(button("Type"));
    expect(inputStarted).toBe(true);

    await act(async () => {
      button("Stop").click();
    });
    await settle();
    expect(fake.calls).not.toContain("stop");
    expect(document.body.textContent).toContain("Finishing interaction…");
    expect(history.location.pathname).toBe("/recordings/workflow-1");

    releaseInput();
    await settle();
    await settle();
    expect(history.location.pathname).toBe("/recordings/workflow-1/review");
    expect(document.body.textContent).toContain("2 steps");
    expect(fake.calls.indexOf("input:key")).toBeLessThan(fake.calls.indexOf("stop"));
  });

  it("renames a recorded action through the canonical edit transition", async () => {
    const fake = fakeService(state("reviewing", ["inspect", "edit", "replay"]));
    await renderJourney(
      "/recordings/workflow-1/review",
      fake.service,
      platformWithStorage().platform,
    );

    await click(button("Edit"));
    const instruction = document.querySelector<HTMLInputElement>("#review-action-intent");
    if (!instruction) throw new Error("Action instruction editor was not rendered");
    await fill(instruction, "Open language settings");
    await click(button("Save instruction"));

    expect(fake.calls).toContain("edit:rename");
    expect(document.body.textContent).toContain("A passing replay is required before saving");
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

    await click(button("Edit"));
    expect(document.querySelector("#review-replacement-label")).toBeNull();
    await click(button("Change target"));
    for (
      let attempt = 0;
      attempt < 12 && !document.body.textContent?.includes("Preferred language");
      attempt += 1
    ) {
      await settle();
    }
    await click(button("Preferred language"));
    expect(document.body.textContent).toContain("Matched the visible name");
    await click(button("Try target"));
    expect(document.body.textContent).toContain("Relay would tap Preferred language");
    await click(button("Keep target"));

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
    await click(button("Edit"));
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
    await click(button("Edit"));
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

    await click(button("Edit"));
    await click(button("Find cleanup"));
    expect(document.body.textContent).toContain("review-only suggestions");
    expect(document.body.textContent).toContain("never apply these automatically");
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

  it("uses the route parameter to adopt a recording after refresh", async () => {
    const fake = fakeService();
    const storage = platformWithStorage();
    await renderJourney("/recordings/workflow-1", fake.service, storage.platform);

    expect(document.body.textContent).toContain("Relay records each supported interaction");
    expect(fake.calls).toContain("inspect:workflow-1");
    expect(storage.values.get("activeRecordingWorkflowId")).toBe("workflow-1");
  });

  it("keeps the Test-owned recording route available for a true Test ID", async () => {
    const fake = fakeService();
    const storage = platformWithStorage();
    await renderJourney("/tests/test-1/record", fake.service, storage.platform);

    expect(document.body.textContent).toContain("Relay records each supported interaction");
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

    expect(document.body.textContent).toContain("5 steps");
    expect(document.body.textContent).toContain("Tap the highlighted control");
    expect(document.body.textContent).toContain("Tap Arabic");
    expect(document.body.textContent).not.toContain("Tap target");
    expect(document.body.textContent).toContain("Marked screen");
    expect(document.body.textContent).toContain("Pause");
    expect(document.body.textContent).toContain("Relay waited before the next step");
    expect(document.body.textContent).toContain("Language settings visible");
    expect(document.body.textContent).toContain("Marked screen · Visual evidence");
    expect(document.body.textContent).toContain("Verified by Relay");
    expect(document.body.textContent).toContain("Ready to save");
    expect(document.body.textContent).toContain("Review the steps, then save the Test");
    expect(document.body.textContent).not.toContain("0 recorded steps");
    expect(document.body.textContent).not.toContain("Recorded pause");
    expect(document.body.textContent).not.toContain("A passing replay is required before saving");
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

    expect(document.body.textContent).toContain("Replay needs attention");
    expect(document.body.textContent).toContain("Check the Device, then replay it again");
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

    expect(document.body.textContent).toContain("Restoring recording");
    expect(document.body.textContent).not.toContain("Continue on the connected target");
    expect(document.body.textContent).not.toContain("Relay records each supported interaction");
    expect(button("Mark screen").disabled).toBe(true);
    expect(button("Stop").disabled).toBe(true);
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

  it("does not expose retained review content or actions during recovery", async () => {
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
    expect(document.body.textContent).not.toContain("2 steps");
    expect(document.body.textContent).not.toContain("Replay recording");
    expect(document.body.textContent).not.toContain("Save Test");
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
});
