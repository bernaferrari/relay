import type { ActorKind } from "./coordination.js";

/**
 * Ephemeral presence is intentionally separate from the persisted App Map.
 * It can later be transported by Yjs awareness, WebSocket, or another adapter
 * without changing canonical project entities.
 */
export type CollaborationActivity = "editing" | "recording" | "running" | "idle";
export type CollaborationCanvasPoint = { x: number; y: number };
export type CollaborationViewport = CollaborationCanvasPoint & {
  zoom: number;
  width: number;
  height: number;
};
export type CollaborationSelection = {
  screenId?: string;
  connectionId?: string;
};

export type CollaborationAwareness = {
  actorId: string;
  actorKind: ActorKind;
  updatedAt: number;
  expiresAt: number;
  displayName?: string;
  avatarToken?: string;
  cursor?: CollaborationCanvasPoint;
  selection?: CollaborationSelection;
  viewport?: CollaborationViewport;
  activity: CollaborationActivity;
};

/**
 * Provider-neutral ephemeral awareness seam. This never writes to an App Map
 * document: a Yjs adapter can use Awareness, while the current local server
 * can keep using its short-lived presence endpoint.
 */
export type CollaborationAwarenessAdapter<TSession = unknown> = {
  readonly kind: string;
  setLocal(
    session: TSession,
    awareness: Omit<CollaborationAwareness, "updatedAt" | "expiresAt">,
  ): void;
  observe(
    session: TSession,
    listener: (awareness: readonly CollaborationAwareness[]) => void,
  ): () => void;
  destroy(session: TSession): void;
};
