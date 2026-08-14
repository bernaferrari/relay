import { For, Show } from "solid-js";
import type { AppMap, AppMapScenarioTestStep } from "@relay/protocol";
import { cn } from "../lib/cn";
import { SCENARIO_STEP_LABELS, type ScenarioDiagnostic } from "../lib/app-map-test-editor-model";
import type { ScenarioStepOutlineItem } from "../lib/app-map-test-editor-tree";
import {
  AppMapTestBindingEditor,
  testEditorInput,
  testEditorLabel,
} from "./app-map-test-binding-editor";
import { Icon } from "./icon";

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

  return (
    <Show when={step()} fallback={<InspectorEmpty blockers={props.blockers} />}>
      {(selected) => (
        <div class="grid gap-5">
          <header>
            <p class="m-0 text-[10px] font-semibold tracking-[0.08em] text-text-weaker uppercase">
              {SCENARIO_STEP_LABELS[selected().kind]}
            </p>
            <h2 class="mt-1 text-[18px] font-semibold tracking-[-0.02em]">
              {stepPosition(props.item!)}
            </h2>
          </header>
          <label class="grid gap-1.5" for={`test-step-intent-${selected().id}`}>
            <span class={testEditorLabel}>Intent</span>
            <textarea
              id={`test-step-intent-${selected().id}`}
              class={cn(testEditorInput, "min-h-24 resize-y py-2.5")}
              value={selected().intent}
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
          <label class="grid gap-1.5" for={`test-step-note-${selected().id}`}>
            <span class={testEditorLabel}>
              Note <span class="font-normal text-text-weaker">· optional</span>
            </span>
            <textarea
              id={`test-step-note-${selected().id}`}
              class={cn(testEditorInput, "min-h-20 resize-y py-2.5")}
              value={selected().note ?? ""}
              onInput={(event) =>
                props.onDraftChange({
                  ...selected(),
                  note: event.currentTarget.value || undefined,
                })
              }
              onBlur={() => props.onCommit(selected())}
            />
          </label>
          <Show when={issues().length}>
            <div
              class="grid gap-1 rounded-lg border border-border-weak-base bg-background-base p-3"
              aria-live="polite"
            >
              <For each={issues()}>
                {(item) => (
                  <p
                    class={cn(
                      "m-0 flex items-start gap-2 text-[11px]",
                      item.tone === "blocker" ? "text-text-critical-base" : "text-text-weak",
                    )}
                  >
                    <Icon
                      name={item.tone === "blocker" ? "alert" : "info"}
                      size={12}
                      class="mt-0.5 shrink-0"
                    />
                    {item.message}
                  </p>
                )}
              </For>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

function stepPosition(item: ScenarioStepOutlineItem): string {
  if (item.branch === "root") return `Step ${item.index + 1}`;
  const branch = item.branch === "loop" ? "Loop body" : item.branch === "then" ? "Then" : "Else";
  return `${branch} · step ${item.index + 1}`;
}

function InspectorEmpty(props: { blockers: number }) {
  return (
    <div class="rounded-xl border border-dashed border-border-weak-base bg-background-base p-5">
      <h2 class="m-0 text-[15px] font-semibold">Select a step</h2>
      <p class="mt-1 text-[12px]/[1.5] text-text-weak">
        Choose any row, including nested branches, to edit its intent and binding.
        {props.blockers
          ? `${props.blockers} blockers remain before this test can run.`
          : "This test is ready to run."}
      </p>
    </div>
  );
}
