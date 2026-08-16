import { For, Show, createSignal } from "solid-js";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import { APP_MAP_TEST_INTENT_LIMITS } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { cn } from "../lib/cn";
import {
  SCENARIO_STEP_KINDS,
  SCENARIO_STEP_LABELS,
  scenarioStepSummary,
  type ScenarioDiagnostic,
  type ScenarioStepKind,
} from "../lib/app-map-test-editor-model";
import {
  flattenScenarioSteps,
  type ScenarioStepBranch,
  type ScenarioStepOutlineItem,
} from "../lib/app-map-test-editor-tree";
import { Icon } from "./icon";
import { testEditorInput, testEditorLabel } from "./app-map-test-binding-editor";

const iconButton =
  "flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-[11px] text-text-weak transition-[background-color,color,transform] hover:bg-surface-base-hover hover:text-text-strong active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-border-strong-focus disabled:cursor-not-allowed disabled:text-text-weaker";

export function AppMapTestOutline(props: {
  map: AppMap;
  test: AppMapScenarioTest;
  selectedStepId?: string;
  diagnostics: readonly ScenarioDiagnostic[];
  onSelect: (stepId: string) => void;
  onAddRoot: (kind: ScenarioStepKind) => void;
  onAddChild: (
    parentStepId: string,
    branch: Exclude<ScenarioStepBranch, "root">,
    kind: ScenarioStepKind,
  ) => void;
  onMove: (stepId: string, direction: -1 | 1) => void;
  onDuplicate: (stepId: string) => void;
  onDelete: (stepId: string) => void;
}) {
  const [rootKind, setRootKind] = createSignal<ScenarioStepKind>("instruction");
  const [query, setQuery] = createSignal("");
  const [view, setView] = createSignal<"coverage" | "problems">("coverage");
  const outline = () => flattenScenarioSteps(props.test.steps);
  const problemStepIds = () =>
    new Set(
      props.diagnostics.flatMap((diagnostic) => (diagnostic.stepId ? [diagnostic.stepId] : [])),
    );
  const problemCount = () => problemStepIds().size;
  const visibleOutline = () => {
    const needle = query().trim().toLocaleLowerCase();
    return outline().filter((item) => {
      if (view() === "problems" && !problemStepIds().has(item.step.id)) return false;
      if (!needle) return true;
      return [
        SCENARIO_STEP_LABELS[item.step.kind],
        item.step.intent,
        scenarioStepSummary(props.map, item.step),
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  };

  return (
    <>
      <div class="grid gap-2 border-b border-border-weak-base p-2">
        <div
          class="grid min-h-10 grid-cols-2 gap-1 rounded-lg bg-surface-base p-1"
          role="tablist"
          aria-label="Test coverage"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view() === "coverage"}
            class={cn(
              "min-h-8 rounded-md px-2 text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-border-strong-focus",
              view() === "coverage"
                ? "bg-background-base text-text-strong shadow-sm"
                : "text-text-weak hover:text-text-strong",
            )}
            onClick={() => setView("coverage")}
          >
            Coverage <span class="ml-1 tabular-nums text-text-weaker">{outline().length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view() === "problems"}
            class={cn(
              "min-h-8 rounded-md px-2 text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-border-strong-focus",
              view() === "problems"
                ? "bg-background-base text-text-strong shadow-sm"
                : "text-text-weak hover:text-text-strong",
            )}
            onClick={() => setView("problems")}
          >
            Problems <span class="ml-1 tabular-nums text-text-weaker">{problemCount()}</span>
          </button>
        </div>
        <label class="relative block" for="test-step-search">
          <span class="sr-only">Find a step</span>
          <Icon
            name="search"
            size={13}
            class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-weaker"
          />
          <input
            id="test-step-search"
            type="search"
            class={cn(testEditorInput, "h-9 min-h-9 pl-8")}
            value={query()}
            placeholder={
              view() === "problems" ? "Find a problem…" : `Find in ${outline().length} checks…`
            }
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-2">
        <ol class="m-0 grid list-none gap-1.5 p-0" aria-label="Test steps">
          <For each={visibleOutline()}>
            {(item) => (
              <OutlineRow
                item={item}
                map={props.map}
                selected={props.selectedStepId === item.step.id}
                issue={props.diagnostics.find((diagnostic) => diagnostic.stepId === item.step.id)}
                onSelect={props.onSelect}
                onAddChild={props.onAddChild}
                onMove={props.onMove}
                onDuplicate={props.onDuplicate}
                onDelete={props.onDelete}
              />
            )}
          </For>
        </ol>
        <Show when={query() && !visibleOutline().length}>
          <div class="px-4 py-8 text-center">
            <h2 class="m-0 text-[14px] font-semibold">No matching steps</h2>
            <p class="mt-1 text-[11px] text-text-weak">Try an intent, type, or binding name.</p>
          </div>
        </Show>
        <Show when={view() === "problems" && !query() && !visibleOutline().length}>
          <div class="px-4 py-8 text-center">
            <h2 class="m-0 text-[14px] font-semibold">No authoring problems</h2>
            <p class="mt-1 text-[11px] text-text-weak">
              Every check is resolved and ready to run in its authored order.
            </p>
          </div>
        </Show>
        <Show when={!props.test.steps.length}>
          <div class="px-4 py-8 text-center">
            <h2 class="m-0 text-[16px] font-semibold">Add the first intent</h2>
            <p class="mt-1 text-[12px] text-text-weak">
              Every new step starts unresolved, so nothing vague can run.
            </p>
          </div>
        </Show>
      </div>
      <AddStepForm
        label="Next step"
        kind={rootKind()}
        onKindChange={setRootKind}
        onAdd={(kind) => props.onAddRoot(kind)}
      />
    </>
  );
}

function OutlineRow(props: {
  item: ScenarioStepOutlineItem;
  map: AppMap;
  selected: boolean;
  issue?: ScenarioDiagnostic;
  onSelect: (stepId: string) => void;
  onAddChild: (
    parentStepId: string,
    branch: Exclude<ScenarioStepBranch, "root">,
    kind: ScenarioStepKind,
  ) => void;
  onMove: (stepId: string, direction: -1 | 1) => void;
  onDuplicate: (stepId: string) => void;
  onDelete: (stepId: string) => void;
}) {
  const step = () => props.item.step;
  const rowLabel = () =>
    props.item.branch === "root"
      ? `Step ${props.item.index + 1}`
      : `${branchLabel(props.item.branch)} ${props.item.index + 1}`;
  const canNest = () => props.item.depth < APP_MAP_TEST_INTENT_LIMITS.maxDepth;

  return (
    <li class="grid gap-2" style={{ "padding-left": `${Math.min(props.item.depth, 3) * 16}px` }}>
      <div
        class={cn(
          "relative grid grid-cols-[minmax(0,1fr)_44px] rounded-[10px] border bg-surface-base transition-[border-color,background-color]",
          props.selected
            ? "border-border-interactive-base bg-[var(--product-accent-soft)]"
            : "border-border-weak-base",
        )}
      >
        <button
          type="button"
          id={`test-step-row-${step().id}`}
          data-step-row={step().id}
          class="grid min-h-12 w-full grid-cols-[28px_minmax(0,1fr)] items-center gap-2 rounded-l-[9px] px-2 py-1 text-left focus-visible:z-[1] focus-visible:outline-2 focus-visible:outline-border-strong-focus"
          aria-current={props.selected ? "step" : undefined}
          aria-label={`${rowLabel()}: ${SCENARIO_STEP_LABELS[step().kind]}`}
          onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest" })}
          onClick={() => props.onSelect(step().id)}
          onKeyDown={(event) => {
            if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            props.onMove(step().id, event.key === "ArrowUp" ? -1 : 1);
          }}
        >
          <span class="grid size-7 place-items-center rounded-md bg-background-base text-[10px] font-semibold tabular-nums text-text-interactive-base">
            {props.item.branch === "root" ? props.item.index + 1 : branchGlyph(props.item.branch)}
          </span>
          <span class="min-w-0">
            <span class="flex items-center gap-2 text-[11px] font-semibold">
              <Show when={props.item.branch !== "root"}>
                <span class="text-[9px] tracking-[0.07em] text-text-weaker uppercase">
                  {branchLabel(props.item.branch)}
                </span>
              </Show>
              {SCENARIO_STEP_LABELS[step().kind]}
              <Show when={props.issue}>
                <Icon
                  name={props.issue!.tone === "blocker" ? "alert" : "info"}
                  size={11}
                  class={
                    props.issue!.tone === "blocker"
                      ? "text-icon-critical-base"
                      : "text-icon-warning-base"
                  }
                />
              </Show>
            </span>
            <span class="mt-0.5 block truncate text-[11px] text-text-weak">
              {scenarioStepSummary(props.map, step())}
            </span>
          </span>
        </button>
        <details
          class="group relative border-l border-border-weak-base"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.currentTarget.removeAttribute("open");
            event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
          }}
        >
          <summary
            class="grid min-h-12 min-w-11 cursor-pointer list-none place-items-center rounded-r-[9px] text-text-weak hover:bg-surface-base-hover hover:text-text-strong focus-visible:z-[1] focus-visible:outline-2 focus-visible:outline-border-strong-focus"
            aria-label={`Actions for ${rowLabel()}`}
            onClick={(event) =>
              event.currentTarget.closest("li")?.scrollIntoView({ block: "center" })
            }
          >
            <Icon name="more" size={14} />
          </summary>
          <div class="absolute top-[calc(100%+4px)] right-0 z-30 grid w-48 rounded-lg border border-border-strong-base bg-background-base p-1 shadow-[var(--shadow-lg)]">
            <button
              type="button"
              class={iconButton}
              aria-label={`Move ${rowLabel()} up within ${branchLabel(props.item.branch)}`}
              disabled={props.item.index === 0}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                props.onMove(step().id, -1);
              }}
            >
              <Icon name="chevron-up" size={13} /> Move up
            </button>
            <button
              type="button"
              class={iconButton}
              aria-label={`Move ${rowLabel()} down within ${branchLabel(props.item.branch)}`}
              disabled={props.item.index === props.item.siblingCount - 1}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                props.onMove(step().id, 1);
              }}
            >
              <Icon name="chevron-down" size={13} /> Move down
            </button>
            <button
              type="button"
              class={iconButton}
              aria-label={`Duplicate ${rowLabel()}`}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                props.onDuplicate(step().id);
              }}
            >
              <Icon name="copy" size={13} /> Duplicate
            </button>
            <button
              type="button"
              class={cn(iconButton, "text-text-critical-base hover:text-icon-critical-base")}
              aria-label={`Delete ${rowLabel()}`}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                props.onDelete(step().id);
              }}
            >
              <Icon name="trash" size={13} /> Delete…
            </button>
          </div>
        </details>
      </div>
      <Show when={canNest() && step().kind === "decision"}>
        <BranchAdd parentId={step().id} branch="then" onAdd={props.onAddChild} />
        <BranchAdd parentId={step().id} branch="else" onAdd={props.onAddChild} />
      </Show>
      <Show when={canNest() && step().kind === "loop"}>
        <BranchAdd parentId={step().id} branch="loop" onAdd={props.onAddChild} />
      </Show>
    </li>
  );
}

function BranchAdd(props: {
  parentId: string;
  branch: Exclude<ScenarioStepBranch, "root">;
  onAdd: (
    parentStepId: string,
    branch: Exclude<ScenarioStepBranch, "root">,
    kind: ScenarioStepKind,
  ) => void;
}) {
  const [kind, setKind] = createSignal<ScenarioStepKind>("instruction");
  return (
    <details class="ml-4 rounded-lg border border-dashed border-border-weak-base bg-background-base">
      <summary class="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-[11px] font-semibold text-text-weak focus-visible:outline-2 focus-visible:outline-border-strong-focus">
        <Icon name="plus" size={12} /> Add to {branchLabel(props.branch)}
      </summary>
      <AddStepForm
        compact
        label={`Step in ${branchLabel(props.branch)}`}
        kind={kind()}
        onKindChange={setKind}
        onAdd={(nextKind) => props.onAdd(props.parentId, props.branch, nextKind)}
      />
    </details>
  );
}

function AddStepForm(props: {
  label: string;
  kind: ScenarioStepKind;
  compact?: boolean;
  onKindChange: (kind: ScenarioStepKind) => void;
  onAdd: (kind: ScenarioStepKind) => void;
}) {
  return (
    <form
      class={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] gap-2 p-3",
        props.compact ? "border-t border-border-weak-base" : "border-t border-border-weak-base",
      )}
      onSubmit={(event) => {
        event.preventDefault();
        props.onAdd(props.kind);
      }}
    >
      <label class="grid gap-1">
        <span class={testEditorLabel}>{props.label}</span>
        <select
          class={testEditorInput}
          value={props.kind}
          onChange={(event) => props.onKindChange(event.currentTarget.value as ScenarioStepKind)}
        >
          <For each={SCENARIO_STEP_KINDS}>
            {(kind) => <option value={kind}>{SCENARIO_STEP_LABELS[kind]}</option>}
          </For>
        </select>
      </label>
      <Button type="submit" class="mt-[19px] min-h-11" aria-label={`Add ${props.label}`}>
        <Icon name="plus" size={13} /> {props.compact ? "Add" : "Add step"}
      </Button>
    </form>
  );
}

function branchLabel(branch: ScenarioStepBranch): string {
  if (branch === "then") return "Then";
  if (branch === "else") return "Else";
  if (branch === "loop") return "Loop body";
  return "test";
}

function branchGlyph(branch: ScenarioStepBranch): string {
  if (branch === "then") return "T";
  if (branch === "else") return "E";
  return "↻";
}
