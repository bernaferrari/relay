/** @jsxImportSource react */
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayV2App } from "../app";
import type { AgentDebugProductService } from "../data/agent-debug-product-service";
import type { DeviceProductService, ProductDevice } from "../data/device-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
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
  storage: { get: () => null, set: () => undefined, remove: () => undefined },
};

function productDevice(
  id: string,
  name: string,
  runnable: boolean,
  platformName: ProductDevice["platform"],
): ProductDevice {
  return {
    id,
    name,
    serial: `serial-${id}`,
    platform: platformName,
    kind: platformName === "browser" ? "Managed browser" : "Physical device",
    status: runnable ? "ready" : "needs-attention",
    runnable,
    device: {
      id,
      name,
      serial: `serial-${id}`,
      platform: platformName,
      kind: platformName === "browser" ? "Managed browser" : "Physical device",
      booted: true,
    },
  };
}

function deviceService(devices: readonly ProductDevice[]): DeviceProductService {
  return {
    list: vi.fn(async () => devices),
    get: vi.fn(async (deviceId) => devices.find((device) => device.id === deviceId)),
    actions: vi.fn(async () => []),
    recover: vi.fn(async (serial) => ({
      serial,
      recovered: true,
      ready: true,
      summary: "Recovered",
      actions: [],
      session: { status: "ready", detail: "Ready" },
    })),
  };
}

function startOutcome(
  sessionId = "session-debug",
): Awaited<ReturnType<AgentDebugProductService["debugBug"]>> {
  return {
    schemaVersion: 1,
    kind: "debug-bug",
    action: "start",
    actorId: "human:test",
    nextAction: "review-recording",
    recording: {
      authoring: { sessionId },
    } as never,
  };
}

function debugService(
  debugBug: AgentDebugProductService["debugBug"] = vi.fn(async () => startOutcome()),
): AgentDebugProductService {
  return { debugBug };
}

async function render(
  options: {
    devices?: readonly ProductDevice[];
    agentDebugService?: AgentDebugProductService;
  } = {},
) {
  const history = createMemoryHistory({ initialEntries: ["/debug"] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayV2App
        platform={platform}
        history={history}
        productService={{ listApps: async () => [] } as unknown as RecordingProductService}
        deviceService={deviceService(
          options.devices ?? [productDevice("ready", "Ready Pixel", true, "android")],
        )}
        agentDebugService={options.agentDebugService ?? debugService()}
      />,
    );
  });
  await settle();
  return history;
}

async function settle() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

async function fillTitle(value: string) {
  const input = document.getElementById("agent-debug-title");
  if (!(input instanceof HTMLInputElement)) throw new Error("Investigation title input not found");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

async function selectTarget(value: string) {
  const select = document.getElementById("agent-debug-target");
  if (!(select instanceof HTMLSelectElement)) throw new Error("Target select not found");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

async function clickStart() {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === "Start investigation",
  );
  if (!(button instanceof HTMLButtonElement))
    throw new Error("Start investigation button not found");
  await act(async () => button.click());
  await settle();
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

describe("Agent Debug route", () => {
  it("offers only runnable targets and keeps the target label free of raw serials", async () => {
    await render({
      devices: [
        productDevice("ready", "Ready Pixel", true, "android"),
        productDevice("offline", "Offline iPad", false, "ios"),
      ],
    });

    const select = document.getElementById("agent-debug-target");
    if (!(select instanceof HTMLSelectElement)) throw new Error("Target select not found");
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Choose a ready target",
      "Ready Pixel · android",
    ]);
    expect(select.textContent).not.toContain("serial-ready");
  });

  it("explains how to recover when no runnable target is available", async () => {
    await render({ devices: [productDevice("offline", "Offline iPad", false, "ios")] });

    expect(document.body.textContent).toContain("No runnable targets are available.");
    expect(document.querySelector<HTMLAnchorElement>('a[href="/devices"]')).not.toBeNull();
  });

  it("submits the exact selected target and trimmed title with control confirmation", async () => {
    const debugBug = vi.fn(async () => startOutcome());
    await render({
      agentDebugService: debugService(debugBug),
      devices: [productDevice("ready", "Ready Pixel", true, "android")],
    });

    await fillTitle("  Checkout button is unreachable  ");
    await selectTarget("serial-ready");
    await clickStart();

    expect(debugBug).toHaveBeenCalledWith({
      kind: "debug-bug",
      action: "start",
      title: "Checkout button is unreachable",
      targetId: "serial-ready",
      confirmControl: true,
    });
  });

  it("keeps a failed start error visible", async () => {
    const debugBug = vi.fn(async () => {
      throw new Error("Target is owned by another actor.");
    });
    await render({
      agentDebugService: debugService(debugBug),
      devices: [productDevice("ready", "Ready Pixel", true, "android")],
    });

    await fillTitle("Checkout bug");
    await selectTarget("serial-ready");
    await clickStart();

    expect(document.body.textContent).toContain("Target is owned by another actor.");
  });

  it("links a successful start to its durable Session", async () => {
    await render({
      agentDebugService: debugService(vi.fn(async () => startOutcome("session-durable"))),
      devices: [productDevice("ready", "Ready Pixel", true, "android")],
    });

    await fillTitle("Checkout bug");
    await selectTarget("serial-ready");
    await clickStart();

    expect(document.body.textContent).toContain("Session ready for human review");
    expect(
      document.querySelector<HTMLAnchorElement>('a[href="/sessions/session-durable"]'),
    ).not.toBeNull();
  });
});
