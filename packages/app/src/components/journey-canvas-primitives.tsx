import { For, Show, createSignal } from "solid-js";
import type { JourneyCanvasNote } from "@relay/protocol";
import type { RecipeStep } from "../context/server";
import type { CanvasConnection } from "../lib/journey-prototype";
import type { JourneyTreeNode } from "../lib/journey-tree";
import { cn } from "../lib/cn";
import { accentForStep, iconForStep } from "./journey-step-presentation";
import { Icon } from "./icon";

/** Presentation-only canvas objects. They deliberately receive callbacks
 * instead of knowing about the graph document or recorder state. */
export function CanvasNote(props: {
  note: JourneyCanvasNote;
  onPointerDown: (event: PointerEvent & { currentTarget: HTMLButtonElement }) => void;
  onText: (text: string) => void;
  onCommit: () => void;
  onDelete: () => void;
}) {
  return (
    <article
      class="absolute w-[220px] overflow-hidden rounded-[12px] border border-[color-mix(in_srgb,var(--v2-border-border-strong)_74%,transparent)] bg-[color-mix(in_srgb,var(--v2-background-bg-layer-01)_96%,var(--product-accent-soft))] shadow-[0_8px_26px_rgb(0_0_0/18%)]"
      style={{ transform: `translate3d(${props.note.x}px, ${props.note.y}px, 0)` }}
    >
      <header class="flex h-8 items-center justify-between border-b border-[color-mix(in_srgb,var(--v2-border-border-muted)_82%,transparent)] px-1">
        <button
          type="button"
          class="flex h-full min-w-0 flex-1 cursor-grab items-center gap-1.5 px-1.5 text-left active:cursor-grabbing"
          onPointerDown={props.onPointerDown}
        >
          <Icon name="edit" size={11} class="text-[var(--text-interactive-base)]" />
          <span class="text-[10px] font-semibold text-[var(--text-strong)]">Note</span>
          <span class="text-[9px] text-[var(--text-weak)]">drag</span>
        </button>
        <button
          type="button"
          class="grid size-6 place-items-center rounded-[6px] text-[var(--text-weak)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--icon-critical-base)]"
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
        onInput={(event) => props.onText(event.currentTarget.value.slice(0, 480))}
        onBlur={props.onCommit}
      />
    </article>
  );
}

export function ScreenCard(props: {
  node: JourneyTreeNode;
  step: RecipeStep | undefined;
  isFlowStart: boolean;
  title: string;
  selected: boolean;
  editing: boolean;
  position: { x: number; y: number };
  src: () => string;
  onSelect: () => void;
  onRename: () => void;
  onCommitRename: (title: string) => void;
  onRecord: () => void;
  onConnectStart: (event: PointerEvent) => void;
  onPointerDown: (event: PointerEvent & { currentTarget: HTMLElement }) => void;
}) {
  return (
    <article
      role="button"
      tabIndex={0}
      data-journey-screen-id={props.node.id}
      class={cn(
        "absolute grid h-[248px] w-[196px] grid-rows-[34px_minmax(0,1fr)_30px] overflow-visible rounded-[14px] border bg-[var(--v2-background-bg-base)] text-left shadow-[0_8px_28px_rgb(0_0_0/20%)] transition-[border-color,box-shadow] duration-150",
        props.selected
          ? "border-[var(--text-interactive-base)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--v2-background-bg-accent)_20%,transparent),0_8px_28px_rgb(0_0_0/24%)]"
          : "border-[var(--v2-border-border-muted)] hover:border-[var(--v2-border-border-strong)]",
      )}
      style={{ transform: `translate3d(${props.position.x}px, ${props.position.y}px, 0)` }}
      onClick={props.onSelect}
      onDblClick={(event) => {
        event.stopPropagation();
        props.onRename();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect();
        }
      }}
      onPointerDown={props.onPointerDown}
    >
      <header class="flex min-w-0 items-center gap-2 border-b border-[var(--v2-border-border-muted)] px-2.5">
        <span
          class="grid size-[17px] shrink-0 place-items-center rounded-[5px] text-white"
          style={{
            background: props.step ? accentForStep(props.step) : "var(--text-interactive-base)",
          }}
        >
          <Icon name={props.step ? iconForStep(props.step) : "play"} size={9} />
        </span>
        <Show
          when={props.editing}
          fallback={
            <strong class="min-w-0 truncate text-[11px] font-semibold text-[var(--text-strong)]">
              {props.title}
            </strong>
          }
        >
          <input
            class="min-w-0 flex-1 rounded-[4px] bg-[var(--v2-background-bg-layer-02)] px-1 py-0.5 text-[11px] font-semibold text-[var(--text-strong)] outline-none ring-1 ring-[var(--text-interactive-base)]"
            aria-label="Screen name"
            value={props.title}
            autofocus
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => props.onCommitRename(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                event.preventDefault();
                props.onCommitRename(props.title);
              }
            }}
          />
        </Show>
      </header>
      <Show
        when={props.src()}
        fallback={
          <div class="grid place-items-center bg-[radial-gradient(circle_at_50%_35%,color-mix(in_srgb,var(--v2-background-bg-accent)_14%,transparent),transparent_44%),var(--v2-background-bg-deep)] px-5 text-center">
            <div class="grid justify-items-center gap-2">
              <span class="grid size-9 place-items-center rounded-[10px] bg-[var(--v2-background-bg-layer-02)] text-[var(--text-interactive-base)] shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
                <Icon name={props.step ? iconForStep(props.step) : "play"} size={17} />
              </span>
              <Show when={props.isFlowStart}>
                <span class="text-[10px] font-medium text-[var(--text-base)]">
                  Flow starts here
                </span>
              </Show>
            </div>
          </div>
        }
      >
        {(src) => (
          <div class="min-h-0 overflow-hidden bg-[#080a0f] p-1.5">
            <img
              src={src()}
              alt={`Recorded ${props.title} screen`}
              draggable={false}
              class="size-full rounded-[9px] object-contain object-top"
            />
          </div>
        )}
      </Show>
      <footer class="flex items-center justify-between px-2.5 text-[9.5px] text-[var(--text-weak)]">
        <span>
          {props.isFlowStart && !props.node.stepIndexes.length
            ? "Entry point"
            : `${props.node.stepIndexes.length} ${props.node.stepIndexes.length === 1 ? "connection" : "connections"}`}
        </span>
        <span class="flex items-center">
          <button
            type="button"
            class="rounded-[5px] px-1 py-0.5 font-medium text-[var(--text-interactive-base)] transition-colors hover:bg-[var(--product-accent-soft)]"
            aria-label={`Record a route from ${props.title}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              props.onRecord();
            }}
          >
            Record
          </button>
        </span>
      </footer>
      <button
        type="button"
        class="group absolute top-1/2 right-[-17px] z-10 grid size-8 -translate-y-1/2 cursor-crosshair place-items-center rounded-full outline-none"
        aria-label={`Connect ${props.title} to another screen`}
        title="Drag to connect"
        onPointerDown={props.onConnectStart}
        onClick={(event) => event.stopPropagation()}
      >
        <span class="grid size-[22px] place-items-center rounded-full border border-[var(--text-interactive-base)] bg-[var(--v2-background-bg-base)] text-[var(--text-interactive-base)] shadow-[0_3px_12px_rgb(0_0_0/28%)] transition-[background-color,transform] duration-150 group-hover:scale-110 group-hover:bg-[var(--product-accent-soft)] group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-[var(--border-strong-focus)]">
          <Icon name="arrow-right" size={11} />
        </span>
      </button>
    </article>
  );
}

export function ScreenInspector(props: {
  node: JourneyTreeNode | null;
  title: string;
  connections: CanvasConnection[];
  onSelectConnection: (connection: CanvasConnection) => void;
  onRecord: () => void;
}) {
  return (
    <Show when={props.node}>
      {(_node) => (
        <aside class="absolute top-[62px] right-4 z-20 w-[min(272px,calc(100%-32px))] rounded-[12px] border border-[var(--v2-border-border-muted)] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_94%,transparent)] p-2 shadow-[0_8px_30px_rgb(0_0_0/18%)] backdrop-blur-[12px]">
          <div class="flex items-start justify-between gap-3 px-1.5 pt-0.5">
            <div>
              <span class="block text-[9.5px] font-semibold tracking-[0.12em] text-[var(--text-weak)]">
                SCREEN
              </span>
              <strong class="mt-1 block text-[11.5px] font-semibold text-[var(--text-strong)]">
                {props.title}
              </strong>
            </div>
            <button
              type="button"
              class="inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-[var(--product-accent-soft)] px-2.5 text-[10.5px] font-semibold text-[var(--text-interactive-base)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_18%,transparent)] active:scale-[0.97]"
              onClick={props.onRecord}
            >
              <Icon name="smartphone" size={11} /> Record from here
            </button>
          </div>
          <div class="mt-2 grid gap-0.5 border-t border-[var(--v2-border-border-muted)] pt-1.5">
            <span class="px-1.5 pb-0.5 text-[9.5px] font-semibold tracking-[0.11em] text-[var(--text-weak)]">
              OUTGOING
            </span>
            <Show
              when={props.connections.length}
              fallback={
                <p class="m-0 px-1.5 py-2 text-[10px]/[1.4] text-[var(--text-weak)]">
                  No routes yet. Record an interaction, or drag the arrow on the screen card to
                  sketch one.
                </p>
              }
            >
              <For each={props.connections}>
                {(connection) => (
                  <button
                    type="button"
                    class="flex min-h-8 items-center gap-2 rounded-[7px] px-1.5 text-left text-[10.5px] text-[var(--text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                    onClick={() => props.onSelectConnection(connection)}
                  >
                    <span
                      class={cn(
                        "grid size-5 shrink-0 place-items-center rounded-[5px]",
                        connection.state === "needs-recording"
                          ? "bg-[color-mix(in_srgb,var(--icon-warning-base)_16%,transparent)] text-[var(--icon-warning-base)]"
                          : "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
                      )}
                    >
                      <Icon
                        name={connection.state === "needs-recording" ? "clock" : "arrow-right"}
                        size={10}
                      />
                    </span>
                    <span class="min-w-0 flex-1 truncate">
                      {connection.label ||
                        (connection.state === "needs-recording"
                          ? "Record interaction"
                          : "Recorded interaction")}
                    </span>
                    <Icon name="arrow-right" size={11} class="text-[var(--text-weak)]" />
                  </button>
                )}
              </For>
            </Show>
          </div>
        </aside>
      )}
    </Show>
  );
}

export function ConnectionInspector(props: {
  connection: CanvasConnection;
  sourceTitle: string;
  targetTitle: string;
  setup: {
    captures: Array<{
      id: string;
      label: string;
      actionCount: number;
      hasVideo: boolean;
    }>;
    behaviors: Array<{ id: string; label: string; actionCount: number }>;
    onRecord: () => void;
    onBack: () => void;
    onAutomatic: () => void;
    onAttachCapture: (takeId: string) => void;
    onAttachBehavior: (recipeId: string) => void;
  };
  replay: {
    state: "idle" | "running" | "passed" | "failed";
    error?: string;
    onRun: () => void;
    onRewrite: () => void;
    onSaveReusable: () => void;
    onSelectStep: () => void;
  };
  onRemove: () => void;
}) {
  const pending = () => props.connection.state === "needs-recording";
  const [optionsOpen, setOptionsOpen] = createSignal(false);
  const actionCount = () => props.connection.stepIds.length;
  const verified = () => props.connection.review?.status === "verified";
  const failed = () => props.connection.review?.status === "failed";
  const statusLabel = () =>
    pending() ? "Planned" : verified() ? "Verified" : failed() ? "Needs attention" : "Captured";
  const modeLabel = () =>
    props.connection.mode === "automatic"
      ? "Automatic"
      : props.connection.mode === "reusable"
        ? "Reusable"
        : "Device interaction";
  return (
    <aside class="absolute top-[62px] right-4 z-20 w-[min(292px,calc(100%-32px))] rounded-[12px] border border-[var(--v2-border-border-muted)] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_94%,transparent)] p-3 shadow-[0_8px_30px_rgb(0_0_0/18%)] backdrop-blur-[12px]">
      <div class="flex items-center justify-between gap-3">
        <span class="text-[9.5px] font-semibold tracking-[0.12em] text-[var(--text-weak)]">
          TRANSITION
        </span>
        <span
          class={cn(
            "rounded-full px-2 py-0.5 text-[9px] font-medium",
            pending()
              ? "bg-[color-mix(in_srgb,var(--icon-warning-base)_14%,transparent)] text-[var(--icon-warning-base)]"
              : verified()
                ? "bg-[color-mix(in_srgb,var(--icon-success-base)_14%,transparent)] text-[var(--icon-success-base)]"
                : failed()
                  ? "bg-[color-mix(in_srgb,var(--icon-critical-base)_12%,transparent)] text-[var(--icon-critical-base)]"
                  : "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
          )}
        >
          {statusLabel()}
        </span>
      </div>
      <strong class="mt-1.5 block text-[12px] text-[var(--text-strong)]">
        {props.sourceTitle} <span class="text-[var(--text-weak)]">→</span> {props.targetTitle}
      </strong>
      <p class="m-0 mt-1 text-[10px]/[1.45] text-[var(--text-weak)]">
        {pending()
          ? "Choose what should move the device to the next screen. You can record it or start with a simple behavior."
          : `${modeLabel()} · ${actionCount()} action${actionCount() === 1 ? "" : "s"}${props.connection.videoTakeId ? " · video" : ""}${props.connection.videoClip ? " · trimmed" : ""}`}
      </p>
      <Show
        when={pending()}
        fallback={
          <div class="mt-3 grid gap-2">
            <Show when={props.replay.state === "failed" || failed()}>
              <div class="rounded-[8px] border border-[color-mix(in_srgb,var(--icon-critical-base)_28%,transparent)] bg-[color-mix(in_srgb,var(--icon-critical-base)_7%,transparent)] px-2.5 py-2 text-[9.5px]/[1.4] text-[var(--text-base)]">
                {props.replay.error ||
                  props.connection.review?.error ||
                  "The last replay did not reach the next screen."}
              </div>
            </Show>
            <button
              type="button"
              class="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] bg-[var(--product-accent-soft)] px-3 text-[10.5px] font-semibold text-[var(--text-interactive-base)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_18%,transparent)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
              disabled={props.replay.state === "running"}
              onClick={props.replay.onRun}
            >
              <Icon
                name={
                  props.replay.state === "running" ? "refresh" : verified() ? "refresh" : "play"
                }
                size={11}
                class={
                  props.replay.state === "running" ? "animate-spin motion-reduce:animate-none" : ""
                }
              />
              {props.replay.state === "running"
                ? "Replaying on device…"
                : verified()
                  ? "Replay again"
                  : "Replay and verify"}
            </button>
            <div class="flex flex-wrap items-center gap-1">
              <button
                type="button"
                class="inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[10px] font-medium text-[var(--text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                onClick={props.replay.onSelectStep}
              >
                <Icon name="arrow-right" size={10} /> Actions
              </button>
              <button
                type="button"
                class="inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[10px] font-medium text-[var(--text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                onClick={props.replay.onRewrite}
              >
                <Icon name="refresh" size={10} /> Record again
              </button>
              <button
                type="button"
                class="inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[10px] font-medium text-[var(--text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                onClick={props.replay.onSaveReusable}
              >
                <Icon name="copy" size={10} /> Save behavior
              </button>
              <Show when={props.connection.source === "authored"}>
                <button
                  type="button"
                  class="ml-auto grid size-7 place-items-center rounded-[7px] text-[var(--text-weak)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--icon-critical-base)]"
                  aria-label="Remove transition"
                  title="Remove transition"
                  onClick={props.onRemove}
                >
                  <Icon name="trash" size={11} />
                </button>
              </Show>
            </div>
          </div>
        }
      >
        <div class="mt-3 grid gap-2">
          <button
            type="button"
            class="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] bg-[var(--product-accent-soft)] px-3 text-[10.5px] font-semibold text-[var(--text-interactive-base)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_18%,transparent)] active:scale-[0.98]"
            onClick={props.setup.onRecord}
          >
            <Icon name="smartphone" size={11} /> Record on device
          </button>
          <button
            type="button"
            class="inline-flex h-8 items-center justify-center gap-1.5 rounded-[7px] text-[10px] font-medium text-[var(--text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
            aria-expanded={optionsOpen()}
            onClick={() => setOptionsOpen((open) => !open)}
          >
            <Icon name="plus" size={10} /> More ways to continue
            <Icon name={optionsOpen() ? "chevron-up" : "chevron-down"} size={10} />
          </button>
          <Show when={optionsOpen()}>
            <div class="grid gap-1 border-t border-[var(--v2-border-border-muted)] pt-2">
              <button
                type="button"
                class="flex min-h-9 items-center gap-2 rounded-[7px] px-2 text-left text-[10.5px] transition-colors hover:bg-[var(--v2-background-bg-layer-02)]"
                onClick={props.setup.onBack}
              >
                <span class="grid size-6 shrink-0 place-items-center rounded-[6px] bg-[var(--v2-background-bg-layer-02)] text-[var(--text-interactive-base)]">
                  <Icon name="undo" size={11} />
                </span>
                <span>
                  <strong class="block font-medium text-[var(--text-strong)]">Back button</strong>
                  <span class="text-[9.5px] text-[var(--text-weak)]">
                    Go to the previous screen
                  </span>
                </span>
              </button>
              <button
                type="button"
                class="flex min-h-9 items-center gap-2 rounded-[7px] px-2 text-left text-[10.5px] transition-colors hover:bg-[var(--v2-background-bg-layer-02)]"
                onClick={props.setup.onAutomatic}
              >
                <span class="grid size-6 shrink-0 place-items-center rounded-[6px] bg-[var(--v2-background-bg-layer-02)] text-[var(--text-interactive-base)]">
                  <Icon name="clock" size={11} />
                </span>
                <span>
                  <strong class="block font-medium text-[var(--text-strong)]">No action</strong>
                  <span class="text-[9.5px] text-[var(--text-weak)]">
                    Wait briefly for the next screen
                  </span>
                </span>
              </button>
              <Show when={props.setup.behaviors.length > 0}>
                <span class="px-2 pt-1 text-[9px] font-semibold tracking-[0.1em] text-[var(--text-weak)] uppercase">
                  Saved behaviors
                </span>
                <For each={props.setup.behaviors}>
                  {(behavior) => (
                    <button
                      type="button"
                      class="flex min-h-9 items-center gap-2 rounded-[7px] px-2 text-left text-[10.5px] transition-colors hover:bg-[var(--v2-background-bg-layer-02)]"
                      onClick={() => props.setup.onAttachBehavior(behavior.id)}
                    >
                      <span class="grid size-6 shrink-0 place-items-center rounded-[6px] bg-[var(--v2-background-bg-layer-02)] text-[var(--text-interactive-base)]">
                        <Icon name="copy" size={11} />
                      </span>
                      <span class="min-w-0 flex-1">
                        <strong class="block truncate font-medium text-[var(--text-strong)]">
                          {behavior.label}
                        </strong>
                        <span class="text-[9.5px] text-[var(--text-weak)]">
                          {behavior.actionCount} action{behavior.actionCount === 1 ? "" : "s"}
                        </span>
                      </span>
                    </button>
                  )}
                </For>
              </Show>
              <Show when={props.setup.captures.length > 0}>
                <span class="px-2 pt-1 text-[9px] font-semibold tracking-[0.1em] text-[var(--text-weak)] uppercase">
                  Recent captures
                </span>
                <For each={props.setup.captures}>
                  {(capture) => (
                    <button
                      type="button"
                      class="flex min-h-9 items-center gap-2 rounded-[7px] px-2 text-left text-[10.5px] transition-colors hover:bg-[var(--v2-background-bg-layer-02)]"
                      onClick={() => props.setup.onAttachCapture(capture.id)}
                    >
                      <span class="grid size-6 shrink-0 place-items-center rounded-[6px] bg-[var(--v2-background-bg-layer-02)] text-[var(--text-interactive-base)]">
                        <Icon name={capture.hasVideo ? "video" : "pointer"} size={11} />
                      </span>
                      <span class="min-w-0 flex-1">
                        <strong class="block truncate font-medium text-[var(--text-strong)]">
                          {capture.label}
                        </strong>
                        <span class="text-[9.5px] text-[var(--text-weak)]">
                          {capture.actionCount} action{capture.actionCount === 1 ? "" : "s"}
                          {capture.hasVideo ? " · video" : ""}
                        </span>
                      </span>
                    </button>
                  )}
                </For>
              </Show>
              <Show when={props.connection.source === "authored"}>
                <button
                  type="button"
                  class="mt-1 inline-flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-[10px] text-[var(--text-weak)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--icon-critical-base)]"
                  onClick={props.onRemove}
                >
                  <Icon name="trash" size={10} /> Remove transition
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </aside>
  );
}
