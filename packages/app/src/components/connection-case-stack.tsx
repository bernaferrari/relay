import { For, Show, createEffect, createSignal } from "solid-js";
import type { CaseExpansionStrategy, CaseStack, TestData } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { caseStackCount } from "../lib/case-stack-presentation";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

export type ConnectionCaseStackProps = {
  stack?: CaseStack;
  stacks: CaseStack[];
  variables: TestData[];
  busy?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSave: (input: { name: string; dataIds: string[]; strategy: CaseExpansionStrategy }) => void;
  onAttach: (caseStackId: string) => void;
  onDetach: () => void;
  onOpenVariables: () => void;
};

function humanizeName(value: string): string {
  const words = value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return words ? words[0]!.toLocaleUpperCase() + words.slice(1) : value;
}

export function ConnectionCaseStack(props: ConnectionCaseStackProps) {
  const [internalOpen, setInternalOpen] = createSignal(false);
  const open = () => props.open ?? internalOpen();
  const setOpen = (value: boolean) => {
    if (props.open === undefined) setInternalOpen(value);
    props.onOpenChange?.(value);
  };
  const [dataIds, setDataIds] = createSignal<string[]>([]);
  const [strategy, setStrategy] = createSignal<CaseExpansionStrategy>("zip");
  createEffect(() => {
    setDataIds(props.stack?.dataIds ?? []);
    setStrategy(props.stack?.strategy ?? "zip");
  });
  const selectedVariables = () =>
    props.variables.filter((variable) => dataIds().includes(variable.id));
  const countFor = (stack: Pick<CaseStack, "dataIds" | "strategy" | "maxCases">) =>
    caseStackCount(stack, props.variables);
  const draftCount = () =>
    countFor({
      dataIds: dataIds(),
      strategy: strategy(),
      maxCases: props.stack?.maxCases ?? 20,
    });
  const reusableStacks = () => props.stacks.filter((stack) => stack.id !== props.stack?.id);

  return (
    <section class="mt-3 border-t border-[var(--border-weak-base)] pt-2">
      <button
        type="button"
        class="group flex min-h-11 w-full items-center gap-2 rounded-lg px-1.5 text-left transition-colors duration-150 hover:bg-[var(--surface-base)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--surface-base-hover)] text-[var(--text-base)]">
          <Icon name="grid" size={11} />
        </span>
        <span class="min-w-0 flex-1">
          <strong class="block text-micro font-medium text-[var(--text-strong)]">
            {props.stack
              ? `${countFor(props.stack).exact ? "" : "~"}${countFor(props.stack).count} runs`
              : "Test data"}
          </strong>
          <span class="block truncate text-micro text-[var(--text-weak)]">
            {props.stack
              ? selectedVariables()
                  .map((variable) => humanizeName(variable.name))
                  .join(", ")
              : "Repeat this path with different input values"}
          </span>
        </span>
        <span
          class="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--text-weak)] transition-colors group-hover:text-[var(--text-strong)]"
          aria-hidden="true"
        >
          <Icon name={open() ? "chevron-up" : props.stack ? "edit" : "plus"} size={11} />
        </span>
      </button>

      <Show when={open()}>
        <div class="mt-1 grid gap-2 rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-base)] p-2">
          <Show when={reusableStacks().length > 0}>
            <div class="grid gap-1">
              <span class="px-1 text-micro font-medium text-[var(--text-weak)]">
                Saved input sets
              </span>
              <For each={reusableStacks()}>
                {(stack) => {
                  const count = () => countFor(stack);
                  return (
                    <button
                      type="button"
                      class="flex min-h-9 items-center gap-2 rounded-lg px-2 text-left text-micro transition-colors hover:bg-[var(--surface-base)] disabled:opacity-45"
                      disabled={props.busy}
                      onClick={() => {
                        props.onAttach(stack.id);
                        setOpen(false);
                      }}
                    >
                      <Icon name="grid" size={11} class="text-[var(--text-interactive-base)]" />
                      <span class="min-w-0 flex-1 truncate text-[var(--text-base)]">
                        {humanizeName(stack.name)}
                      </span>
                      <span class="text-micro tabular-nums text-[var(--text-weak)]">
                        {count().exact ? "" : "~"}
                        {count().count} runs
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
            <div class="h-px bg-[var(--border-weak-base)]" />
          </Show>

          <Show
            when={props.variables.length > 0}
            fallback={
              <div class="rounded-lg bg-[var(--surface-base)] p-2.5">
                <strong class="block text-micro text-[var(--text-strong)]">
                  Add test data first
                </strong>
                <p class="m-0 mt-1 text-micro/[1.45] text-[var(--text-weak)]">
                  Add a list such as low, medium, high, then repeat this path for each value.
                </p>
                <button
                  type="button"
                  class="mt-2 min-h-9 rounded-lg px-2 text-micro font-semibold text-[var(--text-interactive-base)] hover:bg-[var(--product-accent-soft)]"
                  onClick={props.onOpenVariables}
                >
                  Add test data
                </button>
              </div>
            }
          >
            <div class="grid max-h-36 gap-0.5 overflow-y-auto overscroll-contain pr-0.5">
              <span class="sticky top-0 z-[1] bg-[var(--surface-base)] px-1 pb-1 text-micro font-medium text-[var(--text-weak)]">
                Inputs to vary
              </span>
              <For each={props.variables}>
                {(variable) => {
                  const selected = () => dataIds().includes(variable.id);
                  return (
                    <button
                      type="button"
                      class={cn(
                        "flex min-h-9 items-center gap-2 rounded-lg px-2 text-left text-micro transition-colors duration-150 hover:bg-[var(--surface-base-hover)]",
                        selected() && "bg-[var(--product-accent-soft)]",
                      )}
                      aria-pressed={selected()}
                      onClick={() =>
                        setDataIds((current) =>
                          selected()
                            ? current.filter((id) => id !== variable.id)
                            : [...current, variable.id],
                        )
                      }
                    >
                      <span
                        class={cn(
                          "grid size-4 place-items-center rounded border border-[var(--border-strong-base)]",
                          selected() &&
                            "border-[var(--text-interactive-base)] bg-[var(--text-interactive-base)] text-[var(--button-primary-foreground,var(--icon-invert-base))]",
                        )}
                      >
                        <Show when={selected()}>
                          <Icon name="check" size={9} />
                        </Show>
                      </span>
                      <span class="min-w-0 flex-1 truncate text-[var(--text-base)]">
                        {humanizeName(variable.name)}
                      </span>
                      <span class="text-micro text-[var(--text-weak)]">
                        {variable.scope === "private"
                          ? "Private on this machine"
                          : `${Math.max(1, variable.values?.length ?? 1)} value${(variable.values?.length ?? 1) === 1 ? "" : "s"}`}
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
            <Show when={dataIds().length > 1}>
              <label class="grid gap-1">
                <span class="text-micro font-medium text-[var(--text-weak)]">
                  How selected values expand
                </span>
                <select
                  class="min-h-9 rounded-lg border border-[var(--border-weak-base)] bg-[var(--background-base)] px-2 text-micro text-[var(--text-base)] outline-none focus:border-[var(--border-focus)]"
                  value={strategy()}
                  onChange={(event) =>
                    setStrategy(event.currentTarget.value as CaseExpansionStrategy)
                  }
                >
                  <option value="zip">Match values by row</option>
                  <option value="pairwise">Cover every pair</option>
                  <option value="cartesian">Run every combination</option>
                </select>
              </label>
            </Show>
            <div class="flex min-h-10 items-center gap-2 border-t border-[var(--border-weak-base)] pt-2">
              <span class="min-w-0 flex-1 text-micro text-[var(--text-weak)]">
                {dataIds().length
                  ? `${draftCount().exact ? "" : "About "}${draftCount().count} run${draftCount().count === 1 ? "" : "s"}`
                  : "Select at least one input"}
              </span>
              <Button
                variant="primary"
                size="sm"
                class="shrink-0"
                disabled={dataIds().length === 0 || props.busy}
                onClick={() => {
                  const variables = selectedVariables();
                  props.onSave({
                    name:
                      props.stack?.name ??
                      (variables.length === 1 ? variables[0]!.name : "Test data"),
                    dataIds: dataIds(),
                    strategy: strategy(),
                  });
                  setOpen(false);
                }}
              >
                {props.busy ? "Saving…" : "Apply"}
              </Button>
              <Show when={props.stack}>
                <button
                  type="button"
                  class="min-h-10 rounded-lg px-2.5 text-micro text-[var(--text-weak)] hover:bg-[var(--surface-base)] hover:text-[var(--icon-critical-base)]"
                  onClick={props.onDetach}
                >
                  Detach
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </section>
  );
}
