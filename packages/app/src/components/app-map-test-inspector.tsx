import { For, Show } from "solid-js";
import type { AppMap, AppMapScenarioTestStep } from "@relay/protocol";
import { Switch } from "@relay/ui/switch";
import { cn } from "../lib/cn";
import { SCENARIO_STEP_LABELS, type ScenarioDiagnostic } from "../lib/app-map-test-editor-model";
import {
  testEditorHint,
  testEditorLabel,
  testEditorSection,
  testEditorTextarea,
} from "../lib/app-map-test-editor-styles";
import { scenarioStepPath } from "../lib/app-map-test-step-path";
import type { ScenarioStepOutlineItem } from "../lib/app-map-test-editor-tree";
import { AppMapTestBindingEditor } from "./app-map-test-binding-editor";
import { stepRowLabel } from "./app-map-test-step-row";
import { Icon } from "./icon";

/**
 * The step editor. It is the only place a step's meaning is written, so it gets
 * the widest column and reads top to bottom as one sentence: what this step is
 * for, what it is bound to, what it should leave behind.
 */
export function AppMapTestInspector(props: {
  map: AppMap;
  item?: ScenarioStepOutlineItem;
  diagnostics: readonly ScenarioDiagnostic[];
  blockers: number;
  onDraftChange: (step: AppMapScenarioTestStep) => void;
  onCommit: (step: AppMapScenarioTestStep) => void;
}) {
  const step = () => props.item?.step;
  const issues = () =>
    step() ? props.diagnostics.filter((item) => item.stepId === step()!.id) : [];
  const blocked = () => issues().some((item) => item.tone === "blocker");

  return (
    <Show when={step()} fallback={<InspectorEmpty blockers={props.blockers} />}>
      {(selected) => (
        <div class="grid gap-5" data-test-step-editor={selected().id}>
          <header class="grid gap-1.5">
            <div class="flex items-center gap-2 text-caption/[1.25] text-text-weak">
              <span class="font-medium text-text-base">{stepRowLabel(props.item!)}</span>
              <span aria-hidden="true">·</span>
              <span>{SCENARIO_STEP_LABELS[selected().kind]}</span>
              <BindingState
                resolved={selected().binding.status === "resolved"}
                blocked={blocked()}
              />
            </div>
            <Show when={scenarioStepPath(props.map, selected()).full}>
              {(path) => (
                <p
                  class="m-0 truncate text-caption/[1.3] text-text-weaker"
                  dir="rtl"
                  title={path()}
                >
                  <span dir="ltr">{path()}</span>
                </p>
              )}
            </Show>
          </header>

          <label class="grid gap-1.5" for={`test-step-intent-${selected().id}`}>
            <span class={cn(testEditorSection, "flex items-baseline justify-between gap-2")}>
              What this step is for
              <span class={cn(testEditorHint, "font-normal")}>⌘↵ to save</span>
            </span>
            <textarea
              id={`test-step-intent-${selected().id}`}
              class={cn(testEditorTextarea, "min-h-[68px]")}
              value={selected().intent}
              placeholder="Describe the outcome in one sentence…"
              onInput={(event) =>
                props.onDraftChange({ ...selected(), intent: event.currentTarget.value })
              }
              onBlur={() => props.onCommit(selected())}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          </label>

          <AppMapTestBindingEditor map={props.map} step={selected()} onChange={props.onCommit} />

          <div class="grid gap-2.5">
            <h3 class={cn(testEditorSection, "m-0")}>After this step</h3>
            <div class="flex items-start justify-between gap-4">
              <div class="grid min-w-0 gap-px">
                <span
                  id={`test-step-capture-${selected().id}`}
                  class="text-caption font-medium text-text-strong"
                >
                  Save a result frame
                </span>
                <span class={testEditorHint}>
                  Keeps one screenshot from this step in Last run, without recapturing the whole
                  path.
                </span>
              </div>
              <Switch
                class="mt-0.5 shrink-0"
                checked={selected().capture === true}
                aria-labelledby={`test-step-capture-${selected().id}`}
                onCheckedChange={(checked) =>
                  props.onCommit({ ...selected(), capture: checked || undefined })
                }
              />
            </div>
            <details open={Boolean(selected().note)}>
              <summary
                class={cn(
                  "flex min-h-8 w-fit cursor-pointer list-none items-center gap-1 rounded",
                  "text-caption font-medium text-text-weak hover:text-text-strong",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus",
                )}
              >
                <Icon name="edit" size={12} />
                {selected().note ? "Note" : "Add a note"}
              </summary>
              <label class="grid gap-1.5 pt-1.5" for={`test-step-note-${selected().id}`}>
                <span class={cn(testEditorLabel, "sr-only")}>Note</span>
                <textarea
                  id={`test-step-note-${selected().id}`}
                  class={testEditorTextarea}
                  value={selected().note ?? ""}
                  placeholder="Context for whoever reads this run next…"
                  onInput={(event) =>
                    props.onDraftChange({
                      ...selected(),
                      note: event.currentTarget.value || undefined,
                    })
                  }
                  onBlur={() => props.onCommit(selected())}
                />
              </label>
            </details>
          </div>

          <Show when={issues().length}>
            <ul class="m-0 grid list-none gap-1.5 p-0" aria-live="polite">
              <For each={issues()}>
                {(item) => (
                  <li
                    class={cn(
                      "flex items-start gap-1.5 text-caption/[1.4]",
                      item.tone === "blocker" ? "text-text-critical-base" : "text-text-weak",
                    )}
                  >
                    <Icon
                      name={item.tone === "blocker" ? "alert" : "info"}
                      size={12}
                      class={cn(
                        "mt-px shrink-0",
                        item.tone === "blocker"
                          ? "text-icon-critical-base"
                          : "text-icon-warning-base",
                      )}
                    />
                    {item.message}
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      )}
    </Show>
  );
}

/**
 * The old `Bound` pill said a word the product never defined. This one names the
 * thing that is missing, and only appears when there is something to say.
 */
function BindingState(props: { resolved: boolean; blocked: boolean }) {
  const tone = () =>
    !props.resolved ? "unbound" : props.blocked ? "attention" : ("bound" as const);
  return (
    <span
      class={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-micro font-medium",
        tone() === "bound" && "bg-surface-success-weak text-text-success-base",
        tone() === "attention" && "bg-surface-warning-weak text-text-warning-base",
        tone() === "unbound" && "bg-surface-critical-weak text-text-critical-base",
      )}
      title={
        tone() === "bound"
          ? "This step points at a saved App path, so Relay can run it."
          : "Relay cannot run this step until it points at a saved App path."
      }
    >
      {tone() === "bound"
        ? "Ready"
        : tone() === "attention"
          ? "Needs attention"
          : "Not connected yet"}
    </span>
  );
}

function InspectorEmpty(props: { blockers: number }) {
  return (
    <div class="grid max-w-96 gap-1.5 py-10">
      <h2 class="m-0 text-title/[1.3] font-semibold tracking-[-0.01em] text-text-strong">
        Pick a step to edit it
      </h2>
      <p class={cn(testEditorHint, "m-0")}>
        {props.blockers
          ? `${props.blockers} ${props.blockers === 1 ? "step" : "steps"} still need work before this test can run.`
          : "Every step is connected — this test is ready to run."}
      </p>
    </div>
  );
}
