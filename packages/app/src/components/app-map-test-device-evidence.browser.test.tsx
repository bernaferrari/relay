import { expect, test, vi } from "vitest";
import { render } from "solid-js/web";
import type { AppMapScenarioTest, TargetSupervisorHealth } from "@relay/protocol";

const serverMock = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("../context/server", () => ({ useServer: () => serverMock.current }));

import { AppMapTestDeviceEvidence } from "./app-map-test-device-evidence";

const scenario: AppMapScenarioTest = {
  id: "settings",
  organizationId: "org",
  projectId: "project",
  appMapId: "map",
  kind: "scenario",
  name: "Settings",
  intentSchemaVersion: 1,
  steps: [],
  createdAt: 1,
  updatedAt: 1,
};

const pixelOnlyHealth = {
  schemaVersion: 1,
  target: { id: "phone-1", kind: "android" },
  observedAt: 1,
  epochs: { target: 1, semanticSession: 1 },
  pixels: { state: "ready" },
  semantics: { state: "unavailable" },
  input: { state: "ready" },
  control: { state: "owned" },
  overall: "pixel-only",
  context: {},
  counters: {
    pixelCaptures: 1,
    semanticTraversals: 0,
    semanticTimeouts: 0,
    semanticWedges: 0,
    uncertainMutations: 0,
    reconciliations: 0,
    recoveryAttempts: 0,
    recoveryFailures: 0,
  },
  latency: {
    pixels: { count: 1 },
    semantics: { count: 0 },
    recovery: { count: 0 },
  },
  readiness: {
    previewPixels: {
      mode: "pixels",
      state: "proven",
      freshness: "current",
      proof: { at: 1 },
    },
    semanticControl: {
      mode: "accessibility",
      state: "unavailable",
      freshness: "unproven",
    },
    evidenceCapture: {
      mode: "evidence",
      state: "proven",
      freshness: "current",
      proof: { at: 1 },
    },
  },
  events: [],
} satisfies TargetSupervisorHealth;

function pointer(type: string, x: number, y: number) {
  const event = new PointerEvent(type, { bubbles: true, button: 0 });
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
    pointerId: { value: 7 },
  });
  return event;
}

function testServer(inputState: "ready" | "uncertain" = "ready") {
  const interactStep = vi.fn(async () => true);
  const recoverSelectedTarget = vi.fn(async () => true);
  const takeControlOfSelectedDevice = vi.fn(async () => true);
  const retryConnection = vi.fn(async () => undefined);
  return {
    interactStep,
    recoverSelectedTarget,
    takeControlOfSelectedDevice,
    retryConnection,
    server: {
      devices: () => [
        {
          serial: "phone-1",
          name: "Phone",
          platform: "android",
          connectionState: "connected",
          booted: true,
        },
      ],
      selectedDevice: () => "phone-1",
      targetHealth: () => ({ ...pixelOnlyHealth, input: { state: inputState } }),
      refreshTargetHealth: async () => undefined,
      selectedLeaseId: () => "lease-1",
      controlIssue: () => null,
      health: () => "online",
      liveFrame: () => ({
        id: "frame-1",
        serial: "phone-1",
        base64: "pixels",
        mime: "image/png",
        caption: "live",
        capturedAt: 1,
        bytes: 6,
        width: 360,
        height: 800,
      }),
      snapshot: () => ({
        serial: "phone-1",
        capturedAt: 1,
        nodes: [],
        interactive: [],
        bounds: { width: 360, height: 800 },
      }),
      liveCaptureIssue: () => null,
      appleDeviceSetup: () => null,
      jobs: () => [],
      persistedRuns: () => [],
      pollLiveFrame: async () => undefined,
      pollLiveSnapshot: async () => undefined,
      loadRunDetail: async () => undefined,
      frameUrlForPersisted: () => "",
      recoverSelectedTarget,
      takeControlOfSelectedDevice,
      retryConnection,
      interactStep,
    },
  };
}

test("Test device preview sends exactly one tap through the canonical interaction boundary", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const fixture = testServer();
  serverMock.current = fixture.server;

  const dispose = render(() => <AppMapTestDeviceEvidence test={scenario} />, root);
  const surface = root.querySelector<HTMLElement>(
    "[data-testid='test-device-interaction-surface']",
  )!;
  surface.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 180, height: 400, right: 180, bottom: 400 }) as DOMRect;
  surface.dispatchEvent(pointer("pointerdown", 45, 300));
  surface.dispatchEvent(pointer("pointerup", 45, 300));
  await Promise.resolve();

  expect(fixture.interactStep).toHaveBeenCalledTimes(1);
  expect(fixture.interactStep).toHaveBeenCalledWith(
    { kind: "point", x: 90, y: 600 },
    "test preview tap",
  );
  expect(root.querySelector("[data-target-health-plane='overall']")?.textContent).toContain(
    "OverallPixels only",
  );
  expect(root.querySelector("[data-target-health-plane='pixels']")?.textContent).toContain(
    "PixelsLive",
  );

  dispose();
  document.body.replaceChildren();
});

test("uncertain supervisor input remains visible and cannot send another tap", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const fixture = testServer("uncertain");
  serverMock.current = fixture.server;

  const dispose = render(() => <AppMapTestDeviceEvidence test={scenario} />, root);
  const surface = root.querySelector<HTMLElement>(
    "[data-testid='test-device-interaction-surface']",
  )!;
  surface.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await Promise.resolve();

  expect(fixture.interactStep).not.toHaveBeenCalled();
  expect(root.querySelector("[data-target-health-plane='input']")?.textContent).toContain(
    "InputNeeds review",
  );
  expect(root.textContent).toContain("Review the last device action before sending another one.");
  const reconnect = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Try again",
  );
  expect(reconnect).toBeTruthy();
  reconnect!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fixture.recoverSelectedTarget).toHaveBeenCalledWith("observe");

  dispose();
  document.body.replaceChildren();
});

test("a Test with no selected device offers the recovery action where the blocker appears", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const fixture = testServer();
  serverMock.current = {
    ...fixture.server,
    devices: () => [],
    selectedDevice: () => "",
    liveFrame: () => null,
    snapshot: () => null,
  };
  const onChooseTarget = vi.fn();

  const dispose = render(
    () => <AppMapTestDeviceEvidence test={scenario} onChooseTarget={onChooseTarget} />,
    root,
  );
  expect(root.textContent).toContain(
    "Select a target to see its latest directly observed pixels here.",
  );
  const choose = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Choose device",
  );
  expect(choose).toBeTruthy();
  choose!.click();
  expect(onChooseTarget).toHaveBeenCalledTimes(1);

  dispose();
  document.body.replaceChildren();
});
