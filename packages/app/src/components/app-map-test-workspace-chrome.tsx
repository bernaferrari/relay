import { For, Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import type { AppMapTest } from "@relay/protocol";
import { cn } from "../lib/cn";
import { menuOption, popover, productIconButton } from "../lib/ui";
import { testEditorInput } from "../lib/app-map-test-editor-styles";
import { scenarioStepCount } from "../lib/app-map-test-editor-model";
import type { TestRailKind } from "../lib/app-map-test-layout";
import { Icon } from "./icon";

export type TestWorkspaceStatusTone = "ready" | "attention" | "saving" | "neutral";

const TONE_DOT: Record<TestWorkspaceStatusTone, string> = {
  ready: "bg-icon-success-base",
  attention: "bg-icon-warning-base",
  saving: "bg-icon-interactive-base",
  neutral: "bg-icon-disabled",
};

const menuItem = cn(
  menuOption,
  "flex min-h-11 w-full items-center gap-2 px-2.5 text-left text-caption text-text-base",
  "hover:text-text-strong focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-border-strong-focus",
  "disabled:cursor-not-allowed disabled:text-text-weaker",
);

/**
 * The single piece of workspace chrome. It replaced four stacked low-density
 * bars (window title, status, test picker, step search): the status is now a
 * label beside the one primary action, the picker is a popover, and the step
 * search moved into the Steps rail where the steps are.
 */
export function TestWorkspaceBar(props: {
  status: string;
  statusTone: TestWorkspaceStatusTone;
  stepCount?: number;
  switcher: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <header
      class="flex min-h-14 min-w-0 w-full items-center gap-2 overflow-hidden border-b border-border-weak-base bg-surface-raised-stronger-non-alpha px-3"
      data-test-workspace-bar
    >
      <div class="flex min-w-0 flex-1 items-center gap-2">
        {props.switcher}
        <Show when={props.stepCount !== undefined}>
          <span class="shrink-0 text-caption tabular-nums text-text-weak max-[900px]:hidden">
            {props.stepCount} {props.stepCount === 1 ? "step" : "steps"}
          </span>
        </Show>
      </div>
      <div class="flex min-w-0 shrink-0 items-center justify-end gap-2" aria-live="polite">
        <span class="flex min-w-0 items-center gap-1.5 max-[720px]:hidden">
          <span
            class={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[props.statusTone])}
            aria-hidden="true"
          />
          <span class="truncate text-caption text-text-base">{props.status}</span>
        </span>
        {props.children}
      </div>
    </header>
  );
}

/**
 * A collapsed rail keeps its edge. Without this the device would simply vanish
 * below the widths where it used to jump to the bottom of the screen.
 */
export function RailStrip(props: {
  rail: TestRailKind;
  label: string;
  onOpen: (rail: TestRailKind) => void;
}) {
  return (
    <div
      class={cn(
        "flex min-h-0 flex-col items-center gap-2 bg-background-base py-2",
        props.rail === "steps"
          ? "border-r border-border-weak-base"
          : "border-l border-border-weak-base",
      )}
      data-test-rail-strip={props.rail}
    >
      <button
        type="button"
        class={cn(productIconButton, "size-8 max-[900px]:size-11")}
        aria-label={`Show ${props.label.toLocaleLowerCase()}`}
        aria-expanded={false}
        data-tip={`Show ${props.label.toLocaleLowerCase()}`}
        onClick={() => props.onOpen(props.rail)}
      >
        <Icon name={props.rail === "steps" ? "chevron-right" : "chevron-left"} size={15} />
      </button>
      <span
        class="text-micro font-semibold tracking-[0.1em] text-text-weak uppercase [writing-mode:vertical-rl]"
        aria-hidden="true"
      >
        {props.label}
      </span>
    </div>
  );
}

/**
 * The Test name is shown once and edited where it is shown. The old screen
 * printed it three times: window title, picker option, and a `Test name` field
 * at the top of the step editor.
 */
export function TestSwitcher(props: {
  tests: AppMapTest[];
  selectedTestId: string;
  name: string;
  busy: boolean;
  creating: boolean;
  onSelect: (id: string) => void;
  onRename: (name: string) => void;
  onSource: () => void;
  onCreate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);
  const [query, setQuery] = createSignal("");
  let trigger: HTMLButtonElement | undefined;
  let container: HTMLDivElement | undefined;

  const matches = () => {
    const needle = query().trim().toLocaleLowerCase();
    if (!needle) return props.tests;
    return props.tests.filter((test) => test.name.toLocaleLowerCase().includes(needle));
  };

  const close = (restoreFocus = true) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) queueMicrotask(() => trigger?.focus());
  };
  const optionButtons = () => [
    ...(container?.querySelectorAll<HTMLButtonElement>("[data-test-switcher-option]") ?? []),
  ];
  const focusOption = (position: "first" | "last" | "next" | "previous") => {
    const options = optionButtons();
    if (!options.length) return;
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const index =
      position === "first"
        ? 0
        : position === "last"
          ? options.length - 1
          : position === "next"
            ? Math.min(options.length - 1, current < 0 ? 0 : current + 1)
            : Math.max(0, current < 0 ? options.length - 1 : current - 1);
    options[index]?.focus();
  };

  createEffect(() => {
    if (!open()) return;
    const dismiss = (event: MouseEvent) => {
      if (!container?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("mousedown", dismiss);
    onCleanup(() => document.removeEventListener("mousedown", dismiss));
  });
  createEffect(() => {
    if (props.busy && open()) close(false);
  });

  return (
    <div class="relative flex min-w-0 items-center gap-1" ref={(element) => (container = element)}>
      <Show
        when={!renaming()}
        fallback={
          <input
            class={cn(testEditorInput, "min-w-0 max-w-[280px] flex-1")}
            aria-label="Test name"
            value={props.name}
            autofocus
            spellcheck={false}
            onBlur={(event) => {
              props.onRename(event.currentTarget.value);
              setRenaming(false);
              queueMicrotask(() => trigger?.focus());
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                event.currentTarget.value = props.name;
                event.currentTarget.blur();
              }
            }}
          />
        }
      >
        <button
          ref={(element) => (trigger = element)}
          type="button"
          id="app-map-test-switcher"
          class={cn(
            "flex min-h-9 min-w-0 items-center gap-1.5 rounded-md px-2 text-left transition-colors duration-hover motion-reduce:transition-none max-[900px]:min-h-11",
            "hover:bg-surface-base-hover focus-visible:outline-2 focus-visible:outline-border-strong-focus",
            open() && "bg-surface-base-active",
          )}
          aria-haspopup="dialog"
          aria-expanded={open()}
          aria-controls="app-map-test-switcher-menu"
          disabled={props.busy}
          onClick={() => {
            if (!props.busy) setOpen((value) => !value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" || props.busy) return;
            event.preventDefault();
            setOpen(true);
            queueMicrotask(() =>
              container?.querySelector<HTMLInputElement>("#app-map-test-switcher-search")?.focus(),
            );
          }}
        >
          <span class="truncate text-caption font-medium text-text-strong">
            {props.name || "Choose a Test"}
          </span>
          <Icon name="chevron-down" size={13} class="shrink-0 text-text-weak" />
        </button>
      </Show>

      <Show when={!props.busy && props.selectedTestId}>
        <TestOverflow
          disabled={false}
          onSource={props.onSource}
          onRename={() => setRenaming(true)}
          onDuplicate={props.onDuplicate}
          onDelete={props.onDelete}
        />
      </Show>

      <Show when={open()}>
        <div
          id="app-map-test-switcher-menu"
          class={cn(popover, "absolute top-[calc(100%+6px)] left-0 w-[min(320px,80vw)] p-0")}
          role="dialog"
          aria-label="Choose a Test"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          <div class="border-b border-border-weak-base p-2">
            <label class="relative block" for="app-map-test-switcher-search">
              <span class="sr-only">Find a Test</span>
              <Icon
                name="search"
                size={13}
                class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-weaker"
              />
              <input
                id="app-map-test-switcher-search"
                type="search"
                class={cn(testEditorInput, "pl-8")}
                placeholder="Find a Test…"
                autofocus
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusOption("first");
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    focusOption("last");
                  }
                }}
              />
            </label>
          </div>
          <div
            id="app-map-test-switcher-options"
            class="max-h-[min(320px,50vh)] overflow-y-auto p-1"
            role="listbox"
            aria-label="Tests on this map"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                focusOption("next");
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                focusOption("previous");
              } else if (event.key === "Home") {
                event.preventDefault();
                focusOption("first");
              } else if (event.key === "End") {
                event.preventDefault();
                focusOption("last");
              }
            }}
          >
            <For
              each={matches()}
              fallback={
                <p class="m-0 px-2.5 py-3 text-caption text-text-weak">
                  No Test matches that name.
                </p>
              }
            >
              {(test) => (
                <button
                  type="button"
                  role="option"
                  data-test-switcher-option={test.id}
                  aria-selected={test.id === props.selectedTestId}
                  class={cn(
                    menuItem,
                    "justify-between",
                    test.id === props.selectedTestId && "bg-surface-base-active text-text-strong",
                  )}
                  disabled={props.busy}
                  onClick={() => {
                    props.onSelect(test.id);
                    close();
                  }}
                >
                  <span class="min-w-0 truncate">{test.name}</span>
                  <span class="shrink-0 text-caption tabular-nums text-text-weaker">
                    {stepLabel(test)}
                  </span>
                </button>
              )}
            </For>
          </div>
          <div class="border-t border-border-weak-base p-1">
            <button
              type="button"
              class={cn(menuItem, "text-text-interactive-base")}
              disabled={props.busy || props.creating}
              onClick={() => {
                close(false);
                props.onCreate();
              }}
            >
              <Icon name="plus" size={13} />
              {props.creating ? "Creating…" : "New Test"}
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

function TestOverflow(props: {
  disabled: boolean;
  onSource: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <details
      class="relative shrink-0"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        event.currentTarget.removeAttribute("open");
        event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
      }}
    >
      <summary
        class={cn(productIconButton, "size-8 cursor-pointer list-none")}
        aria-label="Test options"
      >
        <Icon name="more" size={15} />
      </summary>
      <div class={cn(popover, "absolute top-[calc(100%+4px)] left-0 grid w-44")}>
        <button
          type="button"
          class={menuItem}
          disabled={props.disabled}
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            props.onSource();
          }}
        >
          <Icon name="edit" size={13} /> Edit Source
        </button>
        <button
          type="button"
          class={menuItem}
          disabled={props.disabled}
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            props.onRename();
          }}
        >
          <Icon name="edit" size={13} /> Rename Test
        </button>
        <button
          type="button"
          class={menuItem}
          disabled={props.disabled}
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            props.onDuplicate();
          }}
        >
          <Icon name="copy" size={13} /> Duplicate Test
        </button>
        <button
          type="button"
          class={cn(menuItem, "text-text-critical-base hover:text-icon-critical-base")}
          disabled={props.disabled}
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            props.onDelete();
          }}
        >
          <Icon name="trash" size={13} /> Delete Test…
        </button>
      </div>
    </details>
  );
}

function stepLabel(test: AppMapTest): string {
  const count = test.kind === "scenario" ? scenarioStepCount(test.steps) : 0;
  return `${count} ${count === 1 ? "step" : "steps"}`;
}

/**
 * This rail lists the steps of the Test being read, so with no Test open it has
 * nothing to list and says so quietly. The invitation to make one belongs to the
 * document pane beside it, which is the larger surface and the one a person is
 * looking at — two hero cards side by side offering the same button read as a
 * layout that had lost track of itself.
 */
export function StepsRailEmpty() {
  return (
    <div class="grid min-h-0 flex-1 place-items-center p-6 text-center">
      <p class="m-0 max-w-[28ch] text-caption/[1.5] text-text-weak">
        Steps appear here once a Test is open.
      </p>
    </div>
  );
}
