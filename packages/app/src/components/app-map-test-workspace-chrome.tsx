import { For, Show } from "solid-js";
import type { AppMapTest } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { cn } from "../lib/cn";
import { testKindDescription } from "../lib/app-map-test-editor-model";
import { testEditorInput, testEditorLabel } from "./app-map-test-binding-editor";
import { Icon } from "./icon";

export type MobileTestPane = "steps" | "edit" | "device" | "results";

export function TestPicker(props: {
  tests: AppMapTest[];
  selectedTestId: string;
  disabled: boolean;
  creating: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-border-weak-base p-3">
      <label class="grid gap-1" for="app-map-test-picker">
        <span class={testEditorLabel}>Test</span>
        <select
          id="app-map-test-picker"
          class={testEditorInput}
          value={props.selectedTestId}
          disabled={props.disabled}
          onChange={(event) => props.onSelect(event.currentTarget.value)}
        >
          <For each={props.tests}>
            {(test) => (
              <option value={test.id}>
                {test.name} · {testKindDescription(test)}
              </option>
            )}
          </For>
        </select>
      </label>
      <div class="flex items-end gap-1">
        <Button
          variant="secondary"
          size="sm"
          class="mt-[19px] min-h-11"
          disabled={props.creating}
          onClick={props.onCreate}
        >
          <Icon name="plus" size={13} /> {props.creating ? "Creating…" : "New"}
        </Button>
        <Show when={props.selectedTestId}>
          <details class="relative">
            <summary
              class="grid min-h-11 min-w-11 cursor-pointer list-none place-items-center rounded-lg text-text-weak hover:bg-surface-base-hover focus-visible:outline-2 focus-visible:outline-border-strong-focus"
              aria-label="Test options"
            >
              <Icon name="more" size={14} />
            </summary>
            <div class="absolute top-[calc(100%+4px)] right-0 z-30 grid w-40 rounded-lg border border-border-strong-base bg-background-base p-1 shadow-[var(--shadow-lg)]">
              <button
                type="button"
                disabled={props.disabled}
                class="min-h-11 rounded-md px-3 text-left text-[12px] hover:bg-surface-base-hover disabled:opacity-40"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  props.onDuplicate();
                }}
              >
                Duplicate Test
              </button>
              <button
                type="button"
                disabled={props.disabled}
                class="min-h-11 rounded-md px-3 text-left text-[12px] text-text-critical-base hover:bg-surface-base-hover disabled:opacity-40"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  props.onDelete();
                }}
              >
                Delete Test…
              </button>
            </div>
          </details>
        </Show>
      </div>
    </div>
  );
}

export function FirstTestEmpty(props: { creating: boolean; onCreate: () => void }) {
  return (
    <div class="grid flex-1 place-items-center p-6 text-center">
      <div class="max-w-[32ch]">
        <h2 class="m-0 text-[17px] font-semibold">Create the first test</h2>
        <p class="mt-2 text-[12px]/[1.5] text-text-weak">
          Start with readable intent, then bind each step to reviewed map truth.
        </p>
        <Button class="mt-4" disabled={props.creating} onClick={props.onCreate}>
          Create scenario test
        </Button>
      </div>
    </div>
  );
}

export function LegacyTest(props: {
  test: AppMapTest;
  onCreate: () => void;
  onConvert: () => void;
}) {
  return (
    <div class="grid flex-1 place-items-center p-6 text-center">
      <div class="max-w-[38ch]">
        <span class="mx-auto grid size-10 place-items-center rounded-xl bg-surface-base text-text-weak">
          <Icon name="folder" size={17} />
        </span>
        <h2 class="mt-3 text-[17px] font-semibold">{props.test.name}</h2>
        <p class="mt-1 text-[12px]/[1.55] text-text-weak">
          This {props.test.kind === "path" ? "recorded path" : "screen tour"} keeps its existing
          behavior and stays read-only. Create a scenario to edit intent step by step.
        </p>
        <Show
          when={props.test.kind === "path" && props.test.flowId}
          fallback={
            <>
              <p class="mt-3 text-[11px]/[1.5] text-text-weaker">
                Screen tours remain read-only because their dynamic traversal has no equivalent
                scenario binding yet.
              </p>
              <Button class="mt-4" onClick={props.onCreate}>
                Create separate scenario
              </Button>
            </>
          }
        >
          <Button class="mt-4" onClick={props.onConvert}>
            Convert to editable scenario
          </Button>
        </Show>
      </div>
    </div>
  );
}

export function MobilePaneNav(props: {
  value: MobileTestPane;
  onChange: (pane: MobileTestPane) => void;
}) {
  const panes = [
    ["steps", "Steps"],
    ["edit", "Edit"],
    ["device", "Device"],
    ["results", "Results"],
  ] as const;
  return (
    <nav
      class="hidden min-h-12 shrink-0 grid-cols-4 border-b border-border-weak-base bg-background-base p-1 max-[760px]:grid"
      aria-label="Test workspace"
    >
      <For each={panes}>
        {([pane, label]) => (
          <button
            type="button"
            data-test-mobile-tab={pane}
            class={cn(
              "min-h-11 rounded-lg px-2 text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-border-strong-focus",
              props.value === pane
                ? "bg-surface-base-active text-text-strong"
                : "text-text-weak hover:bg-surface-base-hover",
            )}
            aria-current={props.value === pane ? "page" : undefined}
            onClick={() => props.onChange(pane)}
          >
            {label}
          </button>
        )}
      </For>
    </nav>
  );
}
