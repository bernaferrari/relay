import { For, Show } from "solid-js";
import type { AppMapCapturePolicy, AppMapVariable, CaseExpansionStrategy } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import type { TestCandidate } from "../lib/app-map-combine-candidates";
import type { CombineProjection } from "../lib/app-map-combine-presentation";
import type { RecordedPathCandidate } from "../lib/app-map-reusable-paths";
import { cn } from "../lib/cn";
import { copyDescription, copyStack, copyTitle } from "../lib/ui";
import { AppMapMatrixValuePicker } from "./app-map-matrix-value-picker";
import { Icon } from "./icon";

export type { TestCandidate } from "../lib/app-map-combine-candidates";

export type SimpleCaptureMode = Exclude<AppMapCapturePolicy["mode"], "checkpoints">;

export function candidateKey(candidate: TestCandidate): string {
  return `${candidate.source}:${candidate.id}`;
}

export function defaultCaptureMode(candidate: TestCandidate): SimpleCaptureMode {
  if (candidate.source === "test") {
    const mode = candidate.test.capture?.mode;
    if (mode && mode !== "checkpoints") return mode;
    if (candidate.test.kind !== "scenario" && candidate.test.screenshotEach === false)
      return "none";
  }
  return "every-screen";
}

function candidateDescription(candidate: TestCandidate): string {
  if (candidate.source === "test") {
    return candidate.screenCount
      ? `${candidate.screenCount} mapped ${candidate.screenCount === 1 ? "screen" : "screens"} · reusable test`
      : candidate.kind === "tour"
        ? "Visit mapped screens · reusable test"
        : candidate.kind === "scenario"
          ? "Editable scenario · reusable test"
          : "Saved reusable path";
  }
  if (candidate.source === "flow") {
    return `${candidate.flow.connectionIds.length} recorded ${candidate.flow.connectionIds.length === 1 ? "step" : "steps"} · saved flow`;
  }
  return `${candidate.screenCount} mapped ${candidate.screenCount === 1 ? "screen" : "screens"} · screen tour`;
}

function noReusableTestGuidance(input: {
  screenCount: number;
  draftConnectionCount: number;
  recordedPathCount: number;
}): string {
  if (input.recordedPathCount) {
    return "A recorded transition is map evidence, not a test. Make one reusable below.";
  }
  if (input.draftConnectionCount) {
    return "Finish and keep a recorded transition on the map, then make it reusable here.";
  }
  if (input.screenCount) {
    return "A saved screen is map evidence. Record a tap to another screen, then keep that path.";
  }
  return "Save a first screen, then record a tap to another screen.";
}

function modifierMethodLabel(variable: AppMapVariable): string {
  if (variable.apply.kind === "appLocale") return "Android app language";
  if (variable.apply.kind === "toggle") return "toggle";
  const opensWithPath = Boolean(
    variable.apply.inConnectionId ||
    variable.apply.entryPath?.length ||
    variable.apply.pickerPath?.length,
  );
  const returnsWithPath = Boolean(
    variable.apply.outConnectionId || variable.apply.exitPath?.length,
  );
  if (opensWithPath && returnsWithPath) return "mapped open + return";
  if (opensWithPath) return "mapped list";
  return "visible list labels";
}

export function AppMapCombineHeader(props: {
  headline: string;
  subhead: string;
  onClose: () => void;
}) {
  return (
    <header class="flex items-start gap-3 border-b border-[var(--border-weak-base)] px-4 py-3.5">
      <div class="min-w-0 flex-1">
        <p class="m-0 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-weaker)]">
          Run matrix
        </p>
        <h2 class="m-0 mt-0.5 truncate text-[15px]/[1.25] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
          {props.headline}
        </h2>
        <p class="m-0 mt-0.5 text-[11.5px]/[1.35] text-[var(--text-weak)]">{props.subhead}</p>
      </div>
      <button
        type="button"
        class="grid size-10 shrink-0 place-items-center rounded-[8px] text-[var(--text-weak)] hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
        aria-label="Close run matrix"
        onClick={props.onClose}
      >
        <Icon name="x" size={14} />
      </button>
    </header>
  );
}

export function AppMapCombineStrategy(props: {
  modifierCount: number;
  strategy: CaseExpansionStrategy;
  onChange: (strategy: CaseExpansionStrategy) => void;
}) {
  return (
    <Show when={props.modifierCount > 1}>
      <section class="grid gap-2" aria-labelledby="coverage-title">
        <div class={copyStack}>
          <h3 id="coverage-title" class={cn(copyTitle, "m-0 text-[12px] font-semibold")}>
            2. Multiply modifiers
          </h3>
          <p class={cn(copyDescription, "m-0 text-[10.5px]")}>
            Choose whether every value meets every other value.
          </p>
        </div>
        <div
          class={cn(
            "grid gap-1 rounded-[9px] bg-[var(--surface-base)] p-1",
            props.modifierCount > 2 ? "grid-cols-3" : "grid-cols-2",
          )}
          role="radiogroup"
          aria-label="Value coverage"
        >
          <StrategyButton
            active={props.strategy === "cartesian"}
            label="Every combination"
            onClick={() => props.onChange("cartesian")}
          />
          <StrategyButton
            active={props.strategy === "zip"}
            label="Match rows"
            onClick={() => props.onChange("zip")}
          />
          <Show when={props.modifierCount > 2}>
            <StrategyButton
              active={props.strategy === "pairwise"}
              label="Every pair"
              tip="Cover every pair of values with fewer device runs"
              onClick={() => props.onChange("pairwise")}
            />
          </Show>
        </div>
      </section>
    </Show>
  );
}

export function AppMapCombinePlan(props: {
  variables: AppMapVariable[];
  selectedVariableIds: string[];
  selectedVariables: AppMapVariable[];
  valuesFor: (variable: AppMapVariable) => string[];
  editingValuesFor?: string;
  candidates: TestCandidate[];
  selectedTestKeys: string[];
  selectedTests: TestCandidate[];
  recordedPaths: RecordedPathCandidate[];
  draftConnectionCount: number;
  screenCount: number;
  promotingRecordedPathId?: string;
  captureModes: Record<string, SimpleCaptureMode>;
  strategy: CaseExpansionStrategy;
  projection: CombineProjection;
  busy: boolean;
  canRunOnDevice: boolean;
  onCreateModifier: () => void;
  onEditModifier: (id: string) => void;
  onToggleVariable: (variable: AppMapVariable) => void;
  onToggleValues: (id?: string) => void;
  onValuesChange: (variableId: string, ids: string[]) => void;
  onStrategyChange: (strategy: CaseExpansionStrategy) => void;
  onToggleTest: (candidate: TestCandidate) => void;
  onMakeRecordedPathReusable: (candidate: RecordedPathCandidate) => void;
  onCaptureModeChange: (candidate: TestCandidate, mode: SimpleCaptureMode) => void;
  onRunCell: (worldIndex: number, test: TestCandidate) => void;
}) {
  return (
    <>
      <section
        class="grid scroll-mt-3 gap-2 outline-none"
        aria-labelledby="matrix-states-title"
        data-matrix-section="modifiers"
        tabIndex={-1}
      >
        <div class="flex min-h-8 items-center justify-between gap-2">
          <div class={copyStack}>
            <h3 id="matrix-states-title" class={cn(copyTitle, "m-0 text-[12px] font-semibold")}>
              1. Choose modifiers
            </h3>
            <p class={cn(copyDescription, "m-0 text-[10.5px]")}>
              A modifier changes one thing, then returns to the test start.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={props.onCreateModifier}>
            <Icon name="plus" size={12} /> New modifier
          </Button>
        </div>

        <Show
          when={props.variables.length}
          fallback={
            <button
              type="button"
              class="grid min-h-20 place-items-center rounded-[10px] border border-dashed border-[var(--border-strong-base)] px-4 text-center hover:bg-[var(--surface-base-hover)]"
              onClick={props.onCreateModifier}
            >
              <span class={cn(copyStack, "items-center")}>
                <strong class={cn(copyTitle, "block text-[12px]")}>
                  Create the first modifier
                </strong>
                <span class={cn(copyDescription, "block text-[10.5px]")}>
                  Teach Relay a language, account, theme, model, or another list.
                </span>
              </span>
            </button>
          }
        >
          <div class="grid gap-1">
            <For each={props.variables}>
              {(variable) => {
                const selected = () => props.selectedVariableIds.includes(variable.id);
                const editing = () => props.editingValuesFor === variable.id && selected();
                return (
                  <div class={cn("rounded-[9px]", selected() && "bg-[var(--surface-base)]")}>
                    <div class="flex min-h-11 items-center gap-1 px-1.5">
                      <button
                        type="button"
                        class="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-[7px] px-1.5 text-left hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                        aria-pressed={selected()}
                        onClick={() => props.onToggleVariable(variable)}
                      >
                        <SelectionMark selected={selected()} />
                        <span class={cn(copyStack, "flex-1")}>
                          <strong class={cn(copyTitle, "block truncate text-[11.5px] font-medium")}>
                            {variable.name}
                          </strong>
                          <span class={cn(copyDescription, "block text-[10px] tabular-nums")}>
                            {props.valuesFor(variable).length} of {variable.options.length} values ·{" "}
                            {modifierMethodLabel(variable)}
                          </span>
                        </span>
                      </button>
                      <Show when={selected()}>
                        <button
                          type="button"
                          class="grid size-10 shrink-0 place-items-center rounded-[7px] text-[var(--text-weak)] hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                          aria-label={`${editing() ? "Hide" : "Choose"} ${variable.name} values`}
                          aria-expanded={editing()}
                          onClick={() => props.onToggleValues(editing() ? undefined : variable.id)}
                        >
                          <Icon name={editing() ? "chevron-up" : "sliders"} size={12} />
                        </button>
                      </Show>
                      <Show
                        when={variable.apply.kind === "list" || variable.apply.kind === "appLocale"}
                      >
                        <button
                          type="button"
                          class="grid size-10 shrink-0 place-items-center rounded-[7px] text-[var(--text-weak)] hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                          aria-label={`Edit ${variable.name} modifier`}
                          data-tip={`Edit ${variable.name}`}
                          onClick={() => props.onEditModifier(variable.id)}
                        >
                          <Icon name="edit" size={12} />
                        </button>
                      </Show>
                    </div>
                    <Show when={editing()}>
                      <AppMapMatrixValuePicker
                        variable={variable}
                        selectedIds={props.valuesFor(variable)}
                        onChange={(ids) => props.onValuesChange(variable.id, ids)}
                      />
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </section>

      <AppMapCombineStrategy
        modifierCount={props.selectedVariables.length}
        strategy={props.strategy}
        onChange={props.onStrategyChange}
      />

      <Show when={props.selectedVariables.length}>
        <section
          class="grid scroll-mt-3 gap-2 outline-none"
          aria-labelledby="matrix-tests-title"
          data-matrix-section="tests"
          tabIndex={-1}
        >
          <div class={copyStack}>
            <h3 id="matrix-tests-title" class={cn(copyTitle, "m-0 text-[12px] font-semibold")}>
              {props.selectedVariables.length > 1 ? "3" : "2"}. Choose tests
            </h3>
            <p class={cn(copyDescription, "m-0 text-[10.5px]")}>
              Choose a reusable test. A saved flow becomes one when you save this matrix.
            </p>
          </div>
          <Show
            when={props.candidates.length}
            fallback={
              <div
                class={cn(
                  copyStack,
                  "items-center rounded-[9px] bg-[var(--surface-base)] px-3 py-4 text-center",
                )}
              >
                <strong class={cn(copyTitle, "block text-[12px]")}>No reusable test yet</strong>
                <span class={cn(copyDescription, "block text-[10.5px]")}>
                  {noReusableTestGuidance({
                    screenCount: props.screenCount,
                    draftConnectionCount: props.draftConnectionCount,
                    recordedPathCount: props.recordedPaths.length,
                  })}
                </span>
              </div>
            }
          >
            <div class="grid gap-1">
              <For each={props.candidates}>
                {(candidate) => {
                  const selected = () => props.selectedTestKeys.includes(candidateKey(candidate));
                  const mode = () =>
                    props.captureModes[candidateKey(candidate)] ?? defaultCaptureMode(candidate);
                  return (
                    <div
                      class={cn(
                        "flex min-h-11 items-center gap-2 rounded-[8px] px-2.5 text-left hover:bg-[var(--surface-base-hover)]",
                        selected() && "bg-[var(--surface-base)]",
                      )}
                    >
                      <button
                        type="button"
                        class="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-[7px] text-left focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                        aria-pressed={selected()}
                        onClick={() => props.onToggleTest(candidate)}
                      >
                        <SelectionMark selected={selected()} />
                        <span class={cn(copyStack, "min-w-0 flex-1")}>
                          <strong class={cn(copyTitle, "block truncate text-[11.5px] font-medium")}>
                            {candidate.name}
                          </strong>
                          <span class={cn(copyDescription, "block text-[10px]")}>
                            {candidateDescription(candidate)}
                          </span>
                        </span>
                      </button>
                      <Show when={selected()}>
                        <label class="grid shrink-0 gap-0.5 text-[9px] font-medium text-[var(--text-weak)]">
                          Screenshots
                          <select
                            class="h-8 rounded-[7px] border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2 text-[10.5px] text-[var(--text-base)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                            value={mode()}
                            aria-label={`Screenshots for ${candidate.name}`}
                            onChange={(event) =>
                              props.onCaptureModeChange(
                                candidate,
                                event.currentTarget.value as SimpleCaptureMode,
                              )
                            }
                          >
                            <option value="every-screen">Every screen</option>
                            <option value="final-screen">Final screen</option>
                            <option value="failures-only">Failures only</option>
                            <option value="none">None</option>
                          </select>
                        </label>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
          <Show when={props.recordedPaths.length}>
            <section
              class="mt-2 grid gap-1.5 rounded-[9px] border border-[var(--border-weak-base)] bg-[var(--surface-base)] p-2"
              aria-label="Recorded paths ready to make reusable"
            >
              <div class={cn(copyStack, "px-1 pt-0.5")}>
                <h4 class={cn(copyTitle, "m-0 text-[11px] font-semibold")}>Recorded paths</h4>
                <p class={cn(copyDescription, "m-0 text-[10px]")}>
                  Make one reusable once; then it can be selected in any run matrix.
                </p>
              </div>
              <For each={props.recordedPaths}>
                {(recording) => {
                  const promoting = () => props.promotingRecordedPathId === recording.id;
                  return (
                    <div class="flex min-h-11 items-center gap-2 rounded-[7px] px-1.5 hover:bg-[var(--surface-base-hover)]">
                      <span class={cn(copyStack, "min-w-0 flex-1")}>
                        <strong class={cn(copyTitle, "block truncate text-[11px] font-medium")}>
                          {recording.name}
                        </strong>
                        <span class={cn(copyDescription, "block text-[9.5px]")}>
                          {recording.connectionIds.length} recorded{" "}
                          {recording.connectionIds.length === 1 ? "step" : "steps"}
                        </span>
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        class="shrink-0"
                        disabled={props.busy || promoting()}
                        onClick={() => props.onMakeRecordedPathReusable(recording)}
                      >
                        {promoting() ? "Making…" : "Make reusable"}
                      </Button>
                    </div>
                  );
                }}
              </For>
            </section>
          </Show>
        </section>
      </Show>

      <Show when={props.selectedVariables.length && props.selectedTests.length}>
        <section
          class="grid scroll-mt-3 gap-2 outline-none"
          aria-labelledby="matrix-preview-title"
          data-matrix-section="plan"
          tabIndex={-1}
        >
          <div class="flex items-end justify-between gap-2">
            <div class={copyStack}>
              <h3 id="matrix-preview-title" class={cn(copyTitle, "m-0 text-[12px] font-semibold")}>
                Run plan
              </h3>
              <p class={cn(copyDescription, "m-0 text-[10.5px]")}>
                Rows are modifier combinations. Columns are reusable tests.
              </p>
            </div>
            <span class="shrink-0 text-[10px] tabular-nums text-[var(--text-weak)]">
              {props.projection.cellCount} checks
              {props.projection.truncated
                ? ` · first ${props.projection.worlds.length} rows shown`
                : ""}
            </span>
          </div>
          <Show
            when={!props.projection.issue}
            fallback={
              <p class="m-0 rounded-[8px] bg-[var(--surface-warning-weak,var(--surface-base))] px-2.5 py-2 text-[11px] text-[var(--text-warning-base,var(--text-base))]">
                {props.projection.issue}
              </p>
            }
          >
            <div
              class="max-h-72 overflow-auto overscroll-contain rounded-[9px] border border-[var(--border-weak-base)]"
              onWheel={(event) => event.stopPropagation()}
            >
              <table class="w-full min-w-[360px] border-collapse text-left">
                <thead class="sticky top-0 z-[2] bg-[var(--surface-raised-stronger-non-alpha)]">
                  <tr class="border-b border-[var(--border-weak-base)]">
                    <th class="sticky left-0 z-[3] min-w-40 bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 py-2 text-[10px] font-medium text-[var(--text-weak)]">
                      Modifiers
                    </th>
                    <For each={props.selectedTests}>
                      {(test) => (
                        <th class="min-w-28 px-2 py-2 text-[10px] font-medium text-[var(--text-weak)]">
                          {test.name}
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={props.projection.worlds}>
                    {(world, worldIndex) => (
                      <tr class="border-b border-[var(--border-weak-base)] last:border-b-0">
                        <th class="sticky left-0 z-[1] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 py-2 text-[10.5px] font-medium text-[var(--text-strong)]">
                          {world.label}
                        </th>
                        <For each={props.selectedTests}>
                          {(test) => (
                            <td class="px-1.5 py-1">
                              <button
                                type="button"
                                class="grid min-h-9 w-full place-items-center rounded-[7px] text-[var(--text-interactive-base)] hover:bg-[var(--product-accent-soft)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)] disabled:text-[var(--text-weaker)]"
                                data-tip={
                                  props.canRunOnDevice
                                    ? undefined
                                    : "Connect a ready device to run this check"
                                }
                                disabled={props.busy || !props.canRunOnDevice}
                                aria-label={`Run ${test.name} in ${world.label}`}
                                onClick={() => props.onRunCell(worldIndex(), test)}
                              >
                                <Icon name="play" size={11} />
                              </button>
                            </td>
                          )}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </section>
      </Show>
    </>
  );
}

function SelectionMark(props: { selected: boolean }) {
  return (
    <span
      class={cn(
        "grid size-4 shrink-0 place-items-center rounded-[4px] border",
        props.selected
          ? "border-[var(--text-interactive-base)] bg-[var(--text-interactive-base)] text-[var(--button-primary-foreground,var(--icon-invert-base))]"
          : "border-[var(--border-strong-base)]",
      )}
    >
      <Show when={props.selected}>
        <Icon name="check" size={9} />
      </Show>
    </span>
  );
}

function StrategyButton(props: {
  active: boolean;
  label: string;
  tip?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class={cn(
        "min-h-10 rounded-[7px] px-2 text-[11px] font-medium",
        props.active
          ? "bg-[var(--surface-raised-stronger-non-alpha)] text-[var(--text-strong)] shadow-[var(--shadow-xs-border-base)]"
          : "text-[var(--text-weak)] hover:text-[var(--text-strong)]",
      )}
      role="radio"
      aria-checked={props.active}
      data-tip={props.tip}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

export function AppMapCombineFooter(props: {
  canDelete: boolean;
  combinations: number;
  testCount: number;
  cellCount: number;
  canRunOnDevice: boolean;
  issue: string;
  busy: boolean;
  savingOnly: boolean;
  onDelete: () => void;
  onSave: () => void;
  onRun: () => void;
}) {
  return (
    <footer class="flex items-center justify-between gap-3 border-t border-[var(--border-weak-base)] px-4 py-3">
      <div class="flex min-w-0 items-center gap-2">
        <Show when={props.canDelete}>
          <Button
            variant="ghost"
            size="sm"
            class="shrink-0 text-[var(--icon-critical-base)] hover:text-[var(--icon-critical-base)]"
            disabled={props.busy}
            onClick={props.onDelete}
          >
            <Icon name="trash" size={11} /> Delete
          </Button>
        </Show>
        <span class="min-w-0 truncate text-[10.5px] text-[var(--text-weak)]">
          {props.combinations} combinations × {props.testCount} tests
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button
          variant="secondary"
          size="lg"
          disabled={props.busy || Boolean(props.issue)}
          onClick={props.onSave}
        >
          {props.savingOnly ? "Saving…" : "Save"}
        </Button>
        <Button
          variant="primary"
          size="lg"
          data-tip={props.canRunOnDevice ? undefined : "Connect a ready device to run this matrix"}
          disabled={props.busy || Boolean(props.issue) || !props.canRunOnDevice}
          onClick={props.onRun}
        >
          <Icon name="play" size={12} />
          {props.busy && !props.savingOnly
            ? "Starting…"
            : props.cellCount
              ? `Run ${props.cellCount} ${props.cellCount === 1 ? "check" : "checks"}`
              : "Run matrix"}
        </Button>
      </div>
    </footer>
  );
}
