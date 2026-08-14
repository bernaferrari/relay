import { For, Show } from "solid-js";
import type { AppMap, AppMapScenarioTestStep } from "@relay/protocol";
import { cn } from "../lib/cn";
import { resolveScenarioBinding, scenarioBindingField } from "../lib/app-map-test-editor-model";
import { observedTargetOptions, selectedTargetKey } from "../lib/app-map-test-binding-options";
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
        <ExtractionBinding map={props.map} step={props.step} onChange={props.onChange} />
      </Show>
      <Show when={props.step.kind === "validation"}>
        <ValidationBinding map={props.map} step={props.step} onChange={props.onChange} />
      </Show>
      <Show when={props.step.kind === "decision"}>
        <DecisionBinding step={props.step} onChange={props.onChange} />
      </Show>
      <Show when={props.step.kind !== "validation" && field()}>
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
  map: AppMap;
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
  const options = () => observedTargetOptions(props.map);
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
        <span class={testEditorLabel}>Observed element</span>
        <select
          id={`binding-${props.step.id}-target`}
          class={testEditorInput}
          value={selectedTargetKey(options(), binding()?.target)}
          onChange={(event) => {
            const target = options().find(
              (option) => option.key === event.currentTarget.value,
            )?.target;
            identifier = target?.identifier ?? "";
            if (target && output.trim()) {
              props.onChange({
                ...step(),
                binding: { status: "resolved", kind: "extract", as: output.trim(), target },
              });
            }
          }}
        >
          <option value="">Choose from captured UI…</option>
          <For each={options()}>
            {(option) => (
              <option value={option.key}>
                {option.label} — {option.context}
              </option>
            )}
          </For>
        </select>
      </label>
      <details class="rounded-lg border border-border-weak-base px-3 py-2">
        <summary class="min-h-6 cursor-pointer text-[11px] font-semibold text-text-base">
          Advanced target
        </summary>
        <label class="mt-2 grid gap-1.5" for={`binding-${props.step.id}-identifier`}>
          <span class={testEditorLabel}>Stable identifier</span>
          <input
            id={`binding-${props.step.id}-identifier`}
            class={testEditorInput}
            value={identifier}
            placeholder="confirmation-value"
            spellcheck={false}
            autocomplete="off"
            onInput={(event) => (identifier = event.currentTarget.value)}
            onBlur={() => commit(output, identifier)}
          />
        </label>
      </details>
    </div>
  );
}

function ValidationBinding(props: {
  map: AppMap;
  step: AppMapScenarioTestStep;
  onChange: (step: AppMapScenarioTestStep) => void;
}) {
  const step = () => props.step as Extract<AppMapScenarioTestStep, { kind: "validation" }>;
  const binding = () => step().binding;
  const assertion = () => {
    const current = binding();
    return current.status === "resolved" && current.kind === "assertion"
      ? current.assertion
      : undefined;
  };
  const options = () => observedTargetOptions(props.map);
  const target = () => {
    const current = assertion();
    return current?.kind === "target" ? current.target : undefined;
  };
  const selectedChoice = () => {
    const current = assertion();
    return current?.kind === "screen"
      ? `screen:${current.screenId}`
      : selectedTargetKey(options(), target());
  };
  const condition = () => {
    const current = assertion();
    return current?.kind === "target" ? current.condition : "visible";
  };
  let identifier = target()?.identifier ?? "";
  const commitTarget = (nextTarget: { identifier: string } | { label: string }) =>
    props.onChange({
      ...step(),
      binding: {
        status: "resolved",
        kind: "assertion",
        assertion: { kind: "target", target: nextTarget, condition: condition() },
      },
    });
  return (
    <div class="grid gap-3">
      <label class="grid gap-1.5" for={`binding-${props.step.id}-observed`}>
        <span class={testEditorLabel}>Screen or element to check</span>
        <select
          id={`binding-${props.step.id}-observed`}
          class={testEditorInput}
          value={selectedChoice()}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value.startsWith("screen:")) {
              props.onChange({
                ...step(),
                binding: {
                  status: "resolved",
                  kind: "assertion",
                  assertion: { kind: "screen", screenId: value.slice("screen:".length) },
                },
              });
              return;
            }
            const next = options().find((option) => option.key === value)?.target;
            if (next && (next.identifier || next.label)) {
              identifier = next.identifier ?? "";
              commitTarget(
                next.identifier ? { identifier: next.identifier } : { label: next.label! },
              );
            }
          }}
        >
          <option value="">Choose from the App Map…</option>
          <optgroup label="Screens">
            <For each={Object.values(props.map.screens)}>
              {(screen) => <option value={`screen:${screen.id}`}>{screen.title}</option>}
            </For>
          </optgroup>
          <optgroup label="Observed elements">
            <For each={options()}>
              {(option) => (
                <option value={option.key}>
                  {option.label} — {option.context}
                </option>
              )}
            </For>
          </optgroup>
        </select>
      </label>
      <Show when={target()}>
        <label class="grid gap-1.5" for={`binding-${props.step.id}-condition`}>
          <span class={testEditorLabel}>Expected state</span>
          <select
            id={`binding-${props.step.id}-condition`}
            class={testEditorInput}
            value={condition()}
            onChange={(event) => {
              const current = target();
              if (!current) return;
              props.onChange({
                ...step(),
                binding: {
                  status: "resolved",
                  kind: "assertion",
                  assertion: {
                    kind: "target",
                    target: current,
                    condition: event.currentTarget.value as "visible" | "gone",
                  },
                },
              });
            }}
          >
            <option value="visible">Visible</option>
            <option value="gone">Not visible</option>
          </select>
        </label>
      </Show>
      <details class="rounded-lg border border-border-weak-base px-3 py-2">
        <summary class="min-h-6 cursor-pointer text-[11px] font-semibold text-text-base">
          Advanced target
        </summary>
        <label class="mt-2 grid gap-1.5" for={`binding-${props.step.id}-identifier`}>
          <span class={testEditorLabel}>Stable identifier</span>
          <input
            id={`binding-${props.step.id}-identifier`}
            class={testEditorInput}
            value={identifier}
            placeholder="continue-button"
            spellcheck={false}
            autocomplete="off"
            onInput={(event) => (identifier = event.currentTarget.value)}
            onBlur={() => {
              if (identifier.trim()) commitTarget({ identifier: identifier.trim() });
            }}
          />
        </label>
      </details>
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
        Add Then and Else steps directly beneath this decision in the outline.
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
  const screenTitle = (id: string) => props.map.screens[id]?.title ?? "Unknown screen";
  const flowReady = (connectionIds: string[]) =>
    connectionIds.length > 0 &&
    connectionIds.every((connectionId) => props.map.connections[connectionId]?.state === "ready");
  return (
    <div class="grid gap-3">
      <Show when={Object.values(props.map.flows).length > 0}>
        <label class="grid gap-1.5" for={`binding-${props.step.id}-flow`}>
          <span class={testEditorLabel}>Saved flow</span>
          <select
            id={`binding-${props.step.id}-flow`}
            class={testEditorInput}
            value={
              Object.values(props.map.flows).find(
                (flow) =>
                  flow.connectionIds.length === chosen().length &&
                  flow.connectionIds.every((id, index) => id === chosen()[index]),
              )?.id ?? ""
            }
            onChange={(event) => {
              const flow = props.map.flows[event.currentTarget.value];
              if (!flow) return;
              props.onChange({
                ...step(),
                binding: {
                  status: "resolved",
                  kind: "connections",
                  connectionIds: [...flow.connectionIds],
                },
              });
            }}
          >
            <option value="">Choose a saved flow…</option>
            <For each={Object.values(props.map.flows)}>
              {(flow) => (
                <option value={flow.id} disabled={!flowReady(flow.connectionIds)}>
                  {flow.name} · {flow.connectionIds.length} steps
                  {flowReady(flow.connectionIds) ? "" : " · needs review"}
                </option>
              )}
            </For>
          </select>
          <small class="text-[10px] text-text-weak">
            A flow fills the ordered navigation steps in one click.
          </small>
        </label>
      </Show>
      <div class="grid gap-1">
        <p class="m-0 text-[11px] font-semibold text-text-base">Individual connections</p>
        <For
          each={Object.values(props.map.connections)}
          fallback={
            <p class="m-0 text-[12px] text-text-weak">Record and review a map connection first.</p>
          }
        >
          {(connection) => (
            <label
              class={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-2",
                connection.state === "ready" || chosen().includes(connection.id)
                  ? "cursor-pointer hover:bg-surface-base-hover"
                  : "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="checkbox"
                checked={chosen().includes(connection.id)}
                disabled={connection.state !== "ready" && !chosen().includes(connection.id)}
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
                <span class="flex min-w-0 items-center gap-2">
                  <Show when={chosen().indexOf(connection.id) >= 0}>
                    <span class="grid size-5 shrink-0 place-items-center rounded-full bg-surface-info-weak text-[10px] font-semibold text-text-info-base">
                      {chosen().indexOf(connection.id) + 1}
                    </span>
                  </Show>
                  <strong class="block truncate text-[12px]">
                    {connection.label || connection.id}
                  </strong>
                </span>
                <small class="text-[10px] text-text-weak">
                  {screenTitle(connection.fromScreenId)} →{" "}
                  {connection.destination.kind === "screen"
                    ? screenTitle(connection.destination.screenId)
                    : "End"}
                  {connection.state === "ready" ? "" : " · Needs review"}
                </small>
              </span>
            </label>
          )}
        </For>
      </div>
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
