import { For, Show, createMemo, createSignal } from "solid-js";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import { cn } from "../lib/cn";
import { productIconButton } from "../lib/ui";
import { testEditorInput } from "../lib/app-map-test-editor-styles";
import {
  SCENARIO_STEP_LABELS,
  type ScenarioDiagnostic,
  type ScenarioStepKind,
} from "../lib/app-map-test-editor-model";
import { scenarioStepPath, scenarioStepTitle } from "../lib/app-map-test-step-path";
import {
  flattenScenarioSteps,
  type ScenarioStepBranch,
  type ScenarioStepOutlineItem,
} from "../lib/app-map-test-editor-tree";
import { Icon } from "./icon";
import { EmptyState } from "./empty-state";
import { StepKindMenu, StepRow, type StepDropTarget } from "./app-map-test-step-row";

/**
 * The Steps rail. It owns browsing: find, read, select, order, add, remove.
 * Editing a step happens in the centre column, and evidence for a step happens
 * in the device rail, so this rail never has to explain a binding.
 */
export function AppMapTestOutline(props: {
  map: AppMap;
  test: AppMapScenarioTest;
  selectedStepId?: string;
  diagnostics: readonly ScenarioDiagnostic[];
  onSelect: (stepId: string) => void;
  onOpen: (stepId: string) => void;
  onAddRoot: (kind: ScenarioStepKind) => void;
  onAddChild: (
    parentStepId: string,
    branch: Exclude<ScenarioStepBranch, "root">,
    kind: ScenarioStepKind,
  ) => void;
  onMove: (stepId: string, direction: -1 | 1) => void;
  onReorder: (stepId: string, toIndex: number) => void;
  onDuplicate: (stepId: string) => void;
  onDelete: (stepId: string) => void;
  onClose?: () => void;
}) {
  const [query, setQuery] = createSignal("");
  const [pane, setPane] = createSignal<"steps" | "problems">("steps");
  const [dragged, setDragged] = createSignal<ScenarioStepOutlineItem>();
  const [dropTarget, setDropTarget] = createSignal<StepDropTarget>();
  const outline = createMemo(() => flattenScenarioSteps(props.test.steps));
  const problems = createMemo(() => props.diagnostics);
  const visible = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase();
    if (!needle) return outline();
    return outline().filter((item) =>
      [
        SCENARIO_STEP_LABELS[item.step.kind],
        scenarioStepTitle(props.map, item.step),
        scenarioStepPath(props.map, item.step).full,
      ].some((value) => value.toLocaleLowerCase().includes(needle)),
    );
  });

  /** Arrow navigation moves selection with focus so the editor always agrees. */
  function navigate(event: KeyboardEvent): void {
    const keys = ["ArrowUp", "ArrowDown", "Home", "End"];
    if (event.altKey || event.metaKey || event.ctrlKey || !keys.includes(event.key)) return;
    const rows = visible();
    if (!rows.length) return;
    event.preventDefault();
    const current = rows.findIndex((item) => item.step.id === props.selectedStepId);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : event.key === "ArrowDown"
            ? (current + 1 + rows.length) % rows.length
            : (current - 1 + rows.length) % rows.length;
    const target = rows[next]?.step.id;
    if (!target) return;
    props.onSelect(target);
    queueMicrotask(() => document.getElementById(`test-step-row-${target}`)?.focus());
  }

  /** Drops are only meaningful between siblings of the same branch. */
  function acceptDrop(item: ScenarioStepOutlineItem, edge: "before" | "after"): boolean {
    const source = dragged();
    if (
      !source ||
      source.step.id === item.step.id ||
      source.branch !== item.branch ||
      source.parentStepId !== item.parentStepId
    ) {
      if (dropTarget()) setDropTarget();
      return false;
    }
    const current = dropTarget();
    if (current?.stepId !== item.step.id || current.edge !== edge) {
      setDropTarget({ stepId: item.step.id, edge });
    }
    return true;
  }

  function commitDrop(): void {
    const source = dragged();
    const target = dropTarget();
    setDragged();
    setDropTarget();
    if (!source || !target) return;
    const destination = outline().find((item) => item.step.id === target.stepId);
    if (!destination) return;
    const raw = target.edge === "before" ? destination.index : destination.index + 1;
    const toIndex = raw > source.index ? raw - 1 : raw;
    if (toIndex !== source.index) props.onReorder(source.step.id, toIndex);
  }

  return (
    <div class="flex min-h-0 flex-col bg-background-base">
      <div class="flex min-h-9 shrink-0 items-center gap-1 border-b border-border-weak-base px-2 py-1">
        <div
          class="flex shrink-0 rounded-md bg-surface-base-active p-0.5"
          role="tablist"
          aria-label="Test steps"
        >
          <button
            type="button"
            role="tab"
            id="test-steps-tab"
            aria-selected={pane() === "steps"}
            class={cn(
              "min-h-7 rounded px-2 text-micro font-medium",
              pane() === "steps" ? "bg-background-base text-text-strong" : "text-text-weak",
            )}
            onClick={() => setPane("steps")}
          >
            Steps
          </button>
          <button
            type="button"
            role="tab"
            id="test-problems-tab"
            aria-selected={pane() === "problems"}
            class={cn(
              "min-h-7 rounded px-2 text-micro font-medium",
              pane() === "problems" ? "bg-background-base text-text-strong" : "text-text-weak",
            )}
            onClick={() => setPane("problems")}
          >
            Problems
            <Show when={problems().length}>
              <span class="ml-1 tabular-nums text-text-warning-base">{problems().length}</span>
            </Show>
          </button>
        </div>
        <Show when={pane() === "steps"}>
          <label class="relative min-w-0 flex-1" for="test-step-search">
            <span class="sr-only">Find a step</span>
            <Icon
              name="search"
              size={13}
              class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-weaker"
            />
            <input
              id="test-step-search"
              type="search"
              class={cn(testEditorInput, "min-h-8 border-transparent bg-transparent pl-7")}
              value={query()}
              placeholder={`Find in ${outline().length} ${outline().length === 1 ? "step" : "steps"}…`}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || !query()) return;
                event.stopPropagation();
                setQuery("");
              }}
            />
          </label>
        </Show>
        <Show when={props.onClose}>
          <button
            type="button"
            class={cn(productIconButton, "ml-auto size-8")}
            aria-label="Hide steps"
            onClick={() => props.onClose?.()}
          >
            <Icon name="chevron-left" size={15} />
          </button>
        </Show>
      </div>

      <Show when={pane() === "steps"}>
        <div class="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
          <ol class="m-0 grid list-none gap-1 p-0" aria-label="Test steps">
            <For each={visible()}>
              {(item) => (
                <StepRow
                  item={item}
                  map={props.map}
                  selected={props.selectedStepId === item.step.id}
                  issue={props.diagnostics.find((diagnostic) => diagnostic.stepId === item.step.id)}
                  dropTarget={dropTarget()}
                  dragging={dragged()?.step.id === item.step.id}
                  onSelect={props.onSelect}
                  onOpen={props.onOpen}
                  onNavigate={navigate}
                  onAddChild={props.onAddChild}
                  onMove={props.onMove}
                  onDuplicate={props.onDuplicate}
                  onDelete={props.onDelete}
                  onDragStart={setDragged}
                  onDragOver={acceptDrop}
                  onDragEnd={() => {
                    setDragged();
                    setDropTarget();
                  }}
                  onDrop={commitDrop}
                />
              )}
            </For>
          </ol>
          <Show when={query() && !visible().length}>
            <EmptyState
              appearance="quiet"
              size="sm"
              title="No matching steps"
              description="Search an intent, a step type, or a mapped path name."
            />
          </Show>
          <Show when={!props.test.steps.length}>
            <EmptyState
              appearance="quiet"
              size="sm"
              title="Add the first step"
              description="New steps are not connected yet, so nothing vague can run."
            />
          </Show>
        </div>
      </Show>

      <Show when={pane() === "problems"}>
        <div
          class="min-h-0 flex-1 overflow-y-auto px-1.5 py-2"
          role="tabpanel"
          aria-labelledby="test-problems-tab"
        >
          <ul class="m-0 grid list-none gap-1 p-0" aria-label="Authoring problems">
            <For
              each={problems()}
              fallback={
                <li class="px-3 py-8 text-center">
                  <p class="m-0 text-caption font-medium text-text-strong">No problems</p>
                  <p class="mt-1 text-caption/[1.45] text-text-weak">
                    Steps are ready to run on the selected target.
                  </p>
                </li>
              }
            >
              {(item) => (
                <li>
                  <button
                    type="button"
                    class={cn(
                      "flex min-h-11 w-full items-start gap-2 rounded-md px-2.5 py-2 text-left",
                      "hover:bg-surface-base-hover focus-visible:outline-2 focus-visible:outline-border-strong-focus",
                      item.stepId &&
                        item.stepId === props.selectedStepId &&
                        "bg-surface-base-active",
                    )}
                    onClick={() => item.stepId && props.onOpen(item.stepId)}
                  >
                    <span
                      class={cn(
                        "mt-0.5 size-1.5 shrink-0 rounded-full",
                        item.tone === "blocker" ? "bg-icon-critical-base" : "bg-icon-warning-base",
                      )}
                      aria-hidden="true"
                    />
                    <span class="min-w-0 text-caption/[1.4] text-text-base">{item.message}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      <Show when={pane() === "steps"}>
        <div class="shrink-0 border-t border-border-weak-base p-2">
          <StepKindMenu label="Add step" variant="primary" onPick={props.onAddRoot} />
        </div>
      </Show>
    </div>
  );
}
