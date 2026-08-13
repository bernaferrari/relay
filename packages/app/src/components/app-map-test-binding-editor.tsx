import { For, Show } from "solid-js";
import type { AppMap, AppMapScenarioTestStep } from "@relay/protocol";
import { cn } from "../lib/cn";
import { resolveScenarioBinding, scenarioBindingField } from "../lib/app-map-test-editor-model";
import { Icon } from "./icon";

export const testEditorInput =
  "min-h-11 w-full rounded-lg border border-border-weak-base bg-background-base px-3 text-[16px] text-text-strong outline-none transition-[border-color,box-shadow] focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-surface-info-weak";
export const testEditorLabel = "text-[11px] font-semibold text-text-base";

export function AppMapTestBindingEditor(props: {
  map: AppMap;
  step: AppMapScenarioTestStep;
  onChange: (step: AppMapScenarioTestStep) => void;
}) {
  const field = () => scenarioBindingField(props.step);
  return (
    <fieldset class="grid gap-2 rounded-xl border border-border-weak-base bg-background-base p-3">
      <legend class="px-1 text-[11px] font-semibold text-text-base">Execution binding</legend>
      <Show when={props.step.kind === "instruction"}>
        <InstructionBinding map={props.map} step={props.step} onChange={props.onChange} />
      </Show>
      <Show when={props.step.kind === "module"}>
        <ModuleBinding map={props.map} step={props.step} onChange={props.onChange} />
      </Show>
      <Show when={props.step.kind === "extraction"}>
        <ExtractionBinding step={props.step} onChange={props.onChange} />
      </Show>
      <Show when={props.step.kind === "decision"}>
        <DecisionBinding step={props.step} onChange={props.onChange} />
      </Show>
      <Show when={field()}>
        {(config) => (
          <label class="grid gap-1.5" for={`binding-${props.step.id}`}>
            <span class={testEditorLabel}>{config().label}</span>
            <Show
              when={config().kind === "textarea"}
              fallback={
                <input
                  id={`binding-${props.step.id}`}
                  class={testEditorInput}
                  type={config().kind}
                  min={config().kind === "number" ? 1 : undefined}
                  max={config().kind === "number" ? 20 : undefined}
                  value={config().value}
                  placeholder={config().placeholder}
                  spellcheck={false}
                  autocomplete="off"
                  onBlur={(event) =>
                    props.onChange(resolveScenarioBinding(props.step, event.currentTarget.value))
                  }
                />
              }
            >
              <textarea
                id={`binding-${props.step.id}`}
                class={cn(
                  testEditorInput,
                  props.step.kind === "script" ? "min-h-32 py-2.5 font-mono" : "min-h-20 py-2.5",
                )}
                value={config().value}
                spellcheck={false}
                onBlur={(event) =>
                  props.onChange(resolveScenarioBinding(props.step, event.currentTarget.value))
                }
              />
            </Show>
            <Show when={config().hint}>
              <small class="text-[10px] text-text-weak">{config().hint}</small>
            </Show>
          </label>
        )}
      </Show>
      <Show
        when={
          !field() && !["instruction", "module", "extraction", "decision"].includes(props.step.kind)
        }
      >
        <p class="m-0 text-[12px]/[1.5] text-text-weak">
          This typed binding remains editable through the CLI and agents in this first visual slice.
        </p>
      </Show>
      <Show when={props.step.binding.status === "unresolved"}>
        <p class="m-0 flex items-start gap-2 text-[11px] text-text-critical-base">
          <Icon name="alert" size={12} class="mt-0.5 shrink-0" />{" "}
          {props.step.binding.status === "unresolved" ? props.step.binding.reason : ""}
        </p>
      </Show>
    </fieldset>
  );
}

function ExtractionBinding(props: {
  step: AppMapScenarioTestStep;
  onChange: (step: AppMapScenarioTestStep) => void;
}) {
  const step = () => props.step as Extract<AppMapScenarioTestStep, { kind: "extraction" }>;
  const binding = () => {
    const current = step().binding;
    return current.status === "resolved" ? current : undefined;
  };
  const commit = (as: string, identifier: string) =>
    props.onChange({
      ...step(),
      binding:
        as.trim() && identifier.trim()
          ? {
              status: "resolved",
              kind: "extract",
              as: as.trim(),
              target: { identifier: identifier.trim() },
            }
          : {
              status: "unresolved",
              reason: "Add an output name and stable target identifier.",
            },
    });
  let output = binding()?.as ?? "";
  let identifier = binding()?.target.identifier ?? "";
  return (
    <div class="grid gap-3">
      <label class="grid gap-1.5" for={`binding-${props.step.id}-output`}>
        <span class={testEditorLabel}>Output name</span>
        <input
          id={`binding-${props.step.id}-output`}
          class={testEditorInput}
          value={output}
          placeholder="confirmation_code"
          spellcheck={false}
          autocomplete="off"
          onInput={(event) => (output = event.currentTarget.value)}
          onBlur={() => commit(output, identifier)}
        />
      </label>
      <label class="grid gap-1.5" for={`binding-${props.step.id}-target`}>
        <span class={testEditorLabel}>Target identifier</span>
        <input
          id={`binding-${props.step.id}-target`}
          class={testEditorInput}
          value={identifier}
          placeholder="confirmation-value"
          spellcheck={false}
          autocomplete="off"
          onInput={(event) => (identifier = event.currentTarget.value)}
          onBlur={() => commit(output, identifier)}
        />
      </label>
    </div>
  );
}

function DecisionBinding(props: {
  step: AppMapScenarioTestStep;
  onChange: (step: AppMapScenarioTestStep) => void;
}) {
  const step = () => props.step as Extract<AppMapScenarioTestStep, { kind: "decision" }>;
  const binding = () => {
    const current = step().binding;
    return current.status === "resolved" ? current : undefined;
  };
  let input = binding()?.input ?? "";
  let operator = binding()?.operator ?? "exists";
  let expected = binding()?.expected ?? "";
  const commit = () =>
    props.onChange({
      ...step(),
      binding: input.trim()
        ? {
            status: "resolved",
            kind: "condition",
            input: input.trim(),
            operator,
            ...(operator === "exists" || !expected.trim() ? {} : { expected: expected.trim() }),
          }
        : { status: "unresolved", reason: "Choose the value this decision should inspect." },
    });
  return (
    <div class="grid gap-3">
      <label class="grid gap-1.5" for={`binding-${props.step.id}-input`}>
        <span class={testEditorLabel}>Value to inspect</span>
        <input
          id={`binding-${props.step.id}-input`}
          class={testEditorInput}
          value={input}
          placeholder="{{account_state}}"
          spellcheck={false}
          autocomplete="off"
          onInput={(event) => (input = event.currentTarget.value)}
          onBlur={commit}
        />
      </label>
      <label class="grid gap-1.5" for={`binding-${props.step.id}-operator`}>
        <span class={testEditorLabel}>Condition</span>
        <select
          id={`binding-${props.step.id}-operator`}
          class={testEditorInput}
          value={operator}
          onChange={(event) => {
            operator = event.currentTarget.value as typeof operator;
            commit();
          }}
        >
          <option value="exists">Exists</option>
          <option value="equals">Equals</option>
          <option value="not-equals">Does not equal</option>
          <option value="contains">Contains</option>
        </select>
      </label>
      <Show when={operator !== "exists"}>
        <label class="grid gap-1.5" for={`binding-${props.step.id}-expected`}>
          <span class={testEditorLabel}>Expected value</span>
          <input
            id={`binding-${props.step.id}-expected`}
            class={testEditorInput}
            value={expected}
            onInput={(event) => (expected = event.currentTarget.value)}
            onBlur={commit}
          />
        </label>
      </Show>
      <small class="text-[10px] text-text-weak">
        Then/Else nested step editing is available through agents and CLI in this slice.
      </small>
    </div>
  );
}

function InstructionBinding(props: {
  map: AppMap;
  step: AppMapScenarioTestStep;
  onChange: (step: AppMapScenarioTestStep) => void;
}) {
  const step = () => props.step as Extract<AppMapScenarioTestStep, { kind: "instruction" }>;
  const chosen = (): string[] => {
    const binding = step().binding;
    return binding.status === "resolved" ? binding.connectionIds : [];
  };
  return (
    <div class="grid gap-1">
      <For
        each={Object.values(props.map.connections)}
        fallback={
          <p class="m-0 text-[12px] text-text-weak">Record and review a map connection first.</p>
        }
      >
        {(connection) => (
          <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-surface-base-hover">
            <input
              type="checkbox"
              checked={chosen().includes(connection.id)}
              onChange={(event) => {
                const ids = event.currentTarget.checked
                  ? [...chosen(), connection.id]
                  : chosen().filter((id) => id !== connection.id);
                props.onChange({
                  ...step(),
                  binding: ids.length
                    ? { status: "resolved", kind: "connections", connectionIds: ids }
                    : {
                        status: "unresolved",
                        reason: "Choose one or more reviewed map connections.",
                      },
                });
              }}
            />
            <span class="min-w-0 flex-1">
              <strong class="block truncate text-[12px]">
                {connection.label || connection.id}
              </strong>
              <small class="text-[10px] text-text-weak">
                {connection.state === "ready" ? "Reviewed" : "Needs review"}
              </small>
            </span>
          </label>
        )}
      </For>
    </div>
  );
}

function ModuleBinding(props: {
  map: AppMap;
  step: AppMapScenarioTestStep;
  onChange: (step: AppMapScenarioTestStep) => void;
}) {
  const step = () => props.step as Extract<AppMapScenarioTestStep, { kind: "module" }>;
  return (
    <label class="grid gap-1.5" for={`binding-${props.step.id}`}>
      <span class={testEditorLabel}>Reusable module</span>
      <select
        id={`binding-${props.step.id}`}
        class={testEditorInput}
        value={(() => {
          const binding = step().binding;
          return binding.status === "resolved" ? binding.routineId : "";
        })()}
        onChange={(event) =>
          props.onChange({
            ...step(),
            binding: event.currentTarget.value
              ? { status: "resolved", kind: "routine", routineId: event.currentTarget.value }
              : { status: "unresolved", reason: "Choose a reviewed routine." },
          })
        }
      >
        <option value="">Choose a module…</option>
        <For each={Object.values(props.map.routines)}>
          {(routine) => <option value={routine.id}>{routine.name}</option>}
        </For>
      </select>
    </label>
  );
}
