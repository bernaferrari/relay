import { expect, test, vi } from "vitest";
import { render } from "solid-js/web";
import type { AppMapScenarioTest } from "@relay/protocol";

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

function pointer(type: string, x: number, y: number) {
  const event = new PointerEvent(type, { bubbles: true, button: 0 });
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
    pointerId: { value: 7 },
  });
  return event;
}

test("Test device preview sends exactly one tap through the canonical interaction boundary", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const interactStep = vi.fn(async () => true);
  serverMock.current = {
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
    interactStep,
  };

  const dispose = render(() => <AppMapTestDeviceEvidence test={scenario} />, root);
  const surface = root.querySelector<HTMLElement>(
    "[data-testid='test-device-interaction-surface']",
  )!;
  surface.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 180, height: 400, right: 180, bottom: 400 }) as DOMRect;
  surface.dispatchEvent(pointer("pointerdown", 45, 300));
  surface.dispatchEvent(pointer("pointerup", 45, 300));
  await Promise.resolve();

  expect(interactStep).toHaveBeenCalledTimes(1);
  expect(interactStep).toHaveBeenCalledWith({ kind: "point", x: 90, y: 600 }, "test preview tap");

  dispose();
  document.body.replaceChildren();
});
