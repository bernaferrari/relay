import { For, Show } from "solid-js";
import type {
  AppMapCapturePolicy,
  AppMapCombineCellRuntimeProfile,
  AppMapVariable,
  CaseExpansionStrategy,
} from "@relay/protocol";
import { bindingForCell } from "../lib/app-map-combine-profiles";
import type { CombineRuntimeProfileOption } from "../lib/app-map-combine-profiles";
import { Button } from "@relay/ui/button";
import type { TestCandidate } from "../lib/app-map-combine-candidates";
import type { CombineProjection } from "../lib/app-map-combine-presentation";
import { cn } from "../lib/cn";
import { copyDescription, copyStack, copyTitle } from "../lib/ui";
import { AppMapMatrixValuePicker } from "./app-map-matrix-value-picker";
import { Icon } from "./icon";

export type { TestCandidate } from "../lib/app-map-combine-candidates";

export type SimpleCaptureMode = Exclude<AppMapCapturePolicy["mode"], "checkpoints">;

export function candidateKey(candidate: TestCandidate): string {
  return `test:${candidate.id}`;
}

export function defaultCaptureMode(candidate: TestCandidate): SimpleCaptureMode {
  if (candidate.source === "test") {
    const mode = candidate.test.capture?.mode;
    if (mode && mode !== "checkpoints") return mode;
  }
  return "every-screen";
}

function candidateDescription(candidate: TestCandidate): string {
  const count = candidate.test.steps.length;
  return `${count} ${count === 1 ? "step" : "steps"} · graph Test`;
}

function variableMethodLabel(variable: AppMapVariable): string {
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
        <p class="m-0 text-micro font-semibold uppercase tracking-[0.06em] text-[var(--text-weaker)]">
          Combine
        </p>
        <h2 class="m-0 mt-0.5 truncate text-title/[1.25] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
          {props.headline}
        </h2>
        <p class="m-0 mt-0.5 text-caption/[1.35] text-[var(--text-weak)]">{props.subhead}</p>
      </div>
      <button
        type="button"
        class="grid size-10 shrink-0 place-items-center rounded-lg text-[var(--text-weak)] hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
        aria-label="Close combine"
        onClick={props.onClose}
      >
        <Icon name="x" size={14} />
      </button>
    </header>
  );
}

export function AppMapCombineStrategy(props: {
  variableCount: number;
  strategy: CaseExpansionStrategy;
  onChange: (strategy: CaseExpansionStrategy) => void;
}) {
  return (
    <Show when={props.variableCount > 1}>
      <section class="grid gap-2" aria-labelledby="coverage-title">
        <div class={copyStack}>
          <h3 id="coverage-title" class={cn(copyTitle, "m-0 text-caption font-semibold")}>
            2. Multiply variables
          </h3>
          <p class={cn(copyDescription, "m-0 text-micro")}>
            Choose whether every value meets every other value.
          </p>
        </div>
        <div
          class={cn(
            "grid gap-1 rounded-xl bg-[var(--surface-base)] p-1",
            props.variableCount > 2 ? "grid-cols-3" : "grid-cols-2",
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
          <Show when={props.variableCount > 2}>
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
  captureModes: Record<string, SimpleCaptureMode>;
  strategy: CaseExpansionStrategy;
  projection: CombineProjection;
  busy: boolean;
  canRunOnDevice: boolean;
  cellRuntimeProfiles: AppMapCombineCellRuntimeProfile[];
  runtimeProfiles: CombineRuntimeProfileOption[];
  onBindCell: (testId: string, values: Record<string, string>, targetProfileId: string) => void;
  onCreateVariable: () => void;
  onEditVariable: (id: string) => void;
  onToggleVariable: (variable: AppMapVariable) => void;
  onToggleValues: (id?: string) => void;
  onValuesChange: (variableId: string, ids: string[]) => void;
  onStrategyChange: (strategy: CaseExpansionStrategy) => void;
  onToggleTest: (candidate: TestCandidate) => void;
  onCaptureModeChange: (candidate: TestCandidate, mode: SimpleCaptureMode) => void;
  onRunCell: (worldIndex: number, test: TestCandidate) => void;
}) {
  return (
    <>
      <section
        class="grid scroll-mt-3 gap-2 outline-none"
        aria-labelledby="combine-variables-title"
        data-combine-section="variables"
        tabIndex={-1}
      >
        <div class="flex min-h-8 items-center justify-between gap-2">
          <div class={copyStack}>
            <h3
              id="combine-variables-title"
              class={cn(copyTitle, "m-0 text-caption font-semibold")}
            >
              1. Choose Variables
            </h3>
            <p class={cn(copyDescription, "m-0 text-micro")}>
              A Variable changes one thing, then returns to the Test start.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={props.onCreateVariable}>
            <Icon name="plus" size={12} /> New Variable
          </Button>
        </div>

        <Show
          when={props.variables.length}
          fallback={
            <button
              type="button"
              class="grid min-h-20 place-items-center rounded-xl border border-dashed border-[var(--border-strong-base)] px-4 text-center hover:bg-[var(--surface-base-hover)]"
              onClick={props.onCreateVariable}
            >
              <span class={cn(copyStack, "items-center")}>
                <strong class={cn(copyTitle, "block text-caption")}>
                  Create the first Variable
                </strong>
                <span class={cn(copyDescription, "block text-micro")}>
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
                  <div class={cn("rounded-xl", selected() && "bg-[var(--surface-base)]")}>
                    <div class="flex min-h-11 items-center gap-1 px-1.5">
                      <button
                        type="button"
                        class="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-left hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                        aria-pressed={selected()}
                        onClick={() => props.onToggleVariable(variable)}
                      >
                        <SelectionMark selected={selected()} />
                        <span class={cn(copyStack, "flex-1")}>
                          <strong class={cn(copyTitle, "block truncate text-caption font-medium")}>
                            {variable.name}
                          </strong>
                          <span class={cn(copyDescription, "block text-micro tabular-nums")}>
                            {props.valuesFor(variable).length} of {variable.options.length} values ·{" "}
                            {variableMethodLabel(variable)}
                          </span>
                        </span>
                      </button>
                      <Show when={selected()}>
                        <button
                          type="button"
                          class="grid size-10 shrink-0 place-items-center rounded-lg text-[var(--text-weak)] hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
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
                          class="grid size-10 shrink-0 place-items-center rounded-lg text-[var(--text-weak)] hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                          aria-label={`Edit ${variable.name} variable`}
                          data-tip={`Edit ${variable.name}`}
                          onClick={() => props.onEditVariable(variable.id)}
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
        variableCount={props.selectedVariables.length}
        strategy={props.strategy}
        onChange={props.onStrategyChange}
      />

      <Show when={props.selectedVariables.length}>
        <section
          class="grid scroll-mt-3 gap-2 outline-none"
          aria-labelledby="combine-tests-title"
          data-combine-section="tests"
          tabIndex={-1}
        >
          <div class={copyStack}>
            <h3 id="combine-tests-title" class={cn(copyTitle, "m-0 text-caption font-semibold")}>
              {props.selectedVariables.length > 1 ? "3" : "2"}. Choose Tests
            </h3>
            <p class={cn(copyDescription, "m-0 text-micro")}>
              Choose one or more saved graph Tests.
            </p>
          </div>
          <Show
            when={props.candidates.length}
            fallback={
              <div
                class={cn(
                  copyStack,
                  "items-center rounded-xl bg-[var(--surface-base)] px-3 py-4 text-center",
                )}
              >
                <strong class={cn(copyTitle, "block text-caption")}>No reusable test yet</strong>
                <span class={cn(copyDescription, "block text-micro")}>
                  Create a Test in the Test editor, then return here to add it to this matrix.
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
                        "flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-left hover:bg-[var(--surface-base-hover)]",
                        selected() && "bg-[var(--surface-base)]",
                      )}
                    >
                      <button
                        type="button"
                        class="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                        aria-pressed={selected()}
                        onClick={() => props.onToggleTest(candidate)}
                      >
                        <SelectionMark selected={selected()} />
                        <span class={cn(copyStack, "min-w-0 flex-1")}>
                          <strong class={cn(copyTitle, "block truncate text-caption font-medium")}>
                            {candidate.name}
                          </strong>
                          <span class={cn(copyDescription, "block text-micro")}>
                            {candidateDescription(candidate)}
                          </span>
                        </span>
                      </button>
                      <Show when={selected()}>
                        <label class="grid shrink-0 gap-0.5 text-micro font-medium text-[var(--text-weak)]">
                          Screenshots
                          <select
                            class="h-8 rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2 text-micro text-[var(--text-base)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
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
        </section>
      </Show>

      <Show when={props.selectedVariables.length && props.selectedTests.length}>
        <section
          class="grid scroll-mt-3 gap-2 outline-none"
          aria-labelledby="combine-plan-title"
          data-combine-section="plan"
          tabIndex={-1}
        >
          <div class="flex items-end justify-between gap-2">
            <div class={copyStack}>
              <h3 id="combine-plan-title" class={cn(copyTitle, "m-0 text-caption font-semibold")}>
                Run plan
              </h3>
              <p class={cn(copyDescription, "m-0 text-micro")}>
                Rows are Variable combinations. Columns are reusable Tests.
              </p>
            </div>
            <span class="shrink-0 text-micro tabular-nums text-[var(--text-weak)]">
              {props.projection.cellCount} checks
              {props.projection.truncated
                ? ` · first ${props.projection.worlds.length} rows shown`
                : ""}
            </span>
          </div>
          <Show
            when={!props.projection.issue}
            fallback={
              <p class="m-0 rounded-lg bg-[var(--surface-warning-weak,var(--surface-base))] px-2.5 py-2 text-caption text-[var(--text-warning-base,var(--text-base))]">
                {props.projection.issue}
              </p>
            }
          >
            <div
              class="max-h-72 overflow-auto overscroll-contain rounded-xl border border-[var(--border-weak-base)]"
              onWheel={(event) => event.stopPropagation()}
            >
              <table class="w-full min-w-[360px] border-collapse text-left">
                <thead class="sticky top-0 z-[2] bg-[var(--surface-raised-stronger-non-alpha)]">
                  <tr class="border-b border-[var(--border-weak-base)]">
                    <th class="sticky left-0 z-[3] min-w-40 bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 py-2 text-micro font-medium text-[var(--text-weak)]">
                      Variables
                    </th>
                    <For each={props.selectedTests}>
                      {(test) => (
                        <th class="min-w-28 px-2 py-2 text-micro font-medium text-[var(--text-weak)]">
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
                        <th class="sticky left-0 z-[1] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 py-2 text-micro font-medium text-[var(--text-strong)]">
                          {world.label}
                        </th>
                        <For each={props.selectedTests}>
                          {(test) => {
                            const values = Object.fromEntries(
                              Object.entries(world.values).map(([id, value]) => [id, value.id]),
                            );
                            const binding = bindingForCell(
                              props.cellRuntimeProfiles,
                              test.id,
                              values,
                            );
                            const profile = props.runtimeProfiles.find(
                              (item) => item.id === binding?.targetProfileId,
                            );
                            const status = binding
                              ? `Bound to ${profile?.name ?? binding.targetProfileId}`
                              : "No runtime profile";
                            return (
                              <td class="px-1.5 py-1">
                                <div class="grid gap-1">
                                  <label class="grid gap-0.5">
                                    <span class="text-micro text-[var(--text-weak)]">{status}</span>
                                    <select
                                      class="h-8 rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-1.5 text-micro text-[var(--text-base)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                                      value={binding?.targetProfileId ?? ""}
                                      aria-label={`Runtime profile for ${test.name} in ${world.label}`}
                                      disabled={props.busy || !props.runtimeProfiles.length}
                                      onChange={(event) =>
                                        props.onBindCell(test.id, values, event.currentTarget.value)
                                      }
                                    >
                                      <option value="">Choose profile</option>
                                      <For each={props.runtimeProfiles}>
                                        {(item) => (
                                          <option value={item.id}>
                                            {item.name} · {item.platform}
                                          </option>
                                        )}
                                      </For>
                                    </select>
                                  </label>
                                  <button
                                    type="button"
                                    class="grid min-h-9 w-full place-items-center rounded-lg text-[var(--text-interactive-base)] hover:bg-[var(--product-accent-soft)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)] disabled:text-[var(--text-weaker)]"
                                    data-tip={
                                      !binding
                                        ? "Bind a runtime profile before running this cell"
                                        : props.canRunOnDevice
                                          ? undefined
                                          : "Connect a ready device to run this check"
                                    }
                                    disabled={props.busy || !props.canRunOnDevice || !binding}
                                    aria-label={`Run ${test.name} in ${world.label}. ${status}.`}
                                    onClick={() => props.onRunCell(worldIndex(), test)}
                                  >
                                    <Icon name="play" size={11} />
                                  </button>
                                </div>
                              </td>
                            );
                          }}
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
        "grid size-4 shrink-0 place-items-center rounded border",
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
        "min-h-10 rounded-lg px-2 text-caption font-medium",
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
  saveIssue?: string;
  busy: boolean;
  savingOnly: boolean;
  onDelete: () => void;
  onSave: () => void;
  onRun: () => void;
  pilot?: boolean;
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
        <span class="min-w-0 truncate text-micro tabular-nums text-[var(--text-weak)]">
          {props.combinations} {props.combinations === 1 ? "combination" : "combinations"} ×{" "}
          {props.testCount} {props.testCount === 1 ? "Test" : "Tests"}
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button
          variant="secondary"
          size="lg"
          disabled={props.busy || Boolean(props.saveIssue)}
          onClick={props.onSave}
        >
          {props.savingOnly ? "Saving…" : "Save"}
        </Button>
        <Button
          variant="primary"
          size="lg"
          data-tip={props.canRunOnDevice ? undefined : "Connect a ready device to run this combine"}
          disabled={props.busy || Boolean(props.issue) || !props.canRunOnDevice}
          onClick={props.onRun}
        >
          <Icon name="play" size={12} />
          {props.busy && !props.savingOnly
            ? "Starting…"
            : props.pilot
              ? "Run pilot"
              : props.cellCount
                ? `Run ${props.cellCount} ${props.cellCount === 1 ? "check" : "checks"}`
                : "Run Combine"}
        </Button>
      </div>
    </footer>
  );
}
