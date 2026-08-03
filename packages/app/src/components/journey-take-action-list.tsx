import { For, Show, createSignal, type JSX } from "solid-js";
import type { RecordingTakeAction } from "../context/recorder";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { describeTakeAction, moveActionIds } from "./journey-take-action-model";

const iconButton =
  "grid size-11 shrink-0 place-items-center rounded-[8px] text-[var(--text-weak)] transition-[background-color,color,transform] duration-100 hover:bg-[var(--v2-background-bg-layer-03)] hover:text-[var(--text-strong)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] disabled:cursor-not-allowed disabled:opacity-30";

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
  const [dropId, setDropId] = createSignal<string>();
  const [announcement, setAnnouncement] = createSignal("");
  const focusTargets = new Map<string, HTMLButtonElement>();

  async function move(action: RecordingTakeAction, toIndex: number): Promise<void> {
    if (!props.onReorder || props.disabled) return;
    const next = moveActionIds(props.actions, action.id, toIndex);
    const current = props.actions.map((candidate) => candidate.id);
    if (next.every((id, index) => id === current[index])) return;
    await props.onReorder(next);
    const position = next.indexOf(action.id);
    setAnnouncement(
      `Moved ${describeTakeAction(action)} to position ${position + 1} of ${next.length}.`,
    );
    queueMicrotask(() => focusTargets.get(action.id)?.focus({ preventScroll: true }));
  }

  function onActionKeyDown(event: KeyboardEvent, action: RecordingTakeAction, index: number): void {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    void move(action, index + (event.key === "ArrowUp" ? -1 : 1));
  }

  return (
    <>
      <ol class="m-0 grid list-none gap-1.5 p-0" aria-label="Recorded actions">
        <For each={props.actions}>
          {(action, index) => {
            const selected = () => props.selectedActionId === action.id;
            const editing = () => props.editingActionId === action.id;
            const description = () => describeTakeAction(action);
            return (
              <li
                class={cn(
                  "overflow-hidden rounded-[10px] border transition-[background-color,border-color,box-shadow] duration-100",
                  selected()
                    ? "border-[color-mix(in_srgb,var(--text-interactive-base)_28%,var(--v2-border-border-muted))] bg-[var(--product-accent-soft)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--text-interactive-base)_7%,transparent)]"
                    : "border-transparent bg-[var(--v2-background-bg-layer-01)]",
                  dropId() === action.id && "border-[var(--text-interactive-base)]",
                  draggingId() === action.id && "opacity-50",
                )}
                data-action-id={action.id}
                onDragOver={(event) => {
                  if (!props.onReorder || props.disabled) return;
                  event.preventDefault();
                  setDropId(action.id);
                }}
                onDragLeave={() => setDropId(undefined)}
                onDrop={(event) => {
                  event.preventDefault();
                  const draggedId = draggingId();
                  setDraggingId(undefined);
                  setDropId(undefined);
                  if (!draggedId) return;
                  const dragged = props.actions.find((candidate) => candidate.id === draggedId);
                  if (dragged) void move(dragged, index());
                }}
              >
                <div class="flex min-h-11 min-w-0 items-center gap-0.5 px-1">
                  <Show when={props.onReorder}>
                    <button
                      type="button"
                      ref={(element) => focusTargets.set(action.id, element)}
                      class={cn(iconButton, "cursor-grab active:cursor-grabbing")}
                      aria-label={`Move ${description()}. Use Alt and arrow keys, or drag.`}
                      title="Drag, or use Alt + ↑ / ↓"
                      draggable={!props.disabled}
                      disabled={props.disabled}
                      onKeyDown={(event) => onActionKeyDown(event, action, index())}
                      onDragStart={(event) => {
                        setDraggingId(action.id);
                        event.dataTransfer?.setData("text/plain", action.id);
                        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDraggingId(undefined);
                        setDropId(undefined);
                      }}
                    >
                      <Icon name="move" size={13} />
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-1.5 text-left focus-visible:outline-none"
                    aria-current={selected() ? "step" : undefined}
                    onClick={() => props.onSelect(action)}
                  >
                    <span
                      class={cn(
                        "grid size-6 shrink-0 place-items-center rounded-[6px] font-mono text-[9px]",
                        selected()
                          ? "bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_20%,transparent)] text-[var(--text-interactive-base)]"
                          : "bg-[var(--v2-background-bg-layer-02)] text-[var(--text-weak)]",
                      )}
                    >
                      {String(index() + 1).padStart(2, "0")}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-[11.5px] font-medium text-[var(--text-strong)]">
                        {description()}
                      </span>
                      <Show when={action.steps.length > 1}>
                        <span class="block truncate text-[9.5px] text-[var(--text-weak)]">
                          Edited together as one recorded action
                        </span>
                      </Show>
                      <Show when={action.label === "Recorded pause"}>
                        <span class="block truncate text-[9.5px] text-[var(--text-weak)]">
                          Recorded timing · edit or remove
                        </span>
                      </Show>
                    </span>
                  </button>
                  <Show when={props.onReorder && selected()}>
                    <button
                      type="button"
                      class={iconButton}
                      aria-label={`Move ${description()} up`}
                      disabled={props.disabled || index() === 0}
                      onClick={() => void move(action, index() - 1)}
                    >
                      <Icon name="chevron-up" size={13} />
                    </button>
                    <button
                      type="button"
                      class={iconButton}
                      aria-label={`Move ${description()} down`}
                      disabled={props.disabled || index() === props.actions.length - 1}
                      onClick={() => void move(action, index() + 1)}
                    >
                      <Icon name="chevron-down" size={13} />
                    </button>
                  </Show>
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
