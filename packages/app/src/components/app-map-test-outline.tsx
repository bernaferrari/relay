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
  "grid min-h-11 min-w-11 place-items-center rounded-lg text-text-weak transition-[background-color,color,transform] hover:bg-surface-base-hover hover:text-text-strong active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-border-strong-focus disabled:cursor-not-allowed disabled:text-text-weaker";

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
  const outline = () => flattenScenarioSteps(props.test.steps);

  return (
    <>
      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <ol class="m-0 grid list-none gap-2 p-0" aria-label="Test steps">
          <For each={outline()}>
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
          "rounded-[11px] border bg-surface-base transition-[border-color,background-color]",
          props.selected
            ? "border-border-interactive-base bg-[var(--product-accent-soft)]"
            : "border-border-weak-base",
        )}
      >
        <button
          type="button"
          id={`test-step-row-${step().id}`}
          data-step-row={step().id}
          class="grid min-h-11 w-full grid-cols-[32px_minmax(0,1fr)] items-center gap-2 rounded-[10px] px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-border-strong-focus"
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
          <span class="grid size-8 place-items-center rounded-lg bg-background-base text-[10px] font-semibold tabular-nums text-text-interactive-base">
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
        <div class="flex justify-end border-t border-border-weak-base px-1">
          <button
            type="button"
            class={iconButton}
            aria-label={`Move ${rowLabel()} up within ${branchLabel(props.item.branch)}`}
            disabled={props.item.index === 0}
            onClick={() => props.onMove(step().id, -1)}
          >
            <Icon name="chevron-up" size={13} />
          </button>
          <button
            type="button"
            class={iconButton}
            aria-label={`Move ${rowLabel()} down within ${branchLabel(props.item.branch)}`}
            disabled={props.item.index === props.item.siblingCount - 1}
            onClick={() => props.onMove(step().id, 1)}
          >
            <Icon name="chevron-down" size={13} />
          </button>
          <button
            type="button"
            class={iconButton}
            aria-label={`Duplicate ${rowLabel()}`}
            onClick={() => props.onDuplicate(step().id)}
          >
            <Icon name="copy" size={13} />
          </button>
          <button
            type="button"
            class={cn(iconButton, "hover:text-icon-critical-base")}
            aria-label={`Delete ${rowLabel()}`}
            onClick={() => props.onDelete(step().id)}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
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
