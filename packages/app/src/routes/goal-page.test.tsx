/** @jsxImportSource react */
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoalSessionResult } from "@relay/protocol";
import { RelayApp } from "../app";
import type { GoalProductService } from "../data/goal-product-service";
import type { DeviceProductService } from "../data/device-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { Platform } from "../platform/types";
import type { AppResourcesProductService } from "../data/app-resources-product-service";
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
    actorId: "human:goal-test",
    actorKind: "human",
  }),
  storage: { get: () => null, set: () => undefined, remove: () => undefined },
};

const deviceService: DeviceProductService = {
  list: vi.fn(async () => []),
  get: vi.fn(async () => undefined),
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

function sessionResult(reproduced = false): GoalSessionResult {
  return {
    schemaVersion: 1,
    sessionId: "goal-1",
    goal: "Find checkout",
    target: { targetId: "target-1", platform: "browser", startUrl: "https://example.test" },
    status: "completed",
    step: 1,
    budget: { maxSteps: 4, maxDurationMs: 60_000 },
    actions: [],
    observations: [],
    findings: [
      {
        schemaVersion: 1,
        id: "finding-1",
        sessionId: "goal-1",
        kind: "possible-issue",
        status: reproduced ? "reproduced" : "open",
        title: "Possible issue needs fresh-target review",
        summary: "The checkout result needs a fresh reproduction.",
        evidenceRefs: ["goal:goal-1:evidence"],
        source: reproduced ? "fresh-reproduction" : "goal-runner",
        createdAt: 1,
        updatedAt: 1,
        requiresReview: true,
      },
    ],
    ...(reproduced
      ? {
          reproduction: {
            id: "repro-1",
            sourceSessionId: "goal-1",
            target: {
              targetId: "goal-repro-goal-1",
              platform: "browser",
              startUrl: "https://example.test",
            },
            status: "reproduced",
            startedAt: 1,
            updatedAt: 1,
            actions: [],
            observations: [],
            findings: [],
          },
        }
      : {}),
  } as GoalSessionResult;
}

function uncertainSessionResult(): GoalSessionResult {
  const base = sessionResult() as unknown as Record<string, unknown>;
  return {
    ...base,
    status: "uncertain",
    stopReason: {
      code: "action-uncertain",
      message: "Review the target before resuming.",
      at: 2,
    },
    resumeRequiresReview: true,
  } as GoalSessionResult;
}

function goalService(startResult = sessionResult()): GoalProductService {
  return {
    start: vi.fn(async () => startResult),
    inspectSession: vi.fn(async () => startResult as never),
    inspectExploration: vi.fn(async () => ({}) as never),
    resumeSession: vi.fn(async () => sessionResult()),
    resumeExploration: vi.fn(async () => ({}) as never),
    cancelSession: vi.fn(async () => sessionResult()),
    reproduceSession: vi.fn(async () => sessionResult(true)),
    promoteSession: vi.fn(async () => ({ title: "Checkout", stage: "reviewing" }) as never),
  };
}

function laneService(
  lanes: ReadonlyArray<{ id: string; kind: "fixture" | "signed-out" }>,
): AppResourcesProductService {
  return { listAccountLanes: vi.fn(async () => lanes) } as unknown as AppResourcesProductService;
}

async function render(
  service = goalService(),
  initialEntry = "/goals",
  appResources: AppResourcesProductService = laneService([]),
) {
  const history = createMemoryHistory({ initialEntries: [initialEntry] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayApp
        platform={platform}
        history={history}
        productService={{ listApps: async () => [] } as unknown as RecordingProductService}
        deviceService={deviceService}
        goalService={service}
        appResourcesService={appResources}
      />,
    );
  });
  await settle();
  return { host, service };
}

async function settle() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

async function setValue(id: string, value: string) {
  const input = document.getElementById(id);
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
    throw new Error(`Input ${id} not found`);
  }
  await act(async () => {
    const prototype =
      input instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Button ${label} not found`);
  return found;
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

describe("Goal page", () => {
  it("carries a retained finding through fresh replay and explicit Test promotion", async () => {
    const { host, service } = await render();

    expect(host.textContent).toContain("Start from a goal");
    expect(button("Explore goal").disabled).toBe(true);

    await setValue("goal-description", "Find checkout");
    await setValue("goal-start-url", "https://example.test");
    await act(async () => {
      const control = document.querySelector<HTMLButtonElement>(
        '[aria-label="Confirm target control"]',
      );
      control?.closest("label")?.click();
    });
    await settle();
    expect(button("Explore goal").disabled).toBe(false);
    await act(async () => button("Explore goal").click());
    await settle();

    expect(service.start).toHaveBeenCalled();
    expect(vi.mocked(service.start).mock.calls[0]?.[0]).toEqual({
      goal: "Find checkout",
      startUrl: "https://example.test",
      agents: 1,
      maxSteps: 12,
      maxDurationMs: 300_000,
      confirmControl: true,
    });
    expect(host.textContent).toContain("Review findings");
    expect(host.textContent).toContain("Replay on a fresh target");

    await act(async () => button("Replay on a fresh target").click());
    await settle();
    expect(service.reproduceSession).toHaveBeenCalled();
    expect(vi.mocked(service.reproduceSession).mock.calls[0]?.[0]).toBe("goal-1");
    expect(host.textContent).toContain("Save as a Test");

    await act(async () => {
      const control = document.querySelector('[aria-label="Confirm Test promotion"]');
      control?.closest("label")?.click();
    });
    await settle();
    await act(async () => button("Save as Test").click());
    await settle();

    expect(service.promoteSession).toHaveBeenCalled();
    expect(vi.mocked(service.promoteSession).mock.calls[0]?.[0]).toEqual({
      sessionId: "goal-1",
      confirmControl: true,
    });
    expect(host.textContent).toContain("Test promotion ready for review");
  });

  it("requires explicit review before resuming an uncertain goal", async () => {
    const { host, service } = await render(goalService(uncertainSessionResult()));

    await setValue("goal-description", "Find checkout");
    await setValue("goal-start-url", "https://example.test");
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Confirm target control"]')
        ?.closest("label")
        ?.click();
    });
    await settle();
    await act(async () => button("Explore goal").click());
    await settle();

    expect(host.textContent).toContain("Review before resuming");
    expect(button("Resume after review").disabled).toBe(true);
    await act(async () => {
      document
        .querySelector('[aria-label="Confirm reviewed target resume"]')
        ?.closest("label")
        ?.click();
    });
    await settle();
    await act(async () => button("Resume after review").click());
    await settle();

    expect(service.resumeSession).toHaveBeenCalledWith("goal-1");
  });

  it("prefills the start URL carried from the live workbench", async () => {
    const { host } = await render(
      goalService(),
      "/goals?url=https%3A%2F%2Fstaging.example.test%2Faccount",
    );

    const input = document.getElementById("goal-start-url");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect((input as HTMLInputElement).value).toBe("https://staging.example.test/account");

    // The carried URL satisfies the start form; only the goal text and control
    // confirmation remain before Explore becomes available.
    await setValue("goal-description", "Open language settings and capture the screen");
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Confirm target control"]')
        ?.closest("label")
        ?.click();
    });
    await settle();
    expect(button("Explore goal").disabled).toBe(false);
    expect(host.textContent).toContain("Start from a goal");
  });

  it("runs the goal on a saved Lane so its account carries into the run", async () => {
    const { host, service } = await render(
      goalService(),
      "/goals",
      laneService([
        { id: "grok-lab", kind: "fixture" },
        { id: "grok-daily", kind: "signed-out" },
      ]),
    );

    expect(host.textContent).toContain("Run as");

    const select = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.getAttribute("aria-label")?.includes("Run as"),
    );
    expect(select).toBeTruthy();
    await act(async () => select!.click());
    await settle();
    const option = [...document.querySelectorAll("[role='option']")].find((node) =>
      node.textContent?.includes("grok-lab"),
    );
    expect(option).toBeTruthy();
    await act(async () => {
      (option as HTMLElement).click();
    });
    await settle();
    expect(host.textContent).toContain(
      "Relay opens a fresh browser at the URL above, carrying the grok-lab Lane's saved sign-in. It does not continue your current browser session.",
    );

    await setValue("goal-description", "Open the signed-in account page");
    await setValue("goal-start-url", "https://example.test");
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Confirm target control"]')
        ?.closest("label")
        ?.click();
    });
    await settle();
    await act(async () => button("Explore goal").click());
    await settle();

    expect(vi.mocked(service.start).mock.calls[0]?.[0]).toMatchObject({
      goal: "Open the signed-in account page",
      startUrl: "https://example.test",
      laneId: "grok-lab",
      confirmControl: true,
    });
  });
});

it("goal page shows live server-owned activity with a cancel control", async () => {
  const service = goalService();
  vi.mocked(service.start).mockResolvedValue(sessionResult() as never);
  vi.mocked(service.inspectSession).mockImplementation(
    async () =>
      ({
        ...(sessionResult() as object),
        status: "running",
        actions: [
          {
            id: "action-1",
            step: 1,
            candidateId: "c1",
            label: "Settings",
            interaction: { kind: "identifier", target: { identifier: "open-settings" } },
            status: "acknowledged",
            observationDigestBefore: "sha256:" + "1".repeat(64),
            evidenceRefs: [],
            at: 1,
          },
          {
            id: "action-2",
            step: 2,
            candidateId: "sys-capture",
            label: "Capture",
            interaction: { kind: "capture", label: "capture" },
            status: "acknowledged",
            observationDigestBefore: "sha256:" + "2".repeat(64),
            evidenceRefs: ["run:1"],
            at: 2,
          },
        ],
        workflow: {
          workflowId: "goal-session:goal-1",
          version: 3,
          status: "active",
          kind: "goal-session",
        },
      }) as never,
  );
  const { host } = await render(service);
  await setValue("goal-description", "Open settings");
  await setValue("goal-start-url", "https://example.test");
  await act(async () => {
    const control = document.querySelector<HTMLButtonElement>(
      '[aria-label="Confirm target control"]',
    );
    control?.closest("label")?.click();
  });
  await act(async () => {
    const submit = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Explore goal"),
    );
    submit?.click();
  });
  await settle();
  expect(host.textContent).toContain("Cancel this goal");
  expect(host.textContent).toContain("Execution");
  expect(host.textContent).toContain("awaiting review");
  expect(host.textContent).toContain("Workflow");
  const cancel = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Cancel this goal"),
  );
  if (!cancel) throw new Error("missing cancel button");
  await act(async () => {
    cancel.click();
  });
  await settle();
  expect(vi.mocked(service.cancelSession).mock.calls[0]?.[0]).toBe("goal-1");
});
