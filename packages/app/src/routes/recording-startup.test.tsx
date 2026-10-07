/** @jsxImportSource react */
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelayApp } from "../app";
import type { DeviceProductService } from "../data/device-product-service";
import type { LiveTargetSession } from "../data/live-target-session";
import { rememberNativeAppLaunch } from "../data/native-app-launch-context";
import type {
  ProductRecordingState,
  RecordingProductService,
} from "../data/recording-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline fixture")));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
async function settle() {
  for (let index = 0; index < 5; index++)
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
}
function button(label: string) {
  const found = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
const target = { kind: "device", platform: "ios", targetId: "ipad" } as const;
const recording: ProductRecordingState = {
  status: "recording",
  targets: [target],
  selectedTarget: target,
  snapshot: {
    schemaVersion: 1,
    kind: "author-test",
    title: "Grok iOS recording",
    phase: "running",
    stage: "recording",
    version: "state-1",
    workflow: { workflowId: "original-workflow", expectedVersion: 1 },
    frozen: {
      title: "Grok iOS recording",
      actorId: "human:test",
      appMapId: "grok-ios",
      appMapRevision: 1,
      target,
    },
    authoring: { sessionId: "original-session" },
    progress: { label: "Recording" },
    allowedNextActions: ["inspect", "record", "checkpoint", "stop"],
    problems: [],
    evidenceRefs: [],
  },
};
async function setup() {
  let resolve!: (state: ProductRecordingState) => void;
  let reject!: (error: Error) => void;
  const begin = vi.fn(
    () =>
      new Promise<ProductRecordingState>((yes, no) => {
        resolve = yes;
        reject = no;
      }),
  );
  const previewInput = vi.fn(async () => undefined);
  function session(): LiveTargetSession {
    const snapshot = { target, status: "streaming", frameSequence: 1 } as const;
    return {
      snapshot: () => snapshot,
      subscribe: (listener) => {
        listener(snapshot);
        return () => undefined;
      },
      mount: () => () => undefined,
      input: previewInput,
      close: () => undefined,
    };
  }
  const product = {
    listApps: async () => [
      { id: "grok-ios", name: "Grok iOS", platform: "ios" },
      { id: "other", name: "Other iOS", platform: "ios" },
    ],
    connect: async () => ({
      status: "target-selection",
      targets: [target],
      selectedTarget: target,
    }),
    presentTargets: async () => [{ ...target, name: "Design iPad", detail: "Ready" }],
    previewTarget: async () => session(),
    liveTarget: async () => session(),
    begin,
    inspect: async () => recording,
    getOptimization: async () => ({ proposal: null }),
  } as unknown as RecordingProductService;
  const launchApp = vi.fn();
  const recover = vi.fn();
  const devices = {
    listEmulators: async () => ({ avds: [] }),
    launchApp,
    recover,
  } as unknown as DeviceProductService;
  rememberNativeAppLaunch(devices, {
    serial: "ipad",
    platform: "ios",
    app: "Grok",
    launchedAt: Date.now(),
    observed: { app: "Grok", matched: true },
  });
  const values = new Map<string, string>();
  const platform: Platform = {
    platform: "web",
    getServerUrl: () => "http://127.0.0.1:8787",
    getServerConnection: () => ({
      url: "http://127.0.0.1:8787",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
    }),
    setServerUrl: () => undefined,
    storage: {
      get: (key) => values.get(key) ?? null,
      set: (key, value) => void values.set(key, value),
      remove: (key) => void values.delete(key),
    },
  };
  const history = createMemoryHistory({
    initialEntries: [
      "/tests/new?app=grok-ios&target=ipad&targetKind=device&originApplication=Grok",
    ],
  });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <RelayApp
        platform={platform}
        history={history}
        productService={product}
        deviceService={devices}
      />,
    ),
  );
  await settle();
  expect(button("Start recording").disabled).toBe(false);
  return {
    begin,
    resolve: (state: ProductRecordingState) => resolve(state),
    reject: (error: Error) => reject(error),
    launchApp,
    recover,
    previewInput,
    values,
    history,
  };
}

describe("recording startup setup ownership", () => {
  it("blocks setup and delayed preview input through Begin, then preserves the original workflow receipt", async () => {
    const view = await setup();
    const canvas = document.querySelector("canvas")!;
    // Queue a wheel gesture before startup; its callback must consult current admission.
    await act(async () =>
      canvas.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: 20, clientX: 20, clientY: 20 }),
      ),
    );
    await act(async () => button("Start recording").click());
    await settle();
    expect(button("Starting…").disabled).toBe(true);
    for (const label of ["App", "Record on"])
      expect(document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.disabled).toBe(
        true,
      );
    const identifier = document.querySelector<HTMLInputElement>("#device-app-identifier")!;
    expect(identifier.disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
    expect(button("Launch app").disabled).toBe(true);
    expect(button("Use current screen").disabled).toBe(true);
    await act(async () => {
      identifier.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }),
      );
      button("Use current screen").click();
      document
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((done) => setTimeout(done, 170));
    });
    expect(view.begin).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        appMapId: "grok-ios",
        targetId: "ipad",
        targetKind: "device",
        originApplication: "Grok",
      }),
    );
    expect(identifier.value).toBe("Grok");
    expect(view.launchApp).not.toHaveBeenCalled();
    expect(view.recover).not.toHaveBeenCalled();
    expect(view.previewInput).not.toHaveBeenCalled();
    await act(async () => view.resolve(recording));
    await settle();
    expect(view.values.get("activeRecordingWorkflowId")).toBe("original-workflow");
    expect(view.history.location.pathname).toBe("/recordings/original-workflow");
  });

  it("unlocks unchanged native setup after a known rejected Begin without resending", async () => {
    const view = await setup();
    await act(async () => button("Start recording").click());
    await settle();
    await act(async () => view.reject(new Error("Begin rejected before dispatch")));
    await settle();
    const identifier = document.querySelector<HTMLInputElement>("#device-app-identifier")!;
    expect(identifier.disabled).toBe(false);
    expect(identifier.value).toBe("Grok");
    expect(button("Start recording").disabled).toBe(false);
    expect(button("Launch app").disabled).toBe(false);
    expect(button("Use current screen").disabled).toBe(false);
    expect(view.begin).toHaveBeenCalledOnce();
    expect(view.values.has("activeRecordingWorkflowId")).toBe(false);
    expect(view.launchApp).not.toHaveBeenCalled();
  });
});
