import { For, Show } from "solid-js";
import type { AppMap, AppMapScenarioTestStep } from "@relay/protocol";
import { cn } from "../lib/cn";
import { plural } from "../lib/plural";
import { resolveScenarioBinding, scenarioBindingField } from "../lib/app-map-test-editor-model";
import {
  testEditorHint,
  testEditorInput,
  testEditorLabel,
  testEditorSection,
} from "../lib/app-map-test-editor-styles";
import {
  DecisionBinding,
  EditorField,
  ExtractionBinding,
  ValidationBinding,
} from "./app-map-test-binding-fields";
import { Icon } from "./icon";

type StepChange = (step: AppMapScenarioTestStep) => void;

/**
 * A section heading per kind, phrased as what the step will actually do. The old
 * "Execution binding › Reusable module" pair added two levels of nesting and no
 * information; "Runs which module" is the whole idea in three words.
 */
const BINDING_HEADINGS: Record<AppMapScenarioTestStep["kind"], string> = {
  instruction: "Replays which navigation",
  validation: "Checks what",
  extraction: "Reads which value",
  manual: "Asks the person for what",
  module: "Runs which module",
  decision: "Branches on what",
  loop: "Repeats how often",
  script: "Transforms with what",
};

export function AppMapTestBindingEditor(props: {
  map: AppMap;
  step: AppMapScenarioTestStep;
  onChange: StepChange;
}) {
  const field = () => scenarioBindingField(props.step);
  const unresolved = () =>
    props.step.binding.status === "unresolved" ? props.step.binding.reason : undefined;
  return (
    <section class="grid gap-2.5" aria-labelledby={`binding-heading-${props.step.id}`}>
      <h3 id={`binding-heading-${props.step.id}`} class={cn(testEditorSection, "m-0")}>
        {BINDING_HEADINGS[props.step.kind]}
      </h3>
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
          <EditorField label={config().label} for={`binding-${props.step.id}`} hint={config().hint}>
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
                  props.step.kind === "script" ? "min-h-32 py-2 font-mono" : "min-h-20 py-2",
                )}
                value={config().value}
                spellcheck={false}
                onBlur={(event) =>
                  props.onChange(resolveScenarioBinding(props.step, event.currentTarget.value))
                }
              />
            </Show>
          </EditorField>
        )}
      </Show>
      <Show
        when={
          !field() && !["instruction", "module", "extraction", "decision"].includes(props.step.kind)
        }
      >
        <p class={cn(testEditorHint, "m-0")}>
          This typed binding remains editable through the CLI and agents in this first visual slice.
        </p>
      </Show>
      <Show when={unresolved()}>
        {(reason) => (
          <p class="m-0 flex items-start gap-1.5 text-caption/[1.4] text-text-critical-base">
            <Icon name="alert" size={12} class="mt-px shrink-0" />
            {reason()}
          </p>
        )}
      </Show>
    </section>
  );
}

function InstructionBinding(props: {
  map: AppMap;
  step: AppMapScenarioTestStep;
  onChange: StepChange;
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
        <EditorField
          label="Saved flow"
          for={`binding-${props.step.id}-flow`}
          hint="Fills the ordered connections below in one click."
        >
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
                  {flow.name} · {plural(flow.connectionIds.length, "step")}
                  {flowReady(flow.connectionIds) ? "" : " · needs review"}
                </option>
              )}
            </For>
          </select>
        </EditorField>
      </Show>
      <div class="grid gap-1">
        <p class={cn(testEditorLabel, "m-0")}>
          Connections
          <Show when={chosen().length}>
            <span class="ml-1 font-normal text-text-weak tabular-nums">
              {chosen().length} in order
            </span>
          </Show>
        </p>
        <div class="grid overflow-hidden rounded-md border border-border-weak-base">
          <For
            each={Object.values(props.map.connections)}
            fallback={
              <p class={cn(testEditorHint, "m-0 px-2.5 py-3")}>
                Record and review a map connection first.
              </p>
            }
          >
            {(connection) => (
              <ConnectionRow
                order={chosen().indexOf(connection.id)}
                label={connection.label || connection.id}
                path={`${screenTitle(connection.fromScreenId)} → ${
                  connection.destination.kind === "screen"
                    ? screenTitle(connection.destination.screenId)
                    : "End"
                }${connection.state === "ready" ? "" : " · Needs review"}`}
                disabled={connection.state !== "ready"}
                onToggle={(checked) => {
                  const ids = checked
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
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

/**
 * Order matters here, so a selected connection shows its position instead of a
 * generic tick. The checkbox is a real input for keyboard and screen readers,
 * visually replaced by the ordinal badge.
 */
function ConnectionRow(props: {
  order: number;
  label: string;
  path: string;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const chosen = () => props.order >= 0;
  return (
    <label
      class={cn(
        "flex min-h-11 items-center gap-2.5 px-2.5",
        "border-b border-border-weak-base last:border-b-0",
        "transition-colors duration-hover motion-reduce:transition-none",
        props.disabled
          ? "cursor-not-allowed text-text-weaker"
          : "cursor-pointer hover:bg-surface-base-hover",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[-2px] has-[:focus-visible]:outline-border-strong-focus",
      )}
    >
      <input
        type="checkbox"
        class="peer sr-only"
        checked={chosen()}
        disabled={props.disabled}
        onChange={(event) => props.onToggle(event.currentTarget.checked)}
      />
      <span
        aria-hidden="true"
        class={cn(
          "grid size-5 shrink-0 place-items-center rounded text-micro font-semibold tabular-nums",
          chosen()
            ? "bg-surface-info-weak text-text-info-base"
            : "border border-border-weak-base text-transparent",
        )}
      >
        {chosen() ? props.order + 1 : "0"}
      </span>
      <span class="grid min-w-0 flex-1 gap-px">
        <span class="truncate text-caption text-text-strong">{props.label}</span>
        <span class="truncate text-caption/[1.3] text-text-weak">{props.path}</span>
      </span>
    </label>
  );
}

function ModuleBinding(props: { map: AppMap; step: AppMapScenarioTestStep; onChange: StepChange }) {
  const step = () => props.step as Extract<AppMapScenarioTestStep, { kind: "module" }>;
  const selectedRoutineId = () => {
    const binding = step().binding;
    return binding.status === "resolved" ? binding.routineId : "";
  };
  return (
    <EditorField
      label="Module"
      for={`binding-${props.step.id}`}
      hint="Modules are reusable step groups saved with this App."
    >
      <select
        id={`binding-${props.step.id}`}
        class={testEditorInput}
        value={selectedRoutineId()}
        onChange={(event) =>
          props.onChange({
            ...step(),
            binding: event.currentTarget.value
              ? { status: "resolved", kind: "routine", routineId: event.currentTarget.value }
              : { status: "unresolved", reason: "Choose a reviewed routine." },
          })
        }
      >
        <option value="" selected={!selectedRoutineId()}>
          Choose a module…
        </option>
        <For each={Object.values(props.map.routines)}>
          {(routine) => (
            <option value={routine.id} selected={routine.id === selectedRoutineId()}>
              {routine.name}
            </option>
          )}
        </For>
      </select>
    </EditorField>
  );
}
