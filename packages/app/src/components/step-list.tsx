import {
  For,
  Index,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { useServer, type RecipeStep } from "../context/server";
import { useRecipeDraft } from "../context/recipe-draft";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "./icon";
import { AddMenu } from "./step-list-controls";
import { InsertGap, StepRow } from "./step-row";
import { btnBar } from "../lib/ui";

/**
 * The interactive step list for a custom recipe — the run pane's body when a
 * custom recipe is selected and no run is showing. Reads/writes through
 * `useRecipeDraft()`, which owns the debounced autosave; this component is
 * purely presentational + row-local ephemeral state (expand, run result).
 */
export function RecipeStepsEditor(): JSX.Element {
  const draft = useRecipeDraft();
  const server = useServer();
  const [expanded, setExpanded] = createSignal<number | null>(null);
  const [addAt, setAddAt] = createSignal<number | null>(null);
  const [focusIndex, setFocusIndex] = createSignal<number | null>(null);

  const wb = useWorkbench();

  createEffect(() => {
    const requested = draft.expandedStep();
    if (requested !== expanded()) setExpanded(requested);
  });

  function setOpen(i: number | null): void {
    setExpanded(i);
    draft.setExpandedStep(i);
  }

  function toggleEditor(i: number): void {
    if (expanded() === i) {
      setOpen(null);
      return;
    }
    wb.focusStep(i);
    setOpen(i);
  }

  function onRowActivate(i: number): void {
    // One click has one meaning: select this step and open its editor.
    // Running is always explicit through the play action.
    toggleEditor(i);
  }

  function onEditToggle(i: number): void {
    // Chevron always opens/closes this row's editor (and selects it).
    toggleEditor(i);
  }

  function insertAt(at: number, step: RecipeStep): void {
    draft.insertStep(at, step);
    setAddAt(null);
    wb.focusStep(at);
    setOpen(at); // new / incomplete step: open editor so they can fill it
    setFocusIndex(at);
  }

  // Reset editor chrome when switching tests — never when merely focusing a step.
  createEffect(() => {
    const id = server.selectedRecipeId();
    void id;
    setExpanded(null);
    draft.setExpandedStep(null);
    setAddAt(null);
  });

  // Escape collapses the editor (back to list context) without deselecting.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (addAt() != null) {
        e.stopPropagation();
        setAddAt(null);
        return;
      }
      if (expanded() != null) {
        e.stopPropagation();
        setOpen(null);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // Empty guide + starter chips replace the old auto-open menu (less noise).

  /** Compact starter chips — not fake step rows (that confused empty vs content). */
  const STARTERS: {
    label: string;
    description: string;
    icon: IconName;
    make: () => RecipeStep;
  }[] = [
    {
      label: "Tap",
      description: "Select an element or point",
      icon: "pointer",
      make: () => ({ kind: "tap", target: {} }),
    },
    {
      label: "Type",
      description: "Enter text or a variable",
      icon: "keyboard",
      make: () => ({ kind: "type", text: "" }),
    },
    {
      label: "Check",
      description: "Verify what appears on screen",
      icon: "check",
      make: () => ({ kind: "expect", target: {}, condition: "visible" }),
    },
    {
      label: "Wait",
      description: "Pause for a fixed duration",
      icon: "clock",
      make: () => ({ kind: "sleep", ms: 1000 }),
    },
  ];

  const isEmpty = () => draft.steps().length === 0;

  let footerBtnEl: HTMLButtonElement | undefined;
  const [footerAnchor, setFooterAnchor] = createSignal({
    left: 0,
    top: 0,
    bottom: 0,
    width: 0,
  });
  const footerOpen = () => addAt() === draft.steps().length;

  return (
    <div class="test-step-editor flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Full-height scroll — no floating card over a cream void */}
      <div class="test-step-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <Show when={isEmpty()}>
          <div class="test-step-empty" role="group" aria-label="Add first step">
            <div class="test-step-empty__content">
              <span class="test-step-empty__eyebrow">Manual step</span>
              <h3>Start with an action</h3>
              <p>
                Choose one to configure it. Recording on the device adds steps here automatically.
              </p>
              <div class="test-step-empty__grid">
                <For each={STARTERS}>
                  {(s) => (
                    <button
                      type="button"
                      class="test-step-empty__action"
                      onClick={() => insertAt(0, s.make())}
                    >
                      <span class="test-step-empty__icon" aria-hidden="true">
                        <Icon name={s.icon} size={16} strokeWidth={1.8} />
                      </span>
                      <span class="test-step-empty__action-copy">
                        <strong>{s.label}</strong>
                        <small>{s.description}</small>
                      </span>
                      <Icon name="chevron-right" size={14} class="test-step-empty__arrow" />
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Show>

        <Show when={!isEmpty()}>
          {/* Inset list — AgentBoard chip rows + gap-1 air */}
          <div class="test-step-list flex flex-col gap-2 py-4">
            <InsertGap
              at={0}
              open={addAt() === 0}
              onToggle={() => setAddAt((a) => (a === 0 ? null : 0))}
              onPick={(s) => insertAt(0, s)}
              onClose={() => setAddAt(null)}
            />

            <Index each={draft.steps()}>
              {(step, i) => (
                <>
                  <StepRow
                    step={step}
                    index={i}
                    total={() => draft.steps().length}
                    expanded={() => expanded() === i}
                    flash={() => draft.flashSteps().has(step())}
                    autofocus={() => focusIndex() === i}
                    onAutofocused={() => setFocusIndex((f) => (f === i ? null : f))}
                    onRowActivate={() => onRowActivate(i)}
                    onEditToggle={() => onEditToggle(i)}
                    onChange={(next) => draft.updateStep(i, next)}
                    onMove={(dir) => {
                      draft.moveStep(i, dir);
                      setOpen(expanded() === i ? i + dir : expanded() === i + dir ? i : expanded());
                    }}
                    onRemove={() => {
                      draft.removeStep(i);
                      const e = expanded();
                      setOpen(e === null ? null : e === i ? null : e > i ? e - 1 : e);
                    }}
                    onDuplicate={() => draft.duplicateStep(i)}
                  />
                  <Show when={i + 1 < draft.steps().length}>
                    <InsertGap
                      at={i + 1}
                      open={addAt() === i + 1}
                      onToggle={() => setAddAt((a) => (a === i + 1 ? null : i + 1))}
                      onPick={(s) => insertAt(i + 1, s)}
                      onClose={() => setAddAt(null)}
                    />
                  </Show>
                </>
              )}
            </Index>
          </div>
        </Show>
      </div>

      <div class="test-step-footer relative shrink-0 border-t border-border-weak-base bg-surface-raised-stronger-non-alpha px-3 py-2.5 text-text-strong">
        <button
          type="button"
          ref={(el) => {
            footerBtnEl = el;
          }}
          class={cn(
            btnBar,
            "hover:bg-surface-raised-base-hover",
            footerOpen() && "bg-surface-base-active",
          )}
          aria-haspopup="menu"
          aria-expanded={footerOpen()}
          onClick={() => {
            const r = footerBtnEl?.getBoundingClientRect();
            if (r)
              setFooterAnchor({
                left: r.left,
                top: r.top,
                bottom: r.bottom,
                width: r.width,
              });
            setAddAt((a) => (a === draft.steps().length ? null : draft.steps().length));
          }}
        >
          <Icon name="plus" size={14} strokeWidth={2} class="text-icon-base" />
          Add a step…
        </button>
        <Show when={footerOpen()}>
          <AddMenu
            anchor={footerAnchor()}
            placement="above"
            onPick={(s) => insertAt(draft.steps().length, s)}
            onClose={() => setAddAt(null)}
          />
        </Show>
      </div>
    </div>
  );
}
