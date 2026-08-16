import { For, Show, type JSX } from "solid-js";
import type { AppMapTest } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { cn } from "../lib/cn";
import { testKindDescription } from "../lib/app-map-test-editor-model";
import { testEditorInput } from "./app-map-test-binding-editor";
import { Icon } from "./icon";

export type MobileTestPane = "steps" | "edit" | "device" | "results";

export function TestWorkspaceActionBar(props: {
  status: string;
  statusTone?: "ready" | "attention" | "saving" | "neutral";
  stepCount: number | undefined;
  children: JSX.Element;
}) {
  return (
    <header class="flex min-h-[52px] items-center justify-between gap-3 border-b border-border-weak-base bg-surface-raised-stronger-non-alpha px-3 py-1.5">
      <div class="flex min-w-0 items-center gap-2.5" aria-live="polite">
        <div class="flex min-w-0 items-center gap-2">
          <span
            class={cn(
              "size-2 shrink-0 rounded-full",
              props.statusTone === "attention"
                ? "bg-icon-warning-base"
                : props.statusTone === "saving"
                  ? "bg-icon-interactive-base"
                  : props.statusTone === "neutral"
                    ? "bg-icon-disabled"
                    : "bg-icon-success-base",
            )}
            aria-hidden="true"
          />
          <strong class="truncate text-[12px] font-semibold text-text-strong">
            {props.status}
          </strong>
        </div>
        <Show when={props.stepCount !== undefined}>
          <span class="shrink-0 border-l border-border-weak-base pl-2.5 text-[10.5px] tabular-nums text-text-weak">
            {props.stepCount} {props.stepCount === 1 ? "step" : "steps"}
          </span>
        </Show>
      </div>
      <div class="flex shrink-0 items-center gap-2">{props.children}</div>
    </header>
  );
}

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
    <div class="grid gap-1.5 border-b border-border-weak-base bg-surface-raised-stronger-non-alpha p-2">
      <label class="min-w-0 flex-1" for="app-map-test-picker">
        <span class="sr-only">Test</span>
        <select
          id="app-map-test-picker"
          class={cn(testEditorInput, "truncate")}
          title={props.tests.find((test) => test.id === props.selectedTestId)?.name}
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
      <div class="flex items-center justify-between gap-1">
        <span class="pl-1 text-[10px] font-medium text-text-weaker">Saved Test</span>
        <div class="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            class="min-h-11 shrink-0"
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

export function MobilePaneNav(props: {
  value: MobileTestPane;
  onChange: (pane: MobileTestPane) => void;
}) {
  const panes = [
    ["steps", "Coverage"],
    ["device", "Device"],
    ["results", "Results"],
    ["edit", "Edit"],
  ] as const;
  return (
    <nav
      class="hidden min-h-12 shrink-0 grid-cols-4 border-b border-border-weak-base bg-background-base p-1 max-[980px]:grid"
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
