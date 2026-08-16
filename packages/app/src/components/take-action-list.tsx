import { For, Show, createSignal, onCleanup, type JSX } from "solid-js";
import type { RecordingTakeAction } from "../context/recorder";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { describeTakeAction, moveActionIds } from "./take-action-model";

/** Ordered Take actions — drag the grip to reorder; no up/down arrow clutter. */

const iconButton =
  "grid size-11 shrink-0 place-items-center rounded-lg text-[var(--text-weak)] transition-[background-color,color,transform] duration-100 hover:bg-[var(--surface-raised-base)] hover:text-[var(--text-strong)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] disabled:cursor-not-allowed disabled:opacity-30";

type DropMarker = { actionId: string; place: "before" | "after" };

export function TakeActionList(props: {
  actions: readonly RecordingTakeAction[];
  selectedActionId?: string;
  editingActionId?: string;
  disabled?: boolean;
  onSelect: (action: RecordingTakeAction) => void;
  onEdit?: (action: RecordingTakeAction, trigger: HTMLButtonElement) => void;
  onReorder?: (actionIds: string[]) => void | Promise<void>;
  onRemove?: (action: RecordingTakeAction) => void | Promise<void>;
}): JSX.Element {
  const [draggingId, setDraggingId] = createSignal<string>();
  const [dropMarker, setDropMarker] = createSignal<DropMarker>();
  const [announcement, setAnnouncement] = createSignal("");
  const focusTargets = new Map<string, HTMLButtonElement>();
  const rowElements = new Map<string, HTMLLIElement>();
  let activeDrag:
    | {
        actionId: string;
        pointerId: number;
        originY: number;
        moved: boolean;
      }
    | undefined;

  async function commitMove(actionId: string, toIndex: number): Promise<void> {
    if (!props.onReorder || props.disabled) return;
    const action = props.actions.find((candidate) => candidate.id === actionId);
    if (!action) return;
    const next = moveActionIds(props.actions, actionId, toIndex);
    const current = props.actions.map((candidate) => candidate.id);
    if (next.every((id, index) => id === current[index])) return;
    await props.onReorder(next);
    const position = next.indexOf(actionId);
    setAnnouncement(
      `Moved ${describeTakeAction(action)} to position ${position + 1} of ${next.length}.`,
    );
    queueMicrotask(() => focusTargets.get(actionId)?.focus({ preventScroll: true }));
  }

  function clearDrag(): void {
    activeDrag = undefined;
    setDraggingId(undefined);
    setDropMarker(undefined);
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerUp);
  }

  function targetIndexForMarker(actionId: string, marker: DropMarker | undefined): number {
    const fromIndex = props.actions.findIndex((action) => action.id === actionId);
    if (fromIndex < 0 || !marker) return fromIndex;
    const overIndex = props.actions.findIndex((action) => action.id === marker.actionId);
    if (overIndex < 0) return fromIndex;
    // Insertion index in the list *before* removing the dragged item.
    let insertAt = marker.place === "before" ? overIndex : overIndex + 1;
    // After removal, indices at/after fromIndex shift left by one.
    if (fromIndex < insertAt) insertAt -= 1;
    return Math.max(0, Math.min(props.actions.length - 1, insertAt));
  }

  function markerFromPoint(clientY: number, draggedId: string): DropMarker | undefined {
    const rows = props.actions
      .map((action) => {
        const element = rowElements.get(action.id);
        if (!element || action.id === draggedId) return null;
        const rect = element.getBoundingClientRect();
        return { id: action.id, mid: rect.top + rect.height / 2 };
      })
      .filter((row): row is { id: string; mid: number } => Boolean(row));

    if (rows.length === 0) return undefined;

    for (const row of rows) {
      if (clientY < row.mid) return { actionId: row.id, place: "before" };
    }
    const last = rows[rows.length - 1]!;
    return { actionId: last.id, place: "after" };
  }

  function onWindowPointerMove(event: PointerEvent): void {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    if (!activeDrag.moved && Math.abs(event.clientY - activeDrag.originY) < 4) return;
    activeDrag.moved = true;
    setDropMarker(markerFromPoint(event.clientY, activeDrag.actionId));
  }

  function onWindowPointerUp(event: PointerEvent): void {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    const { actionId, moved } = activeDrag;
    const marker = dropMarker();
    clearDrag();
    if (!moved) return;
    void commitMove(actionId, targetIndexForMarker(actionId, marker));
  }

  function startDrag(event: PointerEvent, action: RecordingTakeAction): void {
    if (!props.onReorder || props.disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    clearDrag();
    activeDrag = {
      actionId: action.id,
      pointerId: event.pointerId,
      originY: event.clientY,
      moved: false,
    };
    setDraggingId(action.id);
    setDropMarker(undefined);
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Capture is best-effort; window listeners still finish the gesture.
    }
  }

  function onGripKeyDown(event: KeyboardEvent, action: RecordingTakeAction, index: number): void {
    if (!props.onReorder || props.disabled) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      void commitMove(action.id, index + (event.key === "ArrowUp" ? -1 : 1));
    }
  }

  onCleanup(() => clearDrag());

  return (
    <>
      <ol
        class="m-0 grid list-none gap-1.5 p-0"
        aria-label="Recorded actions"
        data-dragging={draggingId() ? "true" : undefined}
      >
        <For each={props.actions}>
          {(action, index) => {
            const selected = () => props.selectedActionId === action.id;
            const editing = () => props.editingActionId === action.id;
            const description = () => describeTakeAction(action);
            const dragging = () => draggingId() === action.id;
            const marker = () => {
              const current = dropMarker();
              return current?.actionId === action.id ? current.place : undefined;
            };
            return (
              <li
                ref={(element) => rowElements.set(action.id, element)}
                class={cn(
                  "relative overflow-hidden rounded-xl border transition-[background-color,border-color,box-shadow,opacity,transform] duration-100",
                  selected()
                    ? "border-[color-mix(in_srgb,var(--text-interactive-base)_28%,var(--border-weak-base))] bg-[var(--product-accent-soft)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--text-interactive-base)_7%,transparent)]"
                    : "border-transparent bg-[var(--surface-base)]",
                  dragging() && "scale-[0.99] opacity-45 shadow-none",
                )}
                data-action-id={action.id}
                data-dragging={dragging() ? "true" : undefined}
              >
                <Show when={marker() === "before"}>
                  <span
                    class="pointer-events-none absolute inset-x-2 top-[-3px] z-[2] h-[3px] rounded-full bg-[var(--text-interactive-base)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--background-base)_80%,transparent)]"
                    aria-hidden="true"
                  />
                </Show>
                <div class="flex min-h-11 min-w-0 items-center gap-0.5 px-1">
                  <Show when={props.onReorder}>
                    <button
                      type="button"
                      ref={(element) => focusTargets.set(action.id, element)}
                      class={cn(
                        iconButton,
                        "cursor-grab touch-none active:cursor-grabbing",
                        dragging() && "cursor-grabbing text-[var(--text-interactive-base)]",
                      )}
                      aria-label={`Drag to reorder ${description()}. Arrow keys also move.`}
                      title="Drag to reorder"
                      disabled={props.disabled}
                      onKeyDown={(event) => onGripKeyDown(event, action, index())}
                      onPointerDown={(event) => startDrag(event, action)}
                    >
                      <Icon name="move" size={13} />
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="flex min-h-11 min-w-0 flex-1 items-center gap-2 overflow-hidden px-1 text-left focus-visible:outline-none"
                    aria-current={selected() ? "step" : undefined}
                    onClick={() => {
                      // Ignore the synthetic click that follows a completed drag.
                      if (draggingId()) return;
                      props.onSelect(action);
                    }}
                  >
                    <span
                      class={cn(
                        "grid size-6 shrink-0 place-items-center rounded-md font-mono text-micro",
                        selected()
                          ? "bg-[color-mix(in_srgb,var(--text-interactive-base)_20%,transparent)] text-[var(--text-interactive-base)]"
                          : "bg-[var(--surface-base-hover)] text-[var(--text-weak)]",
                      )}
                    >
                      {String(index() + 1).padStart(2, "0")}
                    </span>
                    <span class="min-w-0 flex-1 overflow-hidden">
                      <span class="block truncate text-caption leading-snug font-medium text-[var(--text-strong)]">
                        {description()}
                      </span>
                      <Show when={action.steps.length > 1}>
                        <span class="block truncate text-micro text-[var(--text-weak)]">
                          Edited together as one recorded action
                        </span>
                      </Show>
                      <Show when={action.label === "Recorded pause"}>
                        <span class="block truncate text-micro text-[var(--text-weak)]">
                          Pause between actions · edit or remove
                        </span>
                      </Show>
                    </span>
                  </button>
                  <div class="flex shrink-0 items-center">
                    <Show when={props.onEdit}>
                      <button
                        type="button"
                        class={iconButton}
                        aria-label={`${editing() ? "Close editor for" : "Edit"} ${description()}`}
                        aria-expanded={editing()}
                        disabled={props.disabled}
                        onClick={(event) => props.onEdit?.(action, event.currentTarget)}
                      >
                        <Icon name={editing() ? "chevron-up" : "edit"} size={13} />
                      </button>
                    </Show>
                    <Show when={props.onRemove}>
                      <button
                        type="button"
                        class={cn(iconButton, "hover:text-[var(--icon-critical-base)]")}
                        aria-label={`Remove ${description()}`}
                        disabled={props.disabled}
                        onClick={() => void props.onRemove?.(action)}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </Show>
                  </div>
                </div>
                <Show when={marker() === "after"}>
                  <span
                    class="pointer-events-none absolute inset-x-2 bottom-[-3px] z-[2] h-[3px] rounded-full bg-[var(--text-interactive-base)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--background-base)_80%,transparent)]"
                    aria-hidden="true"
                  />
                </Show>
              </li>
            );
          }}
        </For>
      </ol>
      <p class="sr-only" aria-live="polite" aria-atomic="true">
        {announcement()}
      </p>
    </>
  );
}
