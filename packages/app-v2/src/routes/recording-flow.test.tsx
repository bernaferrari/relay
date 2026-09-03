/** @jsxImportSource react */
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RelayV2App } from "../app";
import type {
  ProductRecordingState,
  RecordingProductService,
} from "../data/recording-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const target = { kind: "device", platform: "ios", targetId: "ipad-pro" } as const;
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
                    : ("inferred-unproved" as const),
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
  const service: RecordingProductService = {
    async listApps() {
      calls.push("list-apps");
      return [{ id: "app-1", name: "Grok" }];
    },
    async connect() {
      calls.push("connect");
      return { status: "target-selection", targets: [target], selectedTarget: target };
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
  };
  return { service, calls };
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
) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayV2App platform={platform} history={history} productService={productService} />,
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
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function beginRecording() {
  const name = document.querySelector<HTMLInputElement>("#test-name");
  if (!name) throw new Error("Test name input not found");
  await fill(name, "Change the app language");
  await click(document.querySelector<HTMLInputElement>('input[name="app"]')!);
  await click(document.querySelector<HTMLInputElement>('input[name="target"]')!);
  await click(button("Begin recording"));
}

describe("record, review, replay, and save", () => {
  it("follows the full server-owned progression with one dominant review action", async () => {
    const fake = fakeService();
    const storage = platformWithStorage();
    const { history } = await renderJourney("/tests/new", fake.service, storage.platform);

    await beginRecording();
    expect(history.location.pathname).toBe("/tests/workflow-1/record");
    expect(document.body.textContent).toContain("The capture is live");

    await click(button("Record"));
    await click(button("Checkpoint"));
    const checkpoint = document.querySelector<HTMLInputElement>("#checkpoint-label")!;
    await fill(checkpoint, "Language screen");
    await click(button("Save checkpoint"));
    await click(button("Stop"));

    expect(history.location.pathname).toBe("/recordings/workflow-1/review");
    expect(document.body.textContent).toContain("2 recorded steps");
    expect(document.body.textContent).toContain("Captured by Relay");
    expect(button("Replay recording").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Save Test");

    await click(button("Replay recording"));
    expect(document.body.textContent).toContain("Replay passed");
    expect(document.body.textContent).not.toContain("Replay recording");
    expect(button("Save Test").disabled).toBe(false);

    await click(button("Save Test"));
    expect(document.body.textContent).toContain("Test saved");
    expect(document.body.textContent).toContain("Open Test");
    expect(storage.values.has("activeRecordingWorkflowId")).toBe(false);
    expect(fake.calls).toEqual(
      expect.arrayContaining([
        "begin:Change the app language:app-1:ipad-pro",
        "record",
        "checkpoint:Language screen",
        "stop",
        "replay",
        "approve",
      ]),
    );
  });

  it("uses the route parameter to adopt a recording after refresh", async () => {
    const fake = fakeService();
    const storage = platformWithStorage();
    await renderJourney("/tests/workflow-1/record", fake.service, storage.platform);

    expect(document.body.textContent).toContain("The capture is live");
    expect(fake.calls).toContain("inspect:workflow-1");
    expect(storage.values.get("activeRecordingWorkflowId")).toBe("workflow-1");
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
    expect(document.body.textContent).not.toContain("Begin recording");

    await click(button("Resume"));
    expect(history.location.pathname).toBe("/tests/workflow-1/record");
  });
});
