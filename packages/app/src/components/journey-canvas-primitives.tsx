import { For, Show, createEffect, createSignal } from "solid-js";
import type { JourneyCanvasNote } from "@relay/protocol";
import type { RecipeStep } from "../context/server";
import type { CanvasConnection } from "../lib/journey-prototype";
import type { JourneyTreeNode } from "../lib/journey-tree";
import { cn } from "../lib/cn";
import type { JourneyRunPresentationState } from "../lib/journey-run-projection";
import { accentForStep, iconForStep } from "./journey-step-presentation";
import { Icon } from "./icon";
import { ConnectionCaseStack, type ConnectionCaseStackProps } from "./connection-case-stack";

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
          class="relative grid size-8 place-items-center rounded-[7px] text-[var(--text-weak)] before:absolute before:-inset-1 transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--icon-critical-base)]"
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
  outgoingCount: number;
  title: string;
  selected: boolean;
  editing: boolean;
  runState?: JourneyRunPresentationState;
  position: { x: number; y: number };
  src: () => string;
  onSelect: () => void;
  onRename: () => void;
  onCommitRename: (title: string) => void;
  onConnectStart: (event: PointerEvent) => void;
  onConnectKeyboard: () => void;
  onPointerDown: (event: PointerEvent & { currentTarget: HTMLElement }) => void;
}) {
  return (
    <article
      tabIndex={0}
      aria-label={`${props.title} screen${props.selected ? ", selected" : ""}`}
      data-journey-screen-id={props.node.id}
      class={cn(
        "group/screen absolute flex h-[272px] w-[208px] flex-col gap-2 overflow-visible rounded-[18px] p-1 text-left outline-none transition-[transform,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-[var(--border-strong-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--map-canvas)]",
        props.runState === "failed"
          ? "shadow-[0_0_0_2px_color-mix(in_srgb,var(--icon-critical-base)_72%,transparent)]"
          : props.runState === "running"
            ? "shadow-[0_0_0_2px_var(--text-interactive-base)]"
            : props.runState === "healed"
              ? "shadow-[0_0_0_2px_var(--icon-warning-base)]"
              : props.runState === "passed"
                ? "shadow-[0_0_0_2px_var(--icon-success-base)]"
                : props.selected
                  ? "shadow-[0_0_0_2px_var(--text-interactive-base)]"
                  : "hover:bg-[color-mix(in_oklch,var(--map-control-surface)_46%,transparent)]",
      )}
      style={{ transform: `translate3d(${props.position.x}px, ${props.position.y}px, 0)` }}
      onClick={props.onSelect}
      onKeyDown={(event) => {
        if (event.key === "F2") {
          event.preventDefault();
          props.onRename();
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect();
        }
      }}
      onPointerDown={props.onPointerDown}
    >
      <Show when={props.selected && !props.editing}>
        <div class="absolute bottom-[calc(100%+10px)] left-1/2 z-30 flex min-h-10 -translate-x-1/2 items-center gap-1 rounded-[11px] bg-[var(--map-control-surface)] p-1 shadow-[var(--map-elevation-panel)]">
          <button
            type="button"
            class="app-map-icon-button"
            aria-label={`Rename ${props.title}`}
            data-tip="Rename · F2"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              props.onRename();
            }}
          >
            <Icon name="edit" size={13} />
          </button>
          <button
            type="button"
            class="app-map-icon-button"
            aria-label={`Connect from ${props.title}`}
            data-tip="Add connection"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              props.onConnectKeyboard();
            }}
          >
            <Icon name="arrow-right" size={13} />
          </button>
        </div>
      </Show>
      <header class="order-2 flex h-7 min-w-0 items-center gap-2 px-1">
        <span
          class="grid size-[18px] shrink-0 place-items-center rounded-[6px] text-[var(--text-invert-strong)]"
          style={{
            background: props.step ? accentForStep(props.step) : "var(--text-interactive-base)",
          }}
        >
          <Icon name={props.step ? iconForStep(props.step) : "play"} size={9} />
        </span>
        <Show
          when={props.editing}
          fallback={
            <strong class="min-w-0 truncate text-[13px] font-medium text-[var(--text-strong)]">
              {props.title}
            </strong>
          }
        >
          <input
            class="min-w-0 flex-1 rounded-[6px] bg-[var(--map-control-surface)] px-1.5 py-1 text-[13px] font-medium text-[var(--text-strong)] outline-none ring-2 ring-[var(--text-interactive-base)]"
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
          <div
            data-screen-frame
            class="order-1 grid min-h-0 flex-1 place-items-center overflow-hidden rounded-[18px] bg-[radial-gradient(circle_at_50%_35%,color-mix(in_srgb,var(--v2-background-bg-accent)_10%,transparent),transparent_44%),var(--v2-background-bg-deep)] px-5 text-center shadow-[var(--map-elevation-control)]"
          >
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
          <div
            data-screen-frame
            class="order-1 min-h-0 flex-1 overflow-hidden rounded-[18px] bg-[oklch(0.12_0.01_270)] shadow-[var(--map-elevation-control)]"
          >
            <img
              src={src()}
              alt={`Recorded ${props.title} screen`}
              draggable={false}
              class="size-full object-contain object-top"
            />
          </div>
        )}
      </Show>
      <footer class="order-3 flex h-5 items-center justify-between px-1 text-[11px] text-[var(--text-weak)]">
        <Show when={!props.selected}>
          <span class="inline-flex items-center gap-1.5">
            <Show when={props.runState && props.runState !== "idle"}>
              <i
                class={cn(
                  "size-1.5 rounded-full",
                  props.runState === "failed"
                    ? "bg-[var(--icon-critical-base)]"
                    : props.runState === "running"
                      ? "bg-[var(--text-interactive-base)] motion-safe:animate-pulse"
                      : props.runState === "healed"
                        ? "bg-[var(--icon-warning-base)]"
                        : props.runState === "passed"
                          ? "bg-[var(--icon-success-base)]"
                          : "bg-[var(--text-weak)]",
                )}
              />
              <span class="capitalize">{props.runState}</span>
            </Show>
            <Show when={!props.runState || props.runState === "idle"}>
              {props.isFlowStart
                ? `Entry · ${props.outgoingCount} ${props.outgoingCount === 1 ? "connection" : "connections"}`
                : `${props.outgoingCount} ${props.outgoingCount === 1 ? "connection" : "connections"}`}
            </Show>
          </span>
        </Show>
        <Show when={props.selected}>
          <span class="ml-auto font-medium text-[var(--text-interactive-base)]">
            Drag to connect
          </span>
        </Show>
      </footer>
      <button
        type="button"
        class={cn(
          "journey-connect-handle group absolute top-1/2 right-[-20px] z-10 grid size-11 -translate-y-1/2 cursor-crosshair place-items-center rounded-full opacity-0 outline-none transition-opacity duration-150 group-hover/screen:opacity-100 focus-visible:opacity-100",
          props.selected && "opacity-100",
        )}
        aria-label={`Connect ${props.title} to another screen`}
        title="Drag to connect, or press Enter"
        onPointerDown={props.onConnectStart}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          props.onConnectKeyboard();
        }}
      >
        <span class="grid size-[24px] place-items-center rounded-full border border-[var(--text-interactive-base)] bg-[var(--v2-background-bg-base)] text-[var(--text-interactive-base)] shadow-[0_3px_12px_rgb(0_0_0/28%)] transition-[background-color,transform] duration-150 group-hover:scale-110 group-hover:bg-[var(--product-accent-soft)] group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-[var(--border-strong-focus)]">
          <Icon name="arrow-right" size={11} />
        </span>
      </button>
    </article>
  );
}

export function KeyboardConnectionChooser(props: {
  sourceTitle: string;
  destinations: Array<{ id: string; title: string }>;
  onChoose: (id: string) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  let panel: HTMLElement | undefined;
  createEffect(() => {
    queueMicrotask(() => panel?.querySelector<HTMLButtonElement>("button")?.focus());
  });
  return (
    <aside
      ref={(element) => (panel = element)}
      class="absolute bottom-[calc(76px+env(safe-area-inset-bottom))] left-1/2 z-40 w-[min(420px,calc(100%-32px))] -translate-x-1/2 rounded-[14px] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_96%,transparent)] p-3 shadow-[0_0_0_1px_color-mix(in_srgb,var(--v2-border-border-strong)_76%,transparent),0_18px_48px_rgb(0_0_0/34%)] backdrop-blur-[14px]"
      role="dialog"
      aria-label={`Connect ${props.sourceTitle}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        props.onCancel();
      }}
    >
      <div class="flex items-start justify-between gap-3 px-1">
        <div>
          <span class="block text-[9.5px] font-semibold tracking-[0.12em] text-[var(--text-weak)] uppercase">
            Connect from
          </span>
          <strong class="mt-1 block text-[12px] font-semibold text-[var(--text-strong)]">
            {props.sourceTitle}
          </strong>
        </div>
        <button
          type="button"
          class="relative grid size-9 place-items-center rounded-[8px] text-[var(--text-weak)] before:absolute before:-inset-1 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
          aria-label="Cancel connection"
          onClick={props.onCancel}
        >
          <Icon name="x" size={12} />
        </button>
      </div>
      <p class="m-0 mt-2 px-1 text-[10.5px]/[1.45] text-[var(--text-weak)]">
        Choose an existing destination or add a new screen to the right.
      </p>
      <div class="mt-2 grid max-h-48 gap-1 overflow-y-auto">
        <For each={props.destinations}>
          {(destination) => (
            <button
              type="button"
              class="flex min-h-11 items-center gap-2 rounded-[9px] px-2.5 text-left text-[11px] text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
              onClick={() => props.onChoose(destination.id)}
            >
              <span class="grid size-7 shrink-0 place-items-center rounded-[7px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
                <Icon name="smartphone" size={12} />
              </span>
              <span class="min-w-0 flex-1 truncate">{destination.title}</span>
              <Icon name="arrow-right" size={11} />
            </button>
          )}
        </For>
        <button
          type="button"
          class="flex min-h-11 items-center gap-2 rounded-[9px] px-2.5 text-left text-[11px] font-medium text-[var(--text-interactive-base)] hover:bg-[var(--product-accent-soft)]"
          onClick={props.onCreate}
        >
          <span class="grid size-7 shrink-0 place-items-center rounded-[7px] bg-[var(--product-accent-soft)]">
            <Icon name="plus" size={12} />
          </span>
          New screen
        </button>
      </div>
    </aside>
  );
}

export function ScreenInspector(props: {
  node: JourneyTreeNode | null;
  title: string;
  connections: CanvasConnection[];
  onSelectConnection: (connection: CanvasConnection) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <Show when={props.node}>
      {(_node) => (
        <aside class="absolute bottom-[calc(76px+env(safe-area-inset-bottom))] left-1/2 z-30 w-[min(520px,calc(100%-32px))] -translate-x-1/2 rounded-[14px] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_95%,transparent)] p-2.5 shadow-[0_0_0_1px_color-mix(in_srgb,var(--v2-border-border-strong)_72%,transparent),0_16px_46px_rgb(0_0_0/28%)] backdrop-blur-[14px]">
          <div class="flex items-start justify-between gap-3 px-1.5 pt-0.5">
            <div>
              <span class="block text-[10px] font-semibold tracking-[0.12em] text-[var(--text-weak)]">
                SCREEN
              </span>
              <strong class="mt-1 block text-[12.5px] font-semibold text-[var(--text-strong)]">
                {props.title}
              </strong>
            </div>
            <div class="flex items-center gap-1">
              <button
                type="button"
                class="relative grid size-10 place-items-center rounded-[8px] text-[var(--text-weak)] before:absolute before:-inset-0.5 transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--icon-critical-base)]"
                aria-label="Remove screen"
                title="Remove screen (Delete)"
                onClick={props.onRemove}
              >
                <Icon name="trash" size={12} />
              </button>
              <button
                type="button"
                class="relative grid size-10 place-items-center rounded-[8px] text-[var(--text-weak)] before:absolute before:-inset-0.5 transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                aria-label="Close screen details"
                onClick={props.onClose}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          </div>
          <div class="mt-2 grid gap-0.5 border-t border-[var(--v2-border-border-muted)] pt-1.5">
            <span class="px-1.5 pb-0.5 text-[10.5px] font-semibold tracking-[0.11em] text-[var(--text-weak)]">
              OUTGOING
            </span>
            <Show
              when={props.connections.length}
              fallback={
                <p class="m-0 px-1.5 py-2 text-[11px]/[1.45] text-[var(--text-weak)]">
                  No connections yet. Record an interaction, or drag the arrow on the screen card to
                  sketch one.
                </p>
              }
            >
              <For each={props.connections}>
                {(connection) => (
                  <button
                    type="button"
                    class="flex min-h-11 items-center gap-2 rounded-[7px] px-1.5 text-left text-[11.5px] text-[var(--text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
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
    behaviors: Array<{ id: string; label: string; actionCount: number }>;
    onRecord: () => void;
    onBack: () => void;
    onAutomatic: () => void;
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
  cases: ConnectionCaseStackProps;
  onRemove: () => void;
  onClose: () => void;
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
    <aside class="absolute bottom-[calc(76px+env(safe-area-inset-bottom))] left-1/2 z-30 w-[min(380px,calc(100%-32px))] -translate-x-1/2 rounded-[14px] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_95%,transparent)] p-3.5 shadow-[0_0_0_1px_color-mix(in_srgb,var(--v2-border-border-strong)_72%,transparent),0_16px_46px_rgb(0_0_0/28%)] backdrop-blur-[14px]">
      <div class="flex items-center justify-between gap-3">
        <span class="text-[9.5px] font-semibold tracking-[0.12em] text-[var(--text-weak)]">
          CONNECTION
        </span>
        <div class="flex items-center gap-1.5">
          <span
            class={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
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
          <button
            type="button"
            class="grid size-8 place-items-center rounded-[7px] text-[var(--text-weak)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
            aria-label="Close connection details"
            onClick={props.onClose}
          >
            <Icon name="x" size={11} />
          </button>
        </div>
      </div>
      <strong class="mt-1.5 block text-[13px] text-[var(--text-strong)]">
        {props.sourceTitle} <span class="text-[var(--text-weak)]">→</span> {props.targetTitle}
      </strong>
      <p class="m-0 mt-1 text-[11.5px]/[1.5] text-[var(--text-weak)]">
        {pending()
          ? "Choose what should move the device to the next screen. You can record it or start with a simple behavior."
          : `${modeLabel()} · ${actionCount()} action${actionCount() === 1 ? "" : "s"}${props.connection.videoTakeId ? " · video" : ""}${props.connection.videoClip ? " · trimmed" : ""}`}
      </p>
      <ConnectionCaseStack {...props.cases} />
      <Show when={!pending()}>
        <div class="mt-3 grid gap-1 rounded-[9px] bg-[color-mix(in_srgb,var(--v2-background-bg-layer-02)_72%,transparent)] p-2">
          <div class="flex min-h-8 items-center gap-2 px-0.5">
            <span
              class={cn(
                "grid size-6 shrink-0 place-items-center rounded-[7px]",
                failed()
                  ? "bg-[color-mix(in_srgb,var(--icon-critical-base)_14%,transparent)] text-[var(--icon-critical-base)]"
                  : verified()
                    ? "bg-[color-mix(in_srgb,var(--icon-success-base)_14%,transparent)] text-[var(--icon-success-base)]"
                    : "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
              )}
            >
              <Icon name={failed() ? "alert" : verified() ? "check" : "scan"} size={11} />
            </span>
            <span class="min-w-0 flex-1">
              <strong class="block text-[10.5px] font-medium text-[var(--text-strong)]">
                Reach {props.targetTitle}
              </strong>
              <span class="block truncate text-[9.5px] text-[var(--text-weak)]">
                {checkedTargetsLabel(props.connection.review?.targets)}
              </span>
            </span>
            <span class="text-[9.5px] font-medium text-[var(--text-weak)]">
              {verified() ? "Passed" : failed() ? "Changed" : "Not checked"}
            </span>
          </div>
          <For each={props.connection.review?.targets ?? []}>
            {(target) => (
              <div class="flex min-h-7 items-center gap-2 border-t border-[var(--v2-border-border-muted)] px-1 pt-1 text-[9.5px]">
                <i
                  class={cn(
                    "size-1.5 rounded-full",
                    target.status === "passed"
                      ? "bg-[var(--icon-success-base)]"
                      : target.status === "failed"
                        ? "bg-[var(--icon-critical-base)]"
                        : "bg-[var(--icon-warning-base)]",
                  )}
                />
                <span class="min-w-0 flex-1 truncate text-[var(--text-base)]">
                  {target.targetName ?? target.targetId}
                </span>
                <span class="capitalize text-[var(--text-weak)]">
                  {target.status.replace("-", " ")}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
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
              class="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[8px] bg-[var(--product-accent-soft)] px-3 text-[10.5px] font-semibold text-[var(--text-interactive-base)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_18%,transparent)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
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
                class="inline-flex min-h-11 items-center gap-1.5 rounded-[7px] px-2 text-[10px] font-medium text-[var(--text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                onClick={props.replay.onSelectStep}
              >
                <Icon name="arrow-right" size={10} /> Actions
              </button>
              <button
                type="button"
                class="inline-flex min-h-11 items-center gap-1.5 rounded-[7px] px-2 text-[10px] font-medium text-[var(--text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                onClick={props.replay.onRewrite}
              >
                <Icon name="refresh" size={10} /> Rewrite
              </button>
              <button
                type="button"
                class="inline-flex min-h-11 items-center gap-1.5 rounded-[7px] px-2 text-[10px] font-medium text-[var(--text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                onClick={props.replay.onSaveReusable}
              >
                <Icon name="copy" size={10} /> Save behavior
              </button>
              <Show when={props.connection.source === "authored"}>
                <button
                  type="button"
                  class="relative ml-auto grid size-9 place-items-center rounded-[7px] text-[var(--text-weak)] before:absolute before:-inset-1 transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--icon-critical-base)]"
                  aria-label="Remove connection"
                  title="Remove connection"
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
            class="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[8px] bg-[var(--product-accent-soft)] px-3 text-[10.5px] font-semibold text-[var(--text-interactive-base)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_18%,transparent)] active:scale-[0.98]"
            onClick={props.setup.onRecord}
          >
            <Icon name="smartphone" size={11} /> Record on device
          </button>
          <button
            type="button"
            class="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[7px] text-[10px] font-medium text-[var(--text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
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
              <Show when={props.connection.source === "authored"}>
                <button
                  type="button"
                  class="mt-1 inline-flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-[10px] text-[var(--text-weak)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--icon-critical-base)]"
                  onClick={props.onRemove}
                >
                  <Icon name="trash" size={10} /> Remove connection
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </aside>
  );
}

export function checkedTargetsLabel(
  targets: readonly { targetId: string; targetName?: string }[] | undefined,
): string {
  if (!targets?.length) return "No target evidence recorded";
  if (targets.length === 1) return `Checked on ${targets[0]!.targetName ?? targets[0]!.targetId}`;
  return `Checked on ${targets.length} targets`;
}
