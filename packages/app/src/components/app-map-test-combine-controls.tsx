import { For, Show, type Accessor } from "solid-js";
import type { CaseExpansionStrategy } from "@relay/protocol";
import { Switch } from "@relay/ui/switch";
import { cn } from "../lib/cn";
import {
  testEditorHint,
  testEditorSection,
  testQuietRow,
  testSelectedRow,
} from "../lib/app-map-test-editor-styles";
import type { TestCombineLens } from "../lib/app-map-test-combine-strip";

export function AppMapTestCombineControls(props: {
  showStrategy: boolean;
  strategy: Accessor<CaseExpansionStrategy>;
  setStrategy: (strategy: CaseExpansionStrategy) => void;
  lens: Accessor<TestCombineLens>;
  setLens: (lens: TestCombineLens) => void;
  wholePage: Accessor<boolean>;
  setWholePage: (wholePage: boolean) => void;
  wholePageAvailability: Accessor<{ destinationScreenId?: string; ready: boolean }>;
  destinationScreenId: Accessor<string | undefined>;
  repeatLocked: Accessor<boolean>;
}) {
  return (
    <>
      <Show when={props.showStrategy}>
        <fieldset class="grid gap-1.5 border-0 p-0">
          <legend class={testEditorSection}>Coverage strategy</legend>
          <p class={cn(testEditorHint, "m-0")}>Choose how the dimensions form cases.</p>
          <div
            class="grid grid-cols-3 gap-1 rounded-lg bg-surface-base p-1 max-[560px]:grid-cols-1"
            role="radiogroup"
            aria-label="Repeat coverage strategy"
          >
            <RepeatStrategyButton
              active={props.strategy() === "cartesian"}
              label="Every combination"
              detail="All pairs and triples"
              disabled={props.repeatLocked()}
              onClick={() => props.setStrategy("cartesian")}
            />
            <RepeatStrategyButton
              active={props.strategy() === "zip"}
              label="Match rows"
              detail="Equal-length rows"
              disabled={props.repeatLocked()}
              onClick={() => props.setStrategy("zip")}
            />
            <RepeatStrategyButton
              active={props.strategy() === "pairwise"}
              label="Every pair"
              detail="Fewer cases"
              disabled={props.repeatLocked()}
              onClick={() => props.setStrategy("pairwise")}
            />
          </div>
        </fieldset>
      </Show>
      <div class="grid gap-1.5">
        <span class={testEditorSection}>Evidence</span>
        <div class="flex gap-1.5">
          <For each={["visual", "smoke"] as const}>
            {(choice) => (
              <button
                type="button"
                class={cn(
                  "min-h-11 rounded-md px-3 text-caption",
                  props.lens() === choice ? testSelectedRow : testQuietRow,
                )}
                data-test-combine-lens={choice}
                aria-pressed={props.lens() === choice}
                disabled={props.repeatLocked()}
                onClick={() => props.setLens(choice)}
              >
                {choice === "visual" ? "Visual" : "Smoke"}
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="flex items-start justify-between gap-4">
        <div class="grid min-w-0 gap-px">
          <span id="app-map-test-combine-whole-page" class={testEditorSection}>
            Whole page
          </span>
          <span class={testEditorHint}>
            {props.wholePageAvailability().ready
              ? "Capture the full scrolling screen."
              : props.destinationScreenId()
                ? "This destination has no frozen full-page capture."
                : "This Test has no destination screen to capture as a whole page."}
          </span>
        </div>
        <Switch
          class="mt-0.5 shrink-0"
          checked={props.wholePage()}
          disabled={props.repeatLocked() || !props.wholePageAvailability().ready}
          aria-labelledby="app-map-test-combine-whole-page"
          data-test-combine-whole-page
          onCheckedChange={props.setWholePage}
        />
      </div>
    </>
  );
}

export function repeatDurationLabel(caseCount: number, stepCount: number): string {
  if (!caseCount) return "available after selecting values";
  const milliseconds = caseCount * Math.max(15_000, Math.max(1, stepCount) * 5_000);
  if (milliseconds < 60_000) return "under 1 minute";
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function RepeatStrategyButton(props: {
  active: boolean;
  label: string;
  detail: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.active}
      class={cn(
        "grid min-h-11 gap-px rounded-md px-2 py-1 text-left text-micro transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus",
        props.active
          ? "bg-surface-raised-stronger-non-alpha text-text-strong shadow-xs-border-base"
          : "text-text-weak hover:bg-surface-raised-base-hover hover:text-text-strong",
      )}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <strong class="font-medium">{props.label}</strong>
      <span class="text-text-weak">{props.detail}</span>
    </button>
  );
}
