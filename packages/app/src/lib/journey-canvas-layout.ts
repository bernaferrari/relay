import type { JourneyCanvasNote } from "@relay/protocol";
import type { JourneyTreeNode } from "./journey-tree";

export type CanvasPoint = { x: number; y: number };
export type CanvasViewport = CanvasPoint & { scale: number };

export const SCREEN_CARD_WIDTH = 196;
export const SCREEN_CARD_HEIGHT = 248;
export const MIN_CANVAS_SCALE = 0.3;
export const MAX_CANVAS_SCALE = 1.25;

export function clampCanvasScale(value: number): number {
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, value));
}

export function canvasBounds(
  nodes: JourneyTreeNode[],
  notes: JourneyCanvasNote[],
  positionFor: (node: JourneyTreeNode) => CanvasPoint,
): { width: number; height: number } {
  if (!nodes.length && !notes.length) return { width: 760, height: 560 };
  const right = Math.max(
    ...nodes.map((node) => positionFor(node).x + SCREEN_CARD_WIDTH),
    ...notes.map((note) => note.x + 220),
    648,
  );
  const bottom = Math.max(
    ...nodes.map((node) => positionFor(node).y + SCREEN_CARD_HEIGHT),
    ...notes.map((note) => note.y + 132),
    448,
  );
  return { width: Math.max(760, right + 112), height: Math.max(560, bottom + 112) };
}

export function fitCanvasViewport(
  client: { width: number; height: number },
  content: { width: number; height: number },
): CanvasViewport {
  const padding = 56;
  const scale = clampCanvasScale(
    Math.min(
      1,
      (client.width - padding * 2) / content.width,
      (client.height - padding * 2) / content.height,
    ),
  );
  return {
    scale,
    x: Math.max(padding, (client.width - content.width * scale) / 2),
    y: Math.max(padding, (client.height - content.height * scale) / 2),
  };
}

export function canvasEdgeGeometry(
  edge: { from: string; to: string; kind: "forward" | "return" },
  nodes: JourneyTreeNode[],
  positionFor: (node: JourneyTreeNode) => CanvasPoint,
): { path: string } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);
  if (!from || !to) return { path: "" };
  const fromPosition = positionFor(from);
  const toPosition = positionFor(to);
  if (edge.kind === "return") {
    const startX = fromPosition.x + SCREEN_CARD_WIDTH / 2;
    const startY = fromPosition.y;
    const endX = toPosition.x + SCREEN_CARD_WIDTH / 2;
    const endY = toPosition.y;
    const railY = Math.min(startY, endY) - 34;
    return { path: `M ${startX} ${startY} C ${startX} ${railY}, ${endX} ${railY}, ${endX} ${endY}` };
  }
  const startX = fromPosition.x + SCREEN_CARD_WIDTH;
  const startY = fromPosition.y + SCREEN_CARD_HEIGHT / 2;
  const endX = toPosition.x;
  const endY = toPosition.y + SCREEN_CARD_HEIGHT / 2;
  return { path: `M ${startX} ${startY} C ${startX + 48} ${startY}, ${endX - 48} ${endY}, ${endX} ${endY}` };
}

export function draftCanvasConnectionPath(
  fromId: string,
  point: CanvasPoint,
  nodes: JourneyTreeNode[],
  positionFor: (node: JourneyTreeNode) => CanvasPoint,
): string {
  const from = nodes.find((node) => node.id === fromId);
  if (!from) return "";
  const origin = positionFor(from);
  const startX = origin.x + SCREEN_CARD_WIDTH;
  const startY = origin.y + SCREEN_CARD_HEIGHT / 2;
  return `M ${startX} ${startY} C ${startX + 48} ${startY}, ${point.x - 48} ${point.y}, ${point.x} ${point.y}`;
}
