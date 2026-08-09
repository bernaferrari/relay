import { For, Show, createMemo } from "solid-js";
import type { CollaborationAwareness } from "@relay/protocol";
import {
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  type CanvasPoint,
} from "../lib/app-map-canvas-layout";

export type PresenceGeometry = Readonly<{
  screenPositions: Readonly<Record<string, CanvasPoint>>;
  connectionPaths: Readonly<Record<string, string>>;
}>;

export type PresenceVisual = Readonly<{
  actorId: string;
  actorKind: CollaborationAwareness["actorKind"];
  label: string;
  color: string;
  cursor?: CanvasPoint;
  screen?: { id: string; position: CanvasPoint };
  connection?: { id: string; path: string };
}>;

function actorColor(actor: CollaborationAwareness): string {
  if (actor.actorKind === "agent") return "var(--text-info-base)";
  if (actor.actorKind === "system") return "var(--text-weak)";
  return "var(--text-interactive-base)";
}

function actorLabel(actor: CollaborationAwareness): string {
  if (actor.displayName) return actor.displayName;
  if (actor.actorKind === "agent") return "Agent";
  if (actor.actorKind === "system") return "Relay";
  return "Collaborator";
}

/** Pure projection: remote awareness can only become passive render geometry. */
export function collaborationPresenceVisuals(
  awareness: readonly CollaborationAwareness[],
  geometry: PresenceGeometry,
): PresenceVisual[] {
  return awareness.map((actor) => {
    const screenId = actor.selection?.screenId;
    const connectionId = actor.selection?.connectionId;
    const position = screenId ? geometry.screenPositions[screenId] : undefined;
    const path = connectionId ? geometry.connectionPaths[connectionId] : undefined;
    return {
      actorId: actor.actorId,
      actorKind: actor.actorKind,
      label: actorLabel(actor),
      color: actorColor(actor),
      ...(actor.cursor ? { cursor: { ...actor.cursor } } : {}),
      ...(screenId && position ? { screen: { id: screenId, position: { ...position } } } : {}),
      ...(connectionId && path ? { connection: { id: connectionId, path } } : {}),
    };
  });
}

/** Quiet, pointer-transparent overlays. They cannot focus or move the canvas. */
export function CollaborationPresence(props: {
  awareness: readonly CollaborationAwareness[];
  geometry: PresenceGeometry;
  width: number;
  height: number;
}) {
  const visuals = createMemo(() => collaborationPresenceVisuals(props.awareness, props.geometry));
  return (
    <div class="pointer-events-none absolute inset-0 z-30" aria-hidden="true">
      <svg class="absolute inset-0 overflow-visible" width={props.width} height={props.height}>
        <For each={visuals()}>
          {(visual) => (
            <Show when={visual.connection}>
              {(connection) => (
                <path
                  d={connection().path}
                  fill="none"
                  stroke={visual.color}
                  stroke-width="4"
                  stroke-linecap="round"
                  opacity="0.58"
                />
              )}
            </Show>
          )}
        </For>
      </svg>
      <For each={visuals()}>
        {(visual) => (
          <>
            <Show when={visual.screen}>
              {(screen) => (
                <div
                  class="absolute rounded-[16px] border-2 opacity-65"
                  style={{
                    transform: `translate3d(${screen().position.x - 4}px, ${screen().position.y - 4}px, 0)`,
                    width: `${SCREEN_CARD_WIDTH + 8}px`,
                    height: `${SCREEN_CARD_HEIGHT + 8}px`,
                    "border-color": visual.color,
                  }}
                />
              )}
            </Show>
            <Show when={visual.cursor}>
              {(cursor) => (
                <div
                  class="absolute flex items-start gap-1 drop-shadow-[0_2px_5px_rgb(0_0_0/45%)]"
                  style={{ transform: `translate3d(${cursor().x}px, ${cursor().y}px, 0)` }}
                >
                  <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden="true">
                    <path
                      d="M1.2 1.1 14.3 10l-6.2 1.2-3.6 6.1z"
                      fill={visual.color}
                      stroke="var(--background-deep)"
                      stroke-width="1.2"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <span
                    class="mt-3 max-w-32 truncate rounded-full px-2 py-0.5 text-[9px] font-semibold text-[var(--text-invert-strong)] shadow-sm"
                    style={{ background: visual.color }}
                  >
                    {visual.label}
                  </span>
                </div>
              )}
            </Show>
          </>
        )}
      </For>
    </div>
  );
}
