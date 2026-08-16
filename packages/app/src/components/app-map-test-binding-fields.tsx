import { For, Show, type JSX } from "solid-js";
import type { AppMap, AppMapScenarioTestStep } from "@relay/protocol";
import { cn } from "../lib/cn";
import { observedTargetOptions, selectedTargetKey } from "../lib/app-map-test-binding-options";
import {
  testEditorHint,
  testEditorInput,
  testEditorLabel,
} from "../lib/app-map-test-editor-styles";

type StepChange = (step: AppMapScenarioTestStep) => void;

/** Label, control, optional hint — the only field shape in this editor. */
export function EditorField(props: {
  label: string;
  for: string;
  hint?: string;
  children: JSX.Element;
}) {
  return (
    <label class="grid gap-1.5" for={props.for}>
      <span class={testEditorLabel}>{props.label}</span>
      {props.children}
      <Show when={props.hint}>
        <small class={testEditorHint}>{props.hint}</small>
      </Show>
    </label>
  );
}

/**
 * Hand-written selector, folded away. Almost nobody types an accessibility id,
 * so it must not compete with the picker that reads from the map.
 */
function AdvancedTarget(props: {
  stepId: string;
  value: string;
  placeholder: string;
  onInput: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <details class="group/advanced">
      <summary
        class={cn(
          "flex min-h-8 w-fit cursor-pointer list-none items-center gap-1 rounded",
          "text-caption font-medium text-text-weak hover:text-text-strong",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus",
        )}
      >
        <span
          aria-hidden="true"
          class="transition-transform group-open/advanced:rotate-90 motion-reduce:transition-none"
        >
          ›
        </span>
        Type an identifier instead
      </summary>
      <div class="pt-1.5">
        <EditorField
          label="Stable identifier"
          for={`binding-${props.stepId}-identifier`}
          hint="Accessibility id or automation id, exactly as the app exposes it."
        >
          <input
            id={`binding-${props.stepId}-identifier`}
            class={testEditorInput}
            value={props.value}
            placeholder={props.placeholder}
            spellcheck={false}
            autocomplete="off"
            onInput={(event) => props.onInput(event.currentTarget.value)}
            onBlur={props.onCommit}
          />
        </EditorField>
      </div>
    </details>
  );
}

export function ExtractionBinding(props: {
  map: AppMap;
  step: AppMapScenarioTestStep;
  onChange: StepChange;
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
      <EditorField
        label="Save the value as"
        for={`binding-${props.step.id}-output`}
        hint="Later steps read it as {{name}}."
      >
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
      </EditorField>
      <EditorField label="Read it from" for={`binding-${props.step.id}-target`}>
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
          <option value="">Choose an element Relay has seen…</option>
          <For each={options()}>
            {(option) => (
              <option value={option.key}>
                {option.label} — {option.context}
              </option>
            )}
          </For>
        </select>
      </EditorField>
      <AdvancedTarget
        stepId={props.step.id}
        value={identifier}
        placeholder="confirmation-value"
        onInput={(value) => (identifier = value)}
        onCommit={() => commit(output, identifier)}
      />
    </div>
  );
}

export function ValidationBinding(props: {
  map: AppMap;
  step: AppMapScenarioTestStep;
  onChange: StepChange;
}) {
  const step = () => props.step as Extract<AppMapScenarioTestStep, { kind: "validation" }>;
  const assertion = () => {
    const current = step().binding;
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
      <EditorField label="Screen or element" for={`binding-${props.step.id}-observed`}>
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
      </EditorField>
      <Show when={target()}>
        <EditorField label="Must be" for={`binding-${props.step.id}-condition`}>
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
        </EditorField>
      </Show>
      <AdvancedTarget
        stepId={props.step.id}
        value={identifier}
        placeholder="continue-button"
        onInput={(value) => (identifier = value)}
        onCommit={() => {
          if (identifier.trim()) commitTarget({ identifier: identifier.trim() });
        }}
      />
    </div>
  );
}

export function DecisionBinding(props: { step: AppMapScenarioTestStep; onChange: StepChange }) {
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
      <EditorField
        label="Value to inspect"
        for={`binding-${props.step.id}-input`}
        hint="Anything an earlier step saved, written as {{name}}."
      >
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
      </EditorField>
      <EditorField label="Condition" for={`binding-${props.step.id}-operator`}>
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
      </EditorField>
      <Show when={operator !== "exists"}>
        <EditorField label="Expected value" for={`binding-${props.step.id}-expected`}>
          <input
            id={`binding-${props.step.id}-expected`}
            class={testEditorInput}
            value={expected}
            onInput={(event) => (expected = event.currentTarget.value)}
            onBlur={commit}
          />
        </EditorField>
      </Show>
      <p class={cn(testEditorHint, "m-0")}>
        Add the Then and Else steps under this decision in the Steps rail.
      </p>
    </div>
  );
}
