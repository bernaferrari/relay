import { describe, expect, it, vi } from "vitest";
import type { LiveTargetSession } from "./live-target-session";
import {
  createLiveTestEditorProductService,
  type LiveTestEditorSession,
} from "./live-test-editor-product-service";
import type { ProductRecordingState } from "./recording-product-service";
import type { ProductSessionDetail } from "./session-product-service";
import type { ProductTestEditorDocument } from "./test-editor-product-service";

const document = {
  appMapId: "map-1",
  appName: "Store",
  revision: 3,
  test: { id: "test-1", kind: "scenario", steps: [] },
  history: [],
  repairs: [],
} as unknown as ProductTestEditorDocument;

const authoring = {
  id: "session-1",
  appMapId: "map-1",
  target: { kind: "browser", platform: "browser", targetId: "browser-1" },
  state: "recording",
} as unknown as ProductSessionDetail;

function liveTarget(): LiveTargetSession {
  return { close: vi.fn() } as unknown as LiveTargetSession;
}

describe("live test editor product binding", () => {
  it("opens a legacy session as observe-only and never invents recording authority", async () => {
    const target = liveTarget();
    const editor = {
      get: vi.fn().mockResolvedValue(document),
      edit: vi.fn(),
      decideRepair: vi.fn(),
    };
    const sessions = {
      get: vi.fn().mockResolvedValue(authoring),
      live: vi.fn().mockResolvedValue(target),
    };
    const recording = { inspect: vi.fn(), liveTarget: vi.fn() };
    const service = createLiveTestEditorProductService({ editor, sessions, recording });

    const opened = await service.open({ testId: "test-1", sessionId: "session-1" });

    expect(opened.liveTarget).toBe(target);
    expect(opened.capabilities).toEqual({ edit: true, record: false, observe: true });
    expect(recording.inspect).not.toHaveBeenCalled();
    expect(recording.liveTarget).not.toHaveBeenCalled();
    expect(sessions.live).toHaveBeenCalledWith("session-1");
  });

  it("binds recording only through an explicit workflow and recording live target", async () => {
    const target = liveTarget();
    const recordingState = {
      status: "recording",
      targets: [],
      snapshot: { kind: "author-test" },
    } as unknown as ProductRecordingState;
    const editor = {
      get: vi.fn().mockResolvedValue(document),
      edit: vi.fn(),
      decideRepair: vi.fn(),
    };
    const sessions = {
      get: vi.fn().mockResolvedValue(authoring),
      live: vi.fn(),
    };
    const recording = {
      inspect: vi.fn().mockResolvedValue(recordingState),
      liveTarget: vi.fn().mockResolvedValue(target),
    };
    const service = createLiveTestEditorProductService({ editor, sessions, recording });

    const opened = await service.open({
      testId: "test-1",
      sessionId: "session-1",
      workflowId: "workflow-1",
    });

    expect(opened.recording).toBe(recordingState);
    expect(opened.capabilities.record).toBe(true);
    expect(recording.inspect).toHaveBeenCalledWith("workflow-1");
    expect(recording.liveTarget).toHaveBeenCalledWith(authoring.target);
    expect(sessions.live).not.toHaveBeenCalled();
  });

  it("rejects a cross-App-Map binding before opening the live target", async () => {
    const sessions = {
      get: vi.fn().mockResolvedValue({ ...authoring, appMapId: "other-map" }),
      live: vi.fn(),
    };
    const service = createLiveTestEditorProductService({
      editor: {
        get: vi.fn().mockResolvedValue(document),
        edit: vi.fn(),
        decideRepair: vi.fn(),
      },
      sessions,
      recording: { inspect: vi.fn(), liveTarget: vi.fn() },
    });

    await expect(service.open({ testId: "test-1", sessionId: "session-1" })).rejects.toThrow(
      "different app Maps",
    );
    expect(sessions.live).not.toHaveBeenCalled();
  });

  it("delegates edits to the existing app Map editor and keeps the live binding", async () => {
    const target = liveTarget();
    const nextDocument = { ...document, revision: 4 };
    const editor = {
      get: vi.fn().mockResolvedValue(document),
      edit: vi.fn().mockResolvedValue(nextDocument),
      decideRepair: vi.fn(),
    };
    const current: LiveTestEditorSession = {
      test: document,
      authoring,
      liveTarget: target,
      capabilities: { edit: true, record: false, observe: true },
    };
    const service = createLiveTestEditorProductService({
      editor,
      sessions: { get: vi.fn(), live: vi.fn() },
      recording: { inspect: vi.fn(), liveTarget: vi.fn() },
    });
    const edits = [{ kind: "test.rename", testId: "test-1", name: "Checkout" }] as never;

    const updated = await service.edit({ current, edits });

    expect(updated.test).toBe(nextDocument);
    expect(updated.liveTarget).toBe(target);
    expect(editor.edit).toHaveBeenCalledWith({ document, edits });
  });
});
