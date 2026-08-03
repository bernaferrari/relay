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
