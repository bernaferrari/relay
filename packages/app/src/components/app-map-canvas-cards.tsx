import { Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import type { CanvasNote } from "@relay/protocol";
import { IconButton } from "@relay/ui/icon-button";
import type { MapTreeNode } from "../lib/app-map-tree";
import { LABEL_ROW_PITCH } from "../lib/app-map-label-rows";
import { cn } from "../lib/cn";
import type { AppMapRunPresentationState } from "../lib/app-map-run-projection";
import type { CanvasInteractionAnchor, ScreenCardGeometry } from "../lib/app-map-canvas-layout";
import {
  screenCardActionsVisible,
  screenCardStartMarkerVisible,
} from "../lib/app-map-screen-presentation";
import {
  companionLogicalPointToDisplayed,
  companionLogicalRectToDisplayed,
} from "./app-map-device-companion-geometry";
import { Icon } from "./icon";
import {
  OrientedScreenshot,
  type ScreenshotOrientationEvidence,
  type ScreenshotRotation,
} from "./oriented-screenshot";

/** Matches the screen card's own width, which is the horizontal pitch of the
 * canvas grid. A name may overhang the phone frame it labels, but never its
 * neighbour. */
const SCREEN_CARD_LABEL_WIDTH = 240;

/**
 * The one empty-screenshot object, shared by canvas frames and grid tiles:
 * icon tile plus a guidance line, drawn against --map-canvas-backdrop so an
 * empty frame and a filled one read as the same letterboxed thing. `size`
 * tunes the tile between compact canvas frames and roomy grid tiles.
 */
export function EmptyScreenshot(props: { size?: "compact" | "roomy"; hint?: string }) {
  const compact = props.size === "compact";
  return (
    <div
      class={cn(
        "grid justify-items-center gap-1.5 px-4 text-center",
        compact ? "max-w-[160px]" : "max-w-[176px]",
      )}
    >
      <span
        class={cn(
          "grid place-items-center rounded-xl bg-[color-mix(in_srgb,var(--text-invert-strong)_10%,transparent)]",
          compact ? "size-8" : "size-9",
        )}
      >
        <Icon name="camera" size={compact ? 14 : 15} />
      </span>
      <span class="pt-0.5 text-caption font-medium text-[var(--text-invert-strong)]">
        No screenshot
      </span>
      <Show when={props.hint}>
        {(hint) => (
          <span class="text-micro/[1.35] text-[var(--text-invert-weak)]">{hint()}</span>
        )}
      </Show>
    </div>
  );
}

/** Presentation-only canvas objects. They deliberately receive callbacks
 * instead of knowing about the graph document or recorder state. */
export function CanvasNoteCard(props: {
  note: CanvasNote;
  onPointerDown: (event: PointerEvent & { currentTarget: HTMLButtonElement }) => void;
  onText: (text: string) => void;
  onCommit: (previousText: string) => void;
  onDelete: () => void;
}) {
  let textAtFocus = props.note.text;
  return (
    <article
      class="absolute w-[220px] overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--border-strong-base)_74%,transparent)] bg-[color-mix(in_srgb,var(--surface-base)_96%,var(--product-accent-soft))] shadow-[var(--map-elevation-panel)]"
      style={{ transform: `translate3d(${props.note.x}px, ${props.note.y}px, 0)` }}
    >
      <header class="flex h-8 items-center justify-between border-b border-[color-mix(in_srgb,var(--border-weak-base)_82%,transparent)] px-1">
        <button
          type="button"
          class="flex h-full min-w-0 flex-1 touch-none cursor-grab select-none items-center gap-1.5 px-1.5 text-left active:cursor-grabbing"
          aria-label="Move note"
          data-tip="Drag to move"
          onPointerDown={props.onPointerDown}
        >
          <Icon name="move" size={11} class="text-[var(--text-weak)]" />
          <span class="text-micro font-semibold text-[var(--text-strong)]">Note</span>
        </button>
        <button
          type="button"
          class="relative grid size-8 place-items-center rounded-lg text-[var(--text-weak)] before:absolute before:-inset-1 transition-colors hover:bg-[var(--surface-base-hover)] hover:text-[var(--icon-critical-base)]"
          aria-label="Delete note"
          onClick={props.onDelete}
        >
          <Icon name="x" size={11} />
        </button>
      </header>
      <textarea
        class="block min-h-[96px] w-full resize-none bg-transparent px-2.5 py-2 text-caption/[1.5] text-[var(--text-base)] outline-none placeholder:text-[var(--text-weak)]"
        value={props.note.text}
        aria-label="Canvas note"
        onPointerDown={(event) => event.stopPropagation()}
        onFocus={() => {
          textAtFocus = props.note.text;
        }}
        onInput={(event) => props.onText(event.currentTarget.value.slice(0, 480))}
        onBlur={() => props.onCommit(textAtFocus)}
      />
    </article>
  );
}

export function ScreenCard(props: {
  node: MapTreeNode;
  isFlowStart: boolean;
  title: string;
  /** Only set when a sibling frame carries the same name. */
  qualifier?: string;
  selected: boolean;
  editing: boolean;
  runState?: AppMapRunPresentationState;
  position: { x: number; y: number };
  geometry: ScreenCardGeometry;
  src: () => string;
  orientationEvidence?: ScreenshotOrientationEvidence;
  /** The exact recorded action that starts the selected connection, if known. */
  selectedConnectionOrigin?: CanvasInteractionAnchor;
  /** This screen is the source of the selected connection. */
  connectionOrigin?: boolean;
  onRotationChange?: (rotation: ScreenshotRotation) => void;
  onNaturalSize?: (size: { width: number; height: number }) => void;
  showActions?: boolean;
  onSelect: (event?: MouseEvent) => void;
  onContextMenu?: (event: MouseEvent) => void;
  onRename: () => void;
  onOpenDetails: () => void;
  onRun?: () => void;
  onCommitRename: (title: string) => void;
  onPointerDown: (event: PointerEvent & { currentTarget: HTMLElement }) => void;
  onNudge: (direction: { x: number; y: number }, coarse: boolean) => void;
  /** Live device is on this mapped screen. Distinct from selected. */
  here?: boolean;
  /** Rows to lift the name by when a neighbour already owns its usual place. */
  labelRow?: number;
}) {
  let titleInput: HTMLInputElement | undefined;
  const [imageFailed, setImageFailed] = createSignal(false);
  createEffect(on(props.src, () => setImageFailed(false)));
  createEffect(() => {
    if (!props.editing) return;

    titleInput?.focus({ preventScroll: true });
    titleInput?.select();
    const finishEditing = (event: PointerEvent) => {
      if (!titleInput || titleInput.contains(event.target as Node)) return;
      titleInput.blur();
    };
    document.addEventListener("pointerdown", finishEditing, true);
    onCleanup(() => document.removeEventListener("pointerdown", finishEditing, true));
  });
  const visibleSrc = () => (props.src() && !imageFailed() ? props.src() : "");
  const showsStart = () =>
    !props.editing &&
    !props.connectionOrigin &&
    !props.here &&
    screenCardStartMarkerVisible(props.title, props.isFlowStart);
  const showsRunStatus = () => !props.editing && props.runState && props.runState !== "idle";
  // Each state owns its own channel: run outcomes colour the ring, selection
  // is the only solid blue ring, "running" pulses instead so a live frame can
  // never be mistaken for the selected one, and "here" is just its pulse dot —
  // no ring, so it cannot collide with "passed" green.
  const frameStateClass = () =>
    props.runState === "failed"
      ? "ring-2 ring-[var(--icon-critical-base)]"
      : props.runState === "running"
        ? "ring-2 ring-[var(--text-interactive-base)] motion-safe:animate-pulse"
        : props.runState === "healed"
          ? "ring-2 ring-[var(--icon-warning-base)]"
          : props.runState === "passed"
            ? "ring-2 ring-[var(--icon-success-base)]"
            : props.here
              ? ""
              : props.selected
                ? "ring-2 ring-[var(--text-interactive-base)] shadow-[var(--map-elevation-card)]"
                : "ring-1 ring-[color-mix(in_srgb,var(--border-strong-base)_55%,transparent)] group-hover/screen:ring-[var(--border-strong-base)] group-hover/screen:shadow-[var(--map-elevation-card)]";
  return (
    <article
      role="group"
      aria-roledescription="screen"
      tabIndex={0}
      aria-label={`${props.title} screen${props.qualifier ? `, ${props.qualifier}` : ""}${props.connectionOrigin ? ", origin of selected path" : props.here ? ", here" : ""}${props.selected ? ", selected" : ""}`}
      data-app-map-screen-id={props.node.id}
      class={cn(
        "group/screen absolute grid w-[240px] grid-rows-[24px_var(--screen-frame-height)] gap-[6px] overflow-visible text-left outline-none",
        "shadow-[var(--focus-ring-canvas)] focus-visible:rounded-xl motion-safe:focus-visible:animate-pulse",
        (props.selected || props.here) && "z-20",
      )}
      data-app-map-connection-origin={props.connectionOrigin ? "true" : undefined}
      data-tip="Click to inspect · Enter opens details"
      style={{
        transform: `translate3d(${props.position.x}px, ${props.position.y}px, 0)`,
        height: `${props.geometry.height}px`,
        "--screen-frame-height": `${props.geometry.frameHeight}px`,
      }}
      onClick={props.onSelect}
      onContextMenu={props.onContextMenu}
      onKeyDown={(event) => {
        const direction =
          event.key === "ArrowLeft"
            ? { x: -1, y: 0 }
            : event.key === "ArrowRight"
              ? { x: 1, y: 0 }
              : event.key === "ArrowUp"
                ? { x: 0, y: -1 }
                : event.key === "ArrowDown"
                  ? { x: 0, y: 1 }
                  : undefined;
        if (direction) {
          event.preventDefault();
          event.stopPropagation();
          props.onNudge(direction, event.shiftKey);
          return;
        }
        if (event.key === "F2") {
          event.preventDefault();
          props.onRename();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          props.onOpenDetails();
          return;
        }
        if (event.key === " ") {
          event.preventDefault();
          props.onSelect();
        }
      }}
      onPointerDown={props.onPointerDown}
    >
      <Show
        when={screenCardActionsVisible({
          ...props,
          hasRunAction: Boolean(props.onRun),
        })}
      >
        <div
          role="toolbar"
          class="absolute top-[30px] z-30 flex items-center gap-0.5 rounded-xl border border-[color-mix(in_srgb,var(--border-strong-base)_42%,transparent)] bg-[var(--map-control-surface)] p-[3px] shadow-[var(--map-elevation-chip)]"
          aria-label={`${props.title} screen actions`}
          style={{ left: `${props.geometry.frameLeft + props.geometry.frameWidth + 10}px` }}
        >
          <IconButton
            variant="primary"
            size="md"
            aria-label={`Run from Start to ${props.title}`}
            title="Run from Start to here"
            data-tip="Run from Start to here"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              props.onRun?.();
            }}
          >
            <Icon name="play" size={12} class="ml-px" />
          </IconButton>
        </div>
      </Show>
      <header
        class="relative grid min-w-0 grid-cols-[minmax(auto,1fr)_auto_minmax(auto,1fr)] items-center gap-1.5 px-0.5"
        style={{
          // Budget is one card pitch, not the narrow phone frame the label sits
          // above, and it is divided by the counter scale so the on-screen width
          // stays constant. Without the division, zooming out grows every name
          // until neighbouring screens overwrite each other.
          width: `calc(${SCREEN_CARD_LABEL_WIDTH}px / var(--app-map-label-counter, 1))`,
          "justify-self": "center",
          // Grows away from the frame so the name never covers the screenshot.
          // The lift is in world units — multiplying by the counter keeps it a
          // constant on-screen distance at every zoom, like the name itself.
          transform: props.labelRow
            ? `translateY(calc(${-props.labelRow * LABEL_ROW_PITCH}px * var(--app-map-label-counter, 1))) scale(var(--app-map-label-counter, 1))`
            : "scale(var(--app-map-label-counter, 1))",
          "transform-origin": "center bottom",
        }}
        data-tip="Click to inspect · Enter opens details"
      >
        {/* The side tracks above reserve exactly what a "Here" or run pill
            needs and no more, so the name is centred over its frame whenever it
            fits and borrows the empty side only when it would otherwise clip. A
            flat budget cut "Shared Conversations · 2 of 5" down to
            "Shared Con… 2 o…" on every screen that happened to be live. */}
        <Show
          when={props.editing}
          fallback={
            <span class="col-start-2 flex min-w-0 items-baseline justify-center gap-1">
              <strong
                class="min-w-0 cursor-grab truncate text-body font-medium tracking-[-0.01em] text-[var(--text-strong)] active:cursor-grabbing"
                data-tip={`${props.title} · drag to move · double-click to rename`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onSelect(event);
                }}
                onDblClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onRename();
                }}
              >
                {props.title}
              </strong>
              {/* Six frames called "Appearance" are six of the same object until
                  each one says how it differs. Quiet enough that a map with no
                  repeated names looks exactly as it did. It holds its ground
                  against a long name — an ordinal that truncates to "2 o…" is
                  the one piece of the label that cannot afford to be cut — but
                  never takes more than its share of the line. */}
              {/* Capped in characters, not in percent. A percentage resolved
                  against this flex line, so the shorter the name the less the
                  ordinal was allowed — "Ask · 1 of 6" lost its ordinal to
                  "1 o…" while "Shared Conversations · 2 of 5" kept all of it,
                  which is exactly backwards. Character units give "1 of 6" the
                  same room whatever it sits next to, and still stop a long
                  "from Shared Conversations" from taking the whole line. */}
              <Show when={props.qualifier}>
                {(qualifier) => (
                  <span
                    class="max-w-[14ch] shrink-0 truncate text-micro font-normal text-[var(--text-weak)]"
                    data-tip={qualifier()}
                  >
                    {qualifier()}
                  </span>
                )}
              </Show>
            </span>
          }
        >
          <input
            ref={(element) => (titleInput = element)}
            class="col-span-3 box-border h-6 min-w-0 w-full rounded-md border border-[var(--text-interactive-base)] bg-[var(--map-control-surface)] px-1.5 text-center text-caption/[1.4625] font-medium tracking-[-0.01em] text-[var(--text-strong)] outline-none shadow-[0_0_0_1px_var(--text-interactive-base)]"
            aria-label="Screen name"
            data-focus-contained
            value={props.title}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => props.onCommitRename(event.currentTarget.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                event.preventDefault();
                props.onCommitRename(props.title);
              }
            }}
          />
        </Show>
        <Show when={!props.editing && props.connectionOrigin}>
          <span
            class="absolute left-[calc(100%+4px)] shrink-0 whitespace-nowrap rounded-md bg-[color-mix(in_srgb,var(--text-interactive-base)_16%,transparent)] px-1.5 py-0.5 text-micro font-semibold text-[var(--text-interactive-base)]"
            data-tip="Selected path starts on this screen"
          >
            Origin
          </span>
        </Show>
        <Show when={!props.editing && !props.connectionOrigin && props.here}>
          <span class="col-start-1 row-start-1 inline-flex items-center justify-self-start gap-1 whitespace-nowrap rounded-md bg-[color-mix(in_srgb,var(--icon-success-base)_16%,transparent)] px-1.5 py-0.5 text-micro font-semibold text-[var(--icon-success-base)]">
            <i class="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
            Here
          </span>
        </Show>
        <Show when={showsStart()}>
          <span class="col-start-1 row-start-1 justify-self-start whitespace-nowrap rounded-md bg-[var(--product-accent-soft)] px-1.5 py-0.5 text-micro font-medium text-[var(--text-interactive-base)]">
            Start
          </span>
        </Show>
        <Show when={showsRunStatus()}>
          <span
            class={cn(
              "col-start-3 row-start-1 inline-flex items-center justify-self-end gap-1 whitespace-nowrap text-micro font-medium capitalize",
              props.runState === "failed"
                ? "text-[var(--icon-critical-base)]"
                : props.runState === "running"
                  ? "text-[var(--text-interactive-base)]"
                  : props.runState === "healed"
                    ? "text-[var(--icon-warning-base)]"
                    : "text-[var(--icon-success-base)]",
            )}
          >
            <i class="size-1.5 rounded-full bg-current" />
            {props.runState}
          </span>
        </Show>
      </header>
      <Show
        when={visibleSrc()}
        fallback={
          <div
            data-screen-frame
            class={cn(
              "grid min-h-0 place-items-center overflow-hidden rounded-xl bg-[var(--map-canvas-backdrop)] text-center shadow-[var(--map-elevation-card)] transition-[box-shadow,transform] duration-hover",
              frameStateClass(),
            )}
            style={{
              width: `${props.geometry.frameWidth}px`,
              "justify-self": "center",
            }}
          >
            <EmptyScreenshot size="compact" />
          </div>
        }
      >
        {(src) => (
          <div
            data-screen-frame
            class="min-h-0 overflow-hidden rounded-xl bg-[var(--map-canvas-backdrop)] shadow-[var(--map-elevation-card)] transition-[box-shadow,transform] duration-hover"
          >
            <div
              class="relative mx-auto min-h-0"
              style={{
                width: `${props.geometry.mediaWidth}px`,
                height: `${props.geometry.mediaHeight}px`,
              }}
            >
              <OrientedScreenshot
                src={src()}
                alt={`Recorded ${props.title} screen`}
                loading="lazy"
                class="size-full object-contain object-top"
                evidence={props.orientationEvidence}
                onNaturalSize={props.onNaturalSize}
                onError={() => setImageFailed(true)}
                onRotationChange={props.onRotationChange}
                overlay={
                  props.selectedConnectionOrigin
                    ? ({ rotation }) => {
                        const anchor = props.selectedConnectionOrigin!;
                        const point = companionLogicalPointToDisplayed(anchor.point, rotation);
                        const rect = anchor.rect
                          ? companionLogicalRectToDisplayed(anchor.rect, rotation)
                          : undefined;
                        return (
                          <div
                            class="pointer-events-none absolute inset-0 z-[2]"
                            aria-hidden="true"
                            data-connection-origin-target
                          >
                            <Show when={rect}>
                              {(value) => (
                                <div
                                  class="absolute rounded border-2 border-[var(--text-interactive-base)] bg-[color-mix(in_srgb,var(--text-interactive-base)_18%,transparent)]"
                                  style={{
                                    left: `${value().x * 100}%`,
                                    top: `${value().y * 100}%`,
                                    width: `${value().width * 100}%`,
                                    height: `${value().height * 100}%`,
                                  }}
                                />
                              )}
                            </Show>
                            <span
                              class="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--background-base)] bg-[var(--text-interactive-base)] shadow-[var(--map-elevation-chip)]"
                              style={{
                                left: `${point.x * 100}%`,
                                top: `${point.y * 100}%`,
                              }}
                            />
                          </div>
                        );
                      }
                    : undefined
                }
              />
            </div>
          </div>
        )}
      </Show>
    </article>
  );
}
