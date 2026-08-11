import { For, Show, createEffect, createSignal, on } from "solid-js";
import type { CanvasNote } from "@relay/protocol";
import { IconButton } from "@relay/ui/icon-button";
import type { MapTreeNode } from "../lib/app-map-tree";
import { cn } from "../lib/cn";
import type { AppMapRunPresentationState } from "../lib/app-map-run-projection";
import type { CanvasCombineSection } from "../lib/app-map-combine-canvas";
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
      class="absolute w-[220px] overflow-hidden rounded-[12px] border border-[color-mix(in_srgb,var(--border-strong-base)_74%,transparent)] bg-[color-mix(in_srgb,var(--surface-base)_96%,var(--product-accent-soft))] shadow-[0_8px_26px_rgb(0_0_0/18%)]"
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
          <span class="text-[10px] font-semibold text-[var(--text-strong)]">Note</span>
        </button>
        <button
          type="button"
          class="relative grid size-8 place-items-center rounded-[7px] text-[var(--text-weak)] before:absolute before:-inset-1 transition-colors hover:bg-[var(--surface-base-hover)] hover:text-[var(--icon-critical-base)]"
          aria-label="Delete note"
          onClick={props.onDelete}
        >
          <Icon name="x" size={11} />
        </button>
      </header>
      <textarea
        class="block min-h-[96px] w-full resize-none bg-transparent px-2.5 py-2 text-[11px]/[1.5] text-[var(--text-base)] outline-none placeholder:text-[var(--text-weak)]"
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

export function CanvasCombineCard(props: {
  id: string;
  name: string;
  position: { x: number; y: number };
  startsAt?: { screenId: string; title: string; position: { x: number; y: number } };
  modifiers: Array<{ id: string; name: string; values: string[] }>;
  tests: string[];
  cellCount: number;
  run?: {
    jobId: string;
    complete: number;
    total: number;
    passed: number;
    problems: number;
    active: number;
  };
  onOpen: (section: CanvasCombineSection) => void;
  onOpenResults?: (jobId: string) => void;
}) {
  const open = (event: MouseEvent, section: CanvasCombineSection) => {
    event.stopPropagation();
    props.onOpen(section);
  };
  const progress = () =>
    props.run?.total ? Math.min(100, (props.run.complete / props.run.total) * 100) : 0;
  const resultLabel = () => {
    const run = props.run;
    if (!run) return `${props.cellCount} ${props.cellCount === 1 ? "run" : "runs"}`;
    if (run.active) return `${run.complete} of ${run.total} complete`;
    if (run.problems) return `${run.problems} need attention`;
    return `${run.passed} passed`;
  };
  return (
    <article
      data-app-map-combine-id={props.id}
      class="group/matrix absolute z-[8] w-[300px] overflow-hidden rounded-[12px] border border-[color-mix(in_srgb,var(--border-strong-base)_64%,transparent)] bg-[var(--surface-raised-stronger-non-alpha)] text-left shadow-[var(--map-elevation-control)] transition-[border-color,box-shadow] duration-150 hover:border-[var(--border-strong-base)] hover:shadow-[0_10px_28px_rgb(0_0_0/14%)]"
      style={{ transform: `translate3d(${props.position.x}px, ${props.position.y}px, 0)` }}
      aria-label={`Edit run matrix ${props.name}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header class="border-b border-[color-mix(in_srgb,var(--border-weak-base)_82%,transparent)]">
        <button
          type="button"
          class="flex min-h-11 w-full items-center gap-2 px-3 text-left hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--border-focus)]"
          onClick={(event) => open(event, "plan")}
        >
          <span class="grid size-7 shrink-0 place-items-center rounded-[7px] bg-[var(--surface-base)] text-[var(--text-base)]">
            <Icon name="grid" size={12} />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-[10px] font-medium text-[var(--text-weak)]">Run matrix</span>
            <strong class="block truncate text-[11.5px] font-semibold text-[var(--text-strong)]">
              {props.name}
            </strong>
          </span>
          <Icon name="chevron-right" size={12} class="shrink-0 text-[var(--text-weaker)]" />
        </button>
      </header>
      <div class="grid grid-cols-[1fr_20px_1fr] items-stretch gap-1.5 px-2 py-2">
        <button
          type="button"
          class="min-h-16 min-w-0 rounded-[8px] px-2 py-1.5 text-left hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
          aria-label="Edit matrix modifiers"
          onClick={(event) => open(event, "modifiers")}
        >
          <span class="block text-[9.5px] font-medium text-[var(--text-weak)]">
            {props.modifiers.length === 1 ? "Modifier" : "Modifiers"}
          </span>
          <For each={props.modifiers}>
            {(modifier) => (
              <div class="mt-1 min-w-0">
                <strong class="block truncate text-[11px] font-medium text-[var(--text-strong)]">
                  {modifier.name}
                </strong>
                <span class="block truncate text-[9.5px] text-[var(--text-weak)]">
                  {modifier.values.join(" · ")}
                </span>
              </div>
            )}
          </For>
        </button>
        <span
          class="grid place-items-center text-[14px] text-[var(--text-weaker)]"
          aria-hidden="true"
        >
          ×
        </span>
        <button
          type="button"
          class="min-h-16 min-w-0 rounded-[8px] px-2 py-1.5 text-left hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
          aria-label="Edit matrix tests"
          onClick={(event) => open(event, "tests")}
        >
          <span class="block text-[9.5px] font-medium text-[var(--text-weak)]">
            {props.tests.length === 1 ? "Test" : "Tests"}
          </span>
          <p class="m-0 mt-1 line-clamp-3 text-[11px]/[1.35] font-medium text-[var(--text-strong)]">
            {props.tests.join(" · ")}
          </p>
        </button>
      </div>
      <button
        type="button"
        class="relative flex min-h-9 w-full items-center justify-between gap-2 overflow-hidden border-t border-[var(--border-weak-base)] px-3 text-left hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--border-focus)]"
        onClick={(event) => {
          event.stopPropagation();
          if (props.run && props.onOpenResults) props.onOpenResults(props.run.jobId);
          else props.onOpen("plan");
        }}
      >
        <Show when={props.run?.active}>
          <span
            class="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-[var(--text-interactive-base)] transition-transform duration-150 motion-reduce:transition-none"
            style={{ transform: `scaleX(${progress() / 100})` }}
            aria-hidden="true"
          />
        </Show>
        <span class="min-w-0 truncate text-[10px] text-[var(--text-weak)]">
          {props.run?.active
            ? "Running now"
            : props.run
              ? "View results"
              : props.startsAt
                ? `Starts at ${props.startsAt.title}`
                : "Reusable tests"}
        </span>
        <span
          class={cn(
            "shrink-0 text-[10px] font-medium tabular-nums",
            props.run?.problems
              ? "text-[var(--icon-critical-base)]"
              : props.run && !props.run.active
                ? "text-[var(--icon-success-base)]"
                : "text-[var(--text-base)]",
          )}
        >
          {resultLabel()}
        </span>
      </button>
    </article>
  );
}

export function ScreenCard(props: {
  node: MapTreeNode;
  isFlowStart: boolean;
  title: string;
  selected: boolean;
  editing: boolean;
  runState?: AppMapRunPresentationState;
  position: { x: number; y: number };
  geometry: ScreenCardGeometry;
  src: () => string;
  orientationEvidence?: ScreenshotOrientationEvidence;
  /** The selected recorded connection's source target, if one exists. */
  sourceAnchor?: CanvasInteractionAnchor;
  onRotationChange?: (rotation: ScreenshotRotation) => void;
  onNaturalSize?: (size: { width: number; height: number }) => void;
  showActions?: boolean;
  onSelect: (event?: MouseEvent) => void;
  onContextMenu: (event: MouseEvent) => void;
  onRename: () => void;
  onOpenDetails: () => void;
  onRun?: () => void;
  onCommitRename: (title: string) => void;
  onPointerDown: (event: PointerEvent & { currentTarget: HTMLElement }) => void;
  /** Live device is on this mapped screen. Distinct from selected. */
  here?: boolean;
}) {
  const [imageFailed, setImageFailed] = createSignal(false);
  createEffect(on(props.src, () => setImageFailed(false)));
  const visibleSrc = () => (props.src() && !imageFailed() ? props.src() : "");
  const frameStateClass = () =>
    props.runState === "failed"
      ? "ring-2 ring-[var(--icon-critical-base)]"
      : props.runState === "running"
        ? "ring-2 ring-[var(--text-interactive-base)]"
        : props.runState === "healed"
          ? "ring-2 ring-[var(--icon-warning-base)]"
          : props.runState === "passed"
            ? "ring-2 ring-[var(--icon-success-base)]"
            : props.selected
              ? "ring-2 ring-[var(--text-interactive-base)] shadow-[0_8px_20px_rgb(0_0_0/8%)]"
              : props.here
                ? "ring-2 ring-[var(--icon-success-base)] shadow-[0_8px_20px_rgb(0_0_0/8%)]"
                : "ring-1 ring-[color-mix(in_srgb,var(--border-strong-base)_55%,transparent)] group-hover/screen:ring-[var(--border-strong-base)] group-hover/screen:shadow-[0_8px_20px_rgb(0_0_0/7%)]";
  return (
    <article
      role="group"
      aria-roledescription="screen"
      tabIndex={0}
      aria-label={`${props.title} screen${props.here ? ", here" : ""}${props.selected ? ", selected" : ""}`}
      data-app-map-screen-id={props.node.id}
      data-app-map-here={props.here ? "true" : undefined}
      data-tip="Click to inspect · Enter opens details"
      class={cn(
        "group/screen absolute grid w-[240px] grid-rows-[24px_var(--screen-frame-height)] gap-[6px] overflow-visible text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--map-canvas)]",
        (props.selected || props.here) && "z-20",
      )}
      style={{
        transform: `translate3d(${props.position.x}px, ${props.position.y}px, 0)`,
        height: `${props.geometry.height}px`,
        "--screen-frame-height": `${props.geometry.frameHeight}px`,
      }}
      onClick={props.onSelect}
      onContextMenu={props.onContextMenu}
      onKeyDown={(event) => {
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
          aria-label={`${props.title} screen actions`}
          data-app-map-screen-actions
          class="absolute top-[30px] z-30 flex items-center gap-0.5 rounded-[9px] border border-[color-mix(in_srgb,var(--border-strong-base)_42%,transparent)] bg-[var(--map-control-surface)] p-[3px] shadow-[0_4px_14px_rgb(0_0_0/10%)]"
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
        class="relative flex min-w-0 items-center justify-center gap-1.5 px-0.5"
        style={{
          width: `${props.geometry.frameWidth}px`,
          "justify-self": "center",
        }}
        data-tip="Click to inspect · Enter opens details"
      >
        <Show
          when={props.editing}
          fallback={
            <strong
              class="min-w-0 max-w-full truncate text-center text-[12px] font-medium tracking-[-0.01em] text-[var(--text-strong)]"
              data-tip="Double-click to rename · F2"
              onPointerDown={(event) => event.stopPropagation()}
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
          }
        >
          <input
            class="min-w-0 w-full rounded-[6px] bg-[var(--map-control-surface)] px-1.5 py-1 text-center text-[13px] font-medium text-[var(--text-strong)] outline-none ring-2 ring-[var(--text-interactive-base)]"
            aria-label="Screen name"
            value={props.title}
            autofocus
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
        <Show when={!props.editing && props.here}>
          <span class="absolute left-0 inline-flex shrink-0 items-center gap-1 rounded-[5px] bg-[color-mix(in_srgb,var(--icon-success-base)_16%,transparent)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--icon-success-base)]">
            <i class="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
            Here
          </span>
        </Show>
        <Show
          when={
            !props.editing &&
            !props.here &&
            screenCardStartMarkerVisible(props.title, props.isFlowStart)
          }
        >
          <span class="absolute left-0 shrink-0 rounded-[5px] bg-[var(--product-accent-soft)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--text-interactive-base)]">
            Start
          </span>
        </Show>
        <Show when={!props.editing && props.runState && props.runState !== "idle"}>
          <span
            class={cn(
              "absolute right-0 inline-flex shrink-0 items-center gap-1 text-[9px] font-medium capitalize",
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
              "grid min-h-0 place-items-center overflow-hidden rounded-[9px] bg-[var(--background-base)] text-center transition-[box-shadow,transform] duration-150",
              frameStateClass(),
            )}
            style={{
              width: `${props.geometry.frameWidth}px`,
              "justify-self": "center",
            }}
          >
            <div class="grid max-w-[168px] justify-items-center gap-2 text-[var(--text-weak)] transition-colors duration-150 group-hover/screen:text-[var(--text-base)]">
              <span class="grid size-8 place-items-center rounded-[9px] bg-[var(--surface-base-hover)]">
                <Icon name="camera" size={14} />
              </span>
              <span class="text-[10.5px] font-medium text-[var(--text-base)]">No screenshot</span>
            </div>
          </div>
        }
      >
        {(src) => (
          <div
            data-screen-frame
            class={cn(
              "min-h-0 overflow-hidden rounded-[9px] bg-[oklch(0.12_0.01_270)] transition-[box-shadow,transform] duration-150",
              frameStateClass(),
            )}
            style={{
              width: `${props.geometry.frameWidth}px`,
              "justify-self": "center",
            }}
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
                  props.sourceAnchor
                    ? ({ rotation }) => {
                        const anchor = props.sourceAnchor!;
                        const point = companionLogicalPointToDisplayed(anchor.point, rotation);
                        const rect = anchor.rect
                          ? companionLogicalRectToDisplayed(anchor.rect, rotation)
                          : undefined;
                        return (
                          <div
                            class="pointer-events-none absolute inset-0 z-[2]"
                            aria-label="Recorded step target"
                            data-recorded-map-target
                          >
                            <Show when={rect}>
                              {(value) => (
                                <div
                                  class="absolute rounded-[3px] border-2 border-[var(--text-interactive-base)] bg-[color-mix(in_srgb,var(--text-interactive-base)_20%,transparent)] shadow-[0_0_0_1px_rgb(255_255_255/16%),0_0_10px_color-mix(in_srgb,var(--text-interactive-base)_32%,transparent)]"
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
                              class="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--background-base)] bg-[var(--text-interactive-base)] shadow-[0_1px_4px_rgb(0_0_0/28%)]"
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
