/** @jsxImportSource react */
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayV2App } from "../app";
import type { AgentDebugProductService } from "../data/agent-debug-product-service";
import type { DeviceProductService, ProductDevice } from "../data/device-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { RunProductService } from "../data/run-product-service";
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
    path?: string;
    devices?: readonly ProductDevice[];
    agentDebugService?: AgentDebugProductService;
    runService?: RunProductService;
  } = {},
) {
  const history = createMemoryHistory({ initialEntries: [options.path ?? "/debug"] });
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
        runService={options.runService}
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
  const trigger = document.getElementById("agent-debug-target");
  if (!(trigger instanceof HTMLButtonElement)) throw new Error("Target select not found");
  await act(async () => {
    trigger.click();
  });
  await settle();
  const option = document.querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`);
  if (!option) throw new Error(`Target option ${value} not found`);
  await act(async () => option.click());
  await settle();
}

async function clickStart() {
  const button = [...document.querySelectorAll("button")].find((candidate) => {
    const label = candidate.textContent?.trim();
    return label === "Start investigation" || label === "Start new experiment";
  });
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
  it("keeps the start page focused on the investigation outcome", async () => {
    await render();

    expect(document.body.textContent).toContain(
      "Name the problem, pick a device, and start capturing.",
    );
    expect(document.body.textContent).not.toContain(
      "Relay keeps the Session, target owner, evidence, and human review boundary visible",
    );
    expect(document.body.textContent).not.toContain(
      "Starting opens a server-owned recording Session on the selected target",
    );
  });

  it("offers only runnable targets and keeps the target label free of raw serials", async () => {
    await render({
      devices: [
        productDevice("ready", "Ready Pixel", true, "android"),
        productDevice("offline", "Offline iPad", false, "ios"),
      ],
    });

    const trigger = document.getElementById("agent-debug-target");
    if (!(trigger instanceof HTMLButtonElement)) throw new Error("Target select not found");
    await act(async () => trigger.click());
    await settle();

    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map((option) => option.textContent?.trim())).toEqual(["Ready Pixel · android"]);
    expect(document.body.textContent).not.toContain("serial-ready");
  });

  it("explains how to recover when no runnable target is available", async () => {
    await render({ devices: [productDevice("offline", "Offline iPad", false, "ios")] });

    expect(document.body.textContent).toContain("No devices connected");
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

  it("prefills and submits a ready target from contextual Investigate", async () => {
    const debugBug = vi.fn(async () => startOutcome());
    await render({
      path: "/debug?target=serial-ready",
      agentDebugService: debugService(debugBug),
      devices: [productDevice("ready", "Ready Pixel", true, "android")],
    });

    const target = document.getElementById("agent-debug-target");
    expect(target?.textContent).toContain("Ready Pixel · android");
    await fillTitle("  Investigate checkout  ");
    await clickStart();

    expect(debugBug).toHaveBeenCalledWith({
      kind: "debug-bug",
      action: "start",
      title: "Investigate checkout",
      targetId: "serial-ready",
      confirmControl: true,
    });
  });

  it("does not submit an unavailable contextual target until a ready target is chosen", async () => {
    const debugBug = vi.fn(async () => startOutcome());
    await render({
      path: "/debug?target=serial-offline",
      agentDebugService: debugService(debugBug),
      devices: [
        productDevice("ready", "Ready Pixel", true, "android"),
        productDevice("offline", "Offline iPad", false, "ios"),
      ],
    });

    await fillTitle("Investigate checkout");
    const start = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "Start investigation",
    );
    expect(start).toBeInstanceOf(HTMLButtonElement);
    expect((start as HTMLButtonElement).disabled).toBe(true);
    await clickStart();
    expect(debugBug).not.toHaveBeenCalled();

    await selectTarget("serial-ready");
    expect((start as HTMLButtonElement).disabled).toBe(false);
    await clickStart();
    expect(debugBug).toHaveBeenCalledWith(expect.objectContaining({ targetId: "serial-ready" }));
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

  it("loads contextual Report details from a canonical runId without serializing evidence", async () => {
    const debugBug = vi.fn(async () => startOutcome());
    const getReport = vi.fn(async () => ({
      runId: "run-failed",
      title: "Checkout validation",
      outcome: "product-failure" as const,
      targetName: "Ready Pixel",
      cause: "Button was not reachable",
      timeline: [
        {
          id: "step-1",
          index: 0,
          title: "Press checkout",
          state: "failed" as const,
          evidenceCount: 1,
          expected: "Checkout opens",
          observed: "Button stayed disabled",
        },
      ],
      evidence: [
        {
          id: "visual",
          label: "Visual",
          count: 1,
          detail: "Screenshot",
          summary: "",
          inspectable: true,
          items: [],
        },
      ],
    }));
    const history = await render({
      path: "/debug?runId=run-failed",
      runService: { getReport } as unknown as RunProductService,
      agentDebugService: debugService(debugBug),
    });

    expect(getReport).toHaveBeenCalledWith("run-failed");
    expect(document.body.textContent).toContain("Button stayed disabled");
    expect(document.body.textContent).toContain("1 item");
    expect(document.body.textContent).toContain("Investigating Checkout validation");
    expect(document.getElementById("agent-debug-title")).toBeNull();
    expect(document.body.textContent).not.toContain("serial-");
    expect(debugBug).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Investigate Checkout validation",
        targetId: "serial-ready",
        debugOrigin: {
          schemaVersion: 1,
          source: { runId: "run-failed", attempt: 1, stepId: "step-1" },
          evidenceRefs: [],
          configRefs: ["reproduction:original"],
        },
      }),
    );
    expect(history.location.pathname).toBe("/debug");
  });

  it("binds a pre-step failure to the source Run without guessing a same-name device", async () => {
    const debugBug = vi.fn(async () => startOutcome());
    const getReport = vi.fn(async () => ({
      runId: "run-pre-step",
      title: "Checkout validation",
      outcome: "harness-failure" as const,
      targetName: "Ready Pixel",
      cause: "Authentication fixture unavailable",
      timeline: [],
      evidence: [],
      executionContext: { targetProfileId: "serial-ready", buildId: "build-92" },
    }));
    await render({
      path: "/debug?runId=run-pre-step",
      runService: { getReport } as unknown as RunProductService,
      agentDebugService: debugService(debugBug),
      devices: [
        productDevice("ready", "Ready Pixel", true, "android"),
        productDevice("lab", "Ready Pixel", true, "android"),
      ],
    });

    expect(document.body.textContent).toContain("Before step 1");
    expect(document.body.textContent).toContain("Build build-92");
    expect(document.body.textContent).toContain("Ready to review");
    expect(debugBug).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "serial-ready",
        debugOrigin: expect.objectContaining({
          source: { runId: "run-pre-step", attempt: 1, stepId: "before-first-step" },
        }),
      }),
    );
  });

  it("keeps start and retry visible when a bound investigation fails to start", async () => {
    const debugBug = vi.fn(async () => {
      throw new Error("Target is owned by another actor.");
    });
    const getReport = vi.fn(async () => ({
      runId: "run-failed",
      title: "Checkout validation",
      outcome: "product-failure" as const,
      targetName: "Ready Pixel",
      cause: "Button was not reachable",
      timeline: [
        {
          id: "step-1",
          index: 0,
          title: "Press checkout",
          state: "failed" as const,
          evidenceCount: 1,
          expected: "Checkout opens",
          observed: "Button stayed disabled",
        },
      ],
      evidence: [],
    }));
    await render({
      path: "/debug?runId=run-failed",
      runService: { getReport } as unknown as RunProductService,
      agentDebugService: debugService(debugBug),
    });

    expect(document.body.textContent).toContain("Target is owned by another actor.");
    expect(document.body.textContent).toMatch(/Start investigation|Start new experiment/);
    expect(document.body.textContent).toContain("Open result");
    await clickStart();
    expect(debugBug).toHaveBeenCalledTimes(2);
  });

  it("opens the live Session after a successful start", async () => {
    const history = await render({
      agentDebugService: debugService(vi.fn(async () => startOutcome("session-durable"))),
      devices: [productDevice("ready", "Ready Pixel", true, "android")],
    });

    await fillTitle("Checkout bug");
    await selectTarget("serial-ready");
    await clickStart();

    expect(history.location.pathname).toBe("/sessions/session-durable");
  });

  it("does not auto-start a substitute and labels it as a new experiment", async () => {
    const debugBug = vi.fn(async () => startOutcome());
    await render({
      path: "/debug?runId=run-failed",
      runService: {
        getReport: async () => ({
          runId: "run-failed",
          title: "Checkout validation",
          outcome: "product-failure" as const,
          targetName: "Ready Pixel",
          cause: "Button was not reachable",
          timeline: [],
          evidence: [],
          executionContext: { targetProfileId: "serial-offline", buildId: "build-92" },
        }),
      } as unknown as RunProductService,
      agentDebugService: debugService(debugBug),
      devices: [
        productDevice("ready", "Ready Pixel", true, "android"),
        productDevice("offline", "Offline iPad", false, "ios"),
      ],
    });

    expect(debugBug).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Original result");
    expect(document.body.textContent).toContain("Build build-92");
    expect(document.body.textContent).toContain("Original device unavailable");
    expect(document.body.textContent).toContain("new experiment");
    const start = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "Start new experiment",
    );
    expect((start as HTMLButtonElement | undefined)?.disabled).toBe(true);

    await selectTarget("serial-ready");
    expect(document.body.textContent).toContain("Investigating on Ready Pixel instead");
    expect((start as HTMLButtonElement).disabled).toBe(false);
    await clickStart();
    expect(debugBug).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "serial-ready",
        debugOrigin: expect.objectContaining({
          source: { runId: "run-failed", attempt: 1, stepId: "before-first-step" },
          configRefs: expect.arrayContaining([
            "targetProfileId:serial-offline",
            "buildId:build-92",
            "reproduction:substituted",
          ]),
        }),
      }),
    );
  });
});
