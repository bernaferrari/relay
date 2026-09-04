import type { AppMapScenarioTestEdit } from "@relay/protocol";
import type { ProductRecordingState, RecordingProductService } from "./recording-product-service";
import type { LiveTargetSession } from "./live-target-session";
import type {
  ProductTestEditorDocument,
  TestEditorProductService,
} from "./test-editor-product-service";
import type { ProductSessionDetail, SessionProductService } from "./session-product-service";

/** Capabilities are explicit because a low-level/legacy Session has a live
 * target but no durable recording workflow to which interactions can safely
 * be attached. */
export type LiveTestEditorCapabilities = {
  readonly edit: true;
  readonly record: boolean;
  readonly observe: true;
};

export type LiveTestEditorSession = {
  readonly test: ProductTestEditorDocument;
  readonly authoring: ProductSessionDetail;
  readonly recording?: ProductRecordingState;
  readonly liveTarget: LiveTargetSession;
  readonly capabilities: LiveTestEditorCapabilities;
};

type EditorOperations = Pick<
  TestEditorProductService,
  "get" | "edit" | "undo" | "redo" | "decideRepair"
>;
type SessionOperations = Pick<SessionProductService, "get" | "live">;
type RecordingOperations = Pick<RecordingProductService, "inspect" | "liveTarget">;

export type LiveTestEditorProductService = {
  open(input: {
    testId: string;
    sessionId: string;
    /** Durable workflow id returned by the recording outcome workflow. It is
     * intentionally caller-supplied; Session ids are not workflow ids. */
    workflowId?: string;
  }): Promise<LiveTestEditorSession>;
  refresh(input: {
    current: LiveTestEditorSession;
    workflowId?: string;
  }): Promise<LiveTestEditorSession>;
  edit(input: {
    current: LiveTestEditorSession;
    edits: readonly AppMapScenarioTestEdit[];
  }): Promise<LiveTestEditorSession>;
  undo(input: { current: LiveTestEditorSession }): Promise<LiveTestEditorSession>;
  redo(input: { current: LiveTestEditorSession }): Promise<LiveTestEditorSession>;
  decideRepair(input: {
    current: LiveTestEditorSession;
    proposalId: string;
    decision: "approve" | "reject" | "revert";
  }): Promise<LiveTestEditorSession>;
  close(current: LiveTestEditorSession): void;
};

function assertBinding(
  testId: string,
  document: ProductTestEditorDocument | undefined,
  authoring: ProductSessionDetail | undefined,
): void {
  if (!document) throw new TypeError(`Test ${testId} is not available for editing.`);
  if (!authoring) throw new TypeError("The Authoring Session is no longer available.");
  if (document.test.id !== testId) {
    throw new TypeError("The editor returned a different Test than requested.");
  }
  if (authoring.appMapId !== document.appMapId) {
    throw new TypeError("The Test and Authoring Session belong to different App Maps.");
  }
  if (authoring.committedTestId && authoring.committedTestId !== testId) {
    throw new TypeError("The Authoring Session is committed to a different Test.");
  }
}

function recordingCapability(
  recording: ProductRecordingState | undefined,
): LiveTestEditorCapabilities {
  return {
    edit: true,
    record: Boolean(recording && recording.status === "recording" && recording.snapshot),
    observe: true,
  };
}

export function createLiveTestEditorProductService(input: {
  editor: EditorOperations;
  sessions: SessionOperations;
  recording: RecordingOperations;
}): LiveTestEditorProductService {
  async function open(inputValue: {
    testId: string;
    sessionId: string;
    workflowId?: string;
  }): Promise<LiveTestEditorSession> {
    const [document, authoring] = await Promise.all([
      input.editor.get(inputValue.testId),
      input.sessions.get(inputValue.sessionId),
    ]);
    assertBinding(inputValue.testId, document, authoring);
    if (!document || !authoring) throw new TypeError("The live Test binding is incomplete.");
    const recording = inputValue.workflowId
      ? await input.recording.inspect(inputValue.workflowId)
      : undefined;
    const liveTarget =
      recording && input.recording.liveTarget
        ? await input.recording.liveTarget(authoring.target)
        : await input.sessions.live(inputValue.sessionId);
    return {
      test: document,
      authoring,
      ...(recording ? { recording } : {}),
      liveTarget,
      capabilities: recordingCapability(recording),
    };
  }

  async function refreshed(
    current: LiveTestEditorSession,
    workflowId?: string,
  ): Promise<LiveTestEditorSession> {
    return open({
      testId: current.test.test.id,
      sessionId: current.authoring.id,
      ...(workflowId ? { workflowId } : {}),
    });
  }

  async function withDocument(
    current: LiveTestEditorSession,
    operation: (document: ProductTestEditorDocument) => Promise<ProductTestEditorDocument>,
  ): Promise<LiveTestEditorSession> {
    const document = await operation(current.test);
    assertBinding(current.test.test.id, document, current.authoring);
    return { ...current, test: document };
  }

  return {
    open,
    refresh: ({ current, workflowId }) => refreshed(current, workflowId),
    edit: ({ current, edits }) =>
      withDocument(current, (document) => input.editor.edit({ document, edits: [...edits] })),
    undo: ({ current }) =>
      input.editor.undo
        ? withDocument(current, (document) => input.editor.undo!({ document }))
        : Promise.reject(new TypeError("Saved Test history is unavailable.")),
    redo: ({ current }) =>
      input.editor.redo
        ? withDocument(current, (document) => input.editor.redo!({ document }))
        : Promise.reject(new TypeError("Saved Test history is unavailable.")),
    decideRepair: ({ current, proposalId, decision }) =>
      withDocument(current, (document) =>
        input.editor.decideRepair({ document, proposalId, decision }),
      ),
    close: (current) => current.liveTarget.close(),
  };
}
