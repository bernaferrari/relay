/** @jsxImportSource react */
import type { AppMapScenarioTestEdit } from "@relay/protocol";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayApp } from "../app";
import type { LiveTargetSession } from "../data/live-target-session";
import type { LiveTestEditorProductService } from "../data/live-test-editor-product-service";
import { createLiveTestEditorProductService } from "../data/live-test-editor-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { ProductSessionDetail, SessionProductService } from "../data/session-product-service";
import type {
  ProductTestEditorDocument,
  TestEditorProductService,
} from "../data/test-editor-product-service";
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

const session = {
  id: "session-live",
  title: "Checkout Session",
  state: "recording",
  target: { kind: "browser", platform: "browser", targetId: "browser-1" },
  appMapId: "app-1",
  appName: "Checkout",
  actorId: "human:test",
  actorKind: "human",
  captureProvenance: "live",
  createdAt: 1,
  updatedAt: 2,
  lease: {
    id: "lease-1",
    projectId: "default",
    poolId: "pool-1",
    deviceSerial: "browser-1",
    ownerId: "human:test",
    status: "leased",
    leasedAt: 1,
    expiresAt: Date.now() + 60_000,
  },
  hasError: false,
  archived: false,
  committedTestId: "test-live",
  activity: [],
} as unknown as ProductSessionDetail;

const testDocument = {
  appMapId: "app-1",
  appName: "Checkout",
  revision: 4,
  test: {
    id: "test-live",
    organizationId: "local",
    projectId: "default",
    appMapId: "app-1",
    name: "Complete checkout",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "step-1",
        kind: "instruction",
        intent: "Open the cart",
        binding: { status: "resolved", kind: "connections", connectionIds: ["cart"] },
      },
    ],
    createdAt: 1,
    updatedAt: 2,
  },
  history: [],
  repairs: [],
} as unknown as ProductTestEditorDocument;

function liveTarget(): LiveTargetSession {
  const target = session.target;
  return {
    snapshot: () => ({ status: "streaming", target }),
    subscribe: () => () => undefined,
    mount: () => () => undefined,
    input: vi.fn(async () => undefined),
    close: vi.fn(),
  };
}

function sessionService(value: ProductSessionDetail = session): SessionProductService {
  return {
    list: async () => [value],
    get: vi.fn(async () => value),
    refresh: async () => value,
    end: async () => value,
    live: vi.fn(async () => liveTarget()),
  };
}

function editorService(value: ProductTestEditorDocument = testDocument) {
  let current = structuredClone(value);
  const edits: AppMapScenarioTestEdit[][] = [];
  const editor: TestEditorProductService = {
    get: vi.fn(async () => structuredClone(current)),
    edit: vi.fn(async ({ edits: nextEdits }) => {
      edits.push(structuredClone([...nextEdits]));
      current = { ...current, revision: current.revision + 1 };
      return structuredClone(current);
    }),
    undo: vi.fn(async () => structuredClone(current)),
    redo: vi.fn(async () => structuredClone(current)),
    decideRepair: vi.fn(async () => structuredClone(current)),
  };
  return { editor, edits };
}

async function render(
  path: string,
  options: {
    session?: ProductSessionDetail;
    liveTestEditorService?: LiveTestEditorProductService;
    editor?: TestEditorProductService;
    sessionService?: SessionProductService;
  } = {},
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
        productService={{ listApps: async () => [] } as unknown as RecordingProductService}
        sessionService={options.sessionService ?? sessionService(options.session ?? session)}
        testEditorService={options.editor}
        liveTestEditorService={options.liveTestEditorService}
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

async function fill(id: string, value: string) {
  const input = document.getElementById(id);
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement))
    throw new Error(`Input not found: ${id}`);
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

async function click(label: string) {
  const control = [...document.querySelectorAll<HTMLElement>("button, a")].find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (!control) throw new Error(`Control not found: ${label}`);
  await act(async () => control.click());
  await settle();
}

async function clearMountedApp() {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

describe("live Session to Test editor", () => {
  it("clears target and search constraints when opening saved drafts", async () => {
    const history = await render("/sessions?status=history&target=other&q=missing", {
      sessionService: sessionService({ ...session, state: "reviewing" }),
    });

    await click("Show drafts");

    expect(history.location.search).toBe("?status=drafts");
    expect(document.body.textContent).toContain("Checkout Session");
  });

  it("shows a compact recovery state when the Session cannot be loaded", async () => {
    const unavailable = sessionService();
    unavailable.get = vi.fn(async () => {
      throw new Error("Relay returned HTTP 400.");
    });

    await render("/sessions/missing-session", { sessionService: unavailable });

    expect(document.querySelector("h1")?.textContent).toBe("Couldn’t load this Session");
    expect(document.body.textContent).not.toContain("Durable live target context");
    expect(document.body.textContent).not.toContain("HTTP 400");
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(
      [...document.querySelectorAll<HTMLAnchorElement>('a[href="/sessions"]')].some(
        (link) => link.textContent === "Back to Live",
      ),
    ).toBe(true);
  });

  it("only offers live Test editing for a controllable committed Session and preserves the binding", async () => {
    const service = sessionService();
    await render("/sessions/session-live", { sessionService: service });

    expect(document.body.textContent).toContain("Edit Test live");
    expect(document.body.textContent).toContain("End session");
    expect(document.body.textContent).not.toContain("Investigate");
    // No Session overflow menu; the shell's mobile "More navigation" button is not part of the page.
    expect(
      [...document.querySelectorAll("button")].some(
        (button) =>
          button.textContent?.trim() === "More" &&
          !button.closest('nav[aria-label="Main navigation"]'),
      ),
    ).toBe(false);
    expect(document.querySelector('a[href^="/debug"]')).toBeNull();
    expect(
      document.querySelector<HTMLAnchorElement>(
        'a[href="/tests/test-live/edit?session=session-live"]',
      ),
    ).not.toBeNull();
    expect(service.get).toHaveBeenCalledWith("session-live");
    expect(service.live).toHaveBeenCalledWith("session-live");
    expect(document.body.textContent).toContain("Checkout");
    expect(document.body.textContent).toContain("Manual");
    expect(document.body.textContent).toContain("Browser");
    expect(document.body.textContent).not.toContain("Browser profile unavailable");
    expect(document.body.textContent).toContain("Recording · captured actions are saved");
    expect(document.body.textContent).toContain("Tap, type, or scroll. Not recorded.");
    expect(document.querySelector('[data-slot="live-device-rail"]')).not.toBeNull();
    await click("Technical details");
    expect(document.body.textContent).toContain("Map ID");
    expect(document.body.textContent).toContain("Device reservation status");

    await clearMountedApp();
    const ended = {
      ...session,
      state: "cancelled",
      lease: { ...session.lease, expiresAt: Date.now() + 60_000 },
    } as unknown as ProductSessionDetail;
    const endedHistory = await render("/sessions/session-live", { session: ended });
    expect(document.body.textContent).not.toContain("Edit Test live");
    expect(document.body.textContent).not.toContain("End session");
    expect(document.body.textContent).toContain("Open saved Test");
    expect(endedHistory.location.pathname).toBe("/sessions/session-live");

    await clearMountedApp();
    const uncommitted = {
      ...session,
      committedTestId: undefined,
    } as unknown as ProductSessionDetail;
    await render("/sessions/session-live", { session: uncommitted });
    expect(document.body.textContent).not.toContain("Edit Test live");
  });

  it("shows a recovery explanation instead of a connecting canvas for an expired reservation", async () => {
    const expired = {
      ...session,
      lease: { ...session.lease, expiresAt: 1 },
    } as ProductSessionDetail;
    await render("/sessions/session-live", { session: expired });
    expect(document.body.textContent).toContain("The connection to this device timed out.");
    expect(document.body.textContent).toContain("End session");
    expect(document.body.textContent).not.toContain("Investigate");
    expect(document.body.textContent).not.toContain("Connecting to the target");
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("ends an active Session from the visible header action", async () => {
    const ended = {
      ...session,
      state: "cancelled",
      lease: { ...session.lease, status: "released" },
    } as unknown as ProductSessionDetail;
    const service = sessionService();
    service.end = vi.fn(async () => {
      service.get = vi.fn(async () => ended);
      return ended;
    });

    await render("/sessions/session-live", { sessionService: service });
    await click("End session");
    expect(document.body.textContent).toContain("End this Live session?");
    expect(document.body.textContent).toContain("The device is released. Saved evidence stays.");

    const confirm = document.querySelector<HTMLButtonElement>('[data-slot="session-end-button"]');
    expect(confirm).not.toBeNull();
    await act(async () => confirm!.click());
    await settle();

    expect(service.end).toHaveBeenCalledWith("session-live");
    expect(document.body.textContent).toContain("This session has ended");
    expect(document.body.textContent).not.toContain("End session");
  });

  it("adopts an external Session end after the canonical refresh", async () => {
    const ended = {
      ...session,
      state: "cancelled",
      lease: { ...session.lease, status: "released" },
    } as unknown as ProductSessionDetail;
    const service = sessionService();
    service.refresh = vi.fn(async () => ended);

    await render("/sessions/session-live", { sessionService: service });
    expect(document.body.textContent).toContain("Refresh target");
    await click("Refresh target");

    expect(service.refresh).toHaveBeenCalledWith("session-live");
    expect(document.body.textContent).toContain("This session has ended");
    expect(document.body.textContent).not.toContain("Refresh target");
  });

  it("opens the exact live binding, stays observe-only, and persists edits through the live service", async () => {
    const sessions = sessionService();
    const harness = editorService();
    const target = liveTarget();
    sessions.live = vi.fn(async () => target);
    const liveEditor = createLiveTestEditorProductService({
      editor: harness.editor,
      sessions,
      recording: { inspect: vi.fn(), liveTarget: vi.fn() },
    });
    const open = vi.spyOn(liveEditor, "open");
    const edit = vi.spyOn(liveEditor, "edit");
    const history = await render("/tests/test-live/edit?session=session-live", {
      sessionService: sessions,
      editor: harness.editor,
      liveTestEditorService: liveEditor,
    });

    expect(open).toHaveBeenCalledWith({ testId: "test-live", sessionId: "session-live" });
    expect(harness.editor.get).toHaveBeenCalledWith("test-live");
    expect(document.body.textContent).not.toContain("Open Session");
    expect(document.querySelector("#session-stage-title")?.textContent).not.toBe("Live");
    expect(document.querySelector("#live-editor-title")?.textContent).toBeTruthy();
    expect(document.querySelector('[data-slot="live-device-rail"]')).not.toBeNull();
    expect(document.querySelector('[data-inspector-kind="device"]')).not.toBeNull();
    expect(history.location.search).toBe("?session=session-live");

    await fill("selected-step-intent", "Open the updated cart");
    await click("Save");

    const editCall = edit.mock.calls[0]?.[0];
    expect(editCall?.current.test.test.id).toBe("test-live");
    expect(editCall?.current.liveTarget).toBe(target);
    expect(editCall?.edits).toEqual([
      {
        kind: "step.patch",
        stepId: "step-1",
        patch: { intent: "Open the updated cart", note: null, capture: false },
      },
    ]);
    expect(harness.edits.at(-1)).toEqual([
      {
        kind: "step.patch",
        stepId: "step-1",
        patch: { intent: "Open the updated cart", note: null, capture: false },
      },
    ]);
    expect(history.location.search).toBe("?session=session-live");
  });
});
