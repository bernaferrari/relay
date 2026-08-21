import type { AppMapPoint, ConnectionPresentation } from "./app-map.js";

/**
 * CRDT-replicated canvas data. The execution graph itself stays authoritative
 * on the server: a live document may move a card or restyle a wire, but it
 * cannot silently alter device actions, evidence, flows, or run results.
 */
export type AppMapCanvasCollaborationEntities = {
  notes: Record<string, { id: string; text: string; position: AppMapPoint }>;
  groups: Record<string, { id: string; name: string; screenIds: string[] }>;
  /** `null` means restore automatic layout / remove an explicit position. */
  screenLayouts: Record<string, { id: string; position: AppMapPoint | null }>;
  /** `null` means restore the automatic connector presentation. */
  connectionPresentations: Record<
    string,
    { id: string; presentation: ConnectionPresentation | null }
  >;
};

export type AppMapCollaborationCollection = keyof AppMapCanvasCollaborationEntities;

/** Provider-neutral data shape for Yjs, Automerge, or a future Relay sync
 * service. Every collection is a stable-id map. Providers should represent a
 * connector presentation as a nested field map and x/y coordinates as atomic
 * point registers, rather than serializing and replacing this whole object. */
export type AppMapCollaborationDocument = {
  format: "relay.app-map-authoring";
  formatVersion: typeof import("./app-map.js").APP_MAP_COLLABORATION_DOCUMENT_VERSION;
  schemaVersion: typeof import("./app-map.js").APP_MAP_SCHEMA_VERSION;
  id: string;
  organizationId: string;
  projectId: string;
  createdAt: number;
  entities: AppMapCanvasCollaborationEntities;
};

/** `null` removes one visual override; omitted fields are left untouched. */
export type ConnectionPresentationPatch = {
  [Key in keyof ConnectionPresentation]?: ConnectionPresentation[Key] | null;
};

/**
 * Typed, field-level changes emitted by a collaboration provider. They are
 * intentionally narrower than `AppMapBatchChange`: the server converts them
 * into a normal revisioned commit, assigns authoritative timestamps, and
 * validates references before publishing a new canonical snapshot.
 */
export type AppMapCollaborationChange =
  | { kind: "note.save"; id: string; text: string; position: AppMapPoint }
  | { kind: "note.remove"; noteId: string }
  | { kind: "group.save"; id: string; name: string; screenIds: string[] }
  | { kind: "group.remove"; groupId: string }
  | { kind: "screen.layout"; screenId: string; position: AppMapPoint | null }
  | { kind: "connection.presentation"; connectionId: string; reset: true }
  | {
      kind: "connection.presentation";
      connectionId: string;
      patch: ConnectionPresentationPatch;
    };

/**
 * The minimal document façade a collaboration provider must implement. Relay
 * owns the document shape and validation; connection and awareness transport
 * stay in separate adapters. `origin` lets a future Yjs UndoManager track
 * local transactions without putting remote collaborator edits in Undo.
 */
export type AppMapCollaborationAdapter<TDocument = unknown> = {
  readonly kind: string;
  create(initial: AppMapCollaborationDocument): TDocument;
  read(document: TDocument): AppMapCollaborationDocument;
  /** Apply only the supplied entity fields inside one CRDT transaction. */
  transact(
    document: TDocument,
    changes: readonly AppMapCollaborationChange[],
    options?: { origin?: unknown },
  ): void;
  observe(document: TDocument, listener: () => void): () => void;
  destroy(document: TDocument): void;
};
