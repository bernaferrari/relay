import { For, Show, createEffect, createSignal } from "solid-js";
import type { CaseExpansionStrategy, CaseStack, TestVariable } from "@relay/protocol";
import { caseStackCount } from "../lib/case-stack-presentation";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

export type ConnectionCaseStackProps = {
  stack?: CaseStack;
  stacks: CaseStack[];
  variables: TestVariable[];
  busy?: boolean;
  onSave: (input: { name: string; variableIds: string[]; strategy: CaseExpansionStrategy }) => void;
  onAttach: (caseStackId: string) => void;
  onDetach: () => void;
  onOpenVariables: () => void;
};

function humanizeName(value: string): string {
  const words = value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return words ? words[0]!.toLocaleUpperCase() + words.slice(1) : value;
}

export function ConnectionCaseStack(props: ConnectionCaseStackProps) {
  const [open, setOpen] = createSignal(false);
  const [variableIds, setVariableIds] = createSignal<string[]>([]);
  const [strategy, setStrategy] = createSignal<CaseExpansionStrategy>("zip");
  createEffect(() => {
    setVariableIds(props.stack?.variableIds ?? []);
    setStrategy(props.stack?.strategy ?? "zip");
  });
  const selectedVariables = () =>
    props.variables.filter((variable) => variableIds().includes(variable.id));
  const countFor = (stack: Pick<CaseStack, "variableIds" | "strategy" | "maxCases">) =>
    caseStackCount(stack, props.variables);
  const draftCount = () =>
    countFor({
      variableIds: variableIds(),
      strategy: strategy(),
      maxCases: props.stack?.maxCases ?? 20,
    });
  const reusableStacks = () => props.stacks.filter((stack) => stack.id !== props.stack?.id);

  return (
    <section class="mt-3 border-t border-[var(--v2-border-border-muted)] pt-2">
      <button
        type="button"
        class="flex min-h-11 w-full items-center gap-2 rounded-[8px] px-1.5 text-left transition-colors duration-150 hover:bg-[var(--v2-background-bg-layer-01)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        <span class="grid size-7 shrink-0 place-items-center rounded-[7px] bg-[var(--v2-background-bg-layer-02)] text-[var(--text-base)]">
          <Icon name="grid" size={11} />
        </span>
        <span class="min-w-0 flex-1">
          <strong class="block text-[10.5px] font-medium text-[var(--text-strong)]">
            {props.stack
              ? `${countFor(props.stack).exact ? "" : "~"}${countFor(props.stack).count} test cases`
              : "Test cases"}
          </strong>
          <span class="block truncate text-[9.5px] text-[var(--text-weak)]">
            {props.stack
              ? selectedVariables()
                  .map((variable) => humanizeName(variable.name))
                  .join(", ")
              : "Repeat this connection with different inputs"}
          </span>
        </span>
        <span class="text-[9.5px] font-medium text-[var(--text-weak)]">
          {props.stack ? "Edit" : "Add"}
        </span>
      </button>

      <Show when={open()}>
        <div class="mt-1 grid gap-2 rounded-[9px] bg-[color-mix(in_srgb,var(--v2-background-bg-layer-02)_66%,transparent)] px-2 py-2">
          <Show when={reusableStacks().length > 0}>
            <div class="grid gap-1">
              <span class="px-1 text-[9px] font-medium text-[var(--text-weak)]">Saved stacks</span>
              <For each={reusableStacks()}>
                {(stack) => {
                  const count = () => countFor(stack);
                  return (
                    <button
                      type="button"
                      class="flex min-h-9 items-center gap-2 rounded-[7px] px-2 text-left text-[10px] transition-colors hover:bg-[var(--v2-background-bg-layer-01)] disabled:opacity-45"
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
                      <span class="text-[9px] tabular-nums text-[var(--text-weak)]">
                        {count().exact ? "" : "~"}
                        {count().count} cases
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
            <div class="h-px bg-[var(--v2-border-border-muted)]" />
          </Show>

          <Show
            when={props.variables.length > 0}
            fallback={
              <div class="rounded-[7px] bg-[var(--v2-background-bg-layer-01)] p-2.5">
                <strong class="block text-[10.5px] text-[var(--text-strong)]">
                  Add a variable first
                </strong>
                <p class="m-0 mt-1 text-[9.5px]/[1.45] text-[var(--text-weak)]">
                  A list such as low, medium, high becomes a compact stack of test cases.
                </p>
                <button
                  type="button"
                  class="mt-2 min-h-9 rounded-[7px] px-2 text-[10px] font-semibold text-[var(--text-interactive-base)] hover:bg-[var(--product-accent-soft)]"
                  onClick={props.onOpenVariables}
                >
                  Add variables
                </button>
              </div>
            }
          >
            <div class="grid gap-1">
              <span class="px-1 text-[9px] font-medium text-[var(--text-weak)]">Inputs</span>
              <For each={props.variables}>
                {(variable) => {
                  const selected = () => variableIds().includes(variable.id);
                  return (
                    <button
                      type="button"
                      class={cn(
                        "flex min-h-9 items-center gap-2 rounded-[7px] px-2 text-left text-[10px] transition-colors duration-150 hover:bg-[var(--v2-background-bg-layer-01)]",
                        selected() && "bg-[var(--product-accent-soft)]",
                      )}
                      aria-pressed={selected()}
                      onClick={() =>
                        setVariableIds((current) =>
                          selected()
                            ? current.filter((id) => id !== variable.id)
                            : [...current, variable.id],
                        )
                      }
                    >
                      <span
                        class={cn(
                          "grid size-4 place-items-center rounded-[4px] border border-[var(--v2-border-border-strong)]",
                          selected() &&
                            "border-[var(--text-interactive-base)] bg-[var(--text-interactive-base)] text-white",
                        )}
                      >
                        <Show when={selected()}>
                          <Icon name="check" size={9} />
                        </Show>
                      </span>
                      <span class="min-w-0 flex-1 truncate text-[var(--text-base)]">
                        {humanizeName(variable.name)}
                      </span>
                      <span class="text-[9px] text-[var(--text-weak)]">
                        {variable.scope === "private"
                          ? "Private on this machine"
                          : `${Math.max(1, variable.values?.length ?? 1)} value${(variable.values?.length ?? 1) === 1 ? "" : "s"}`}
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
            <label class="grid gap-1">
              <span class="text-[9px] font-medium text-[var(--text-weak)]">Combine values</span>
              <select
                class="min-h-9 rounded-[7px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] px-2 text-[10px] text-[var(--text-base)] outline-none focus:border-[var(--border-focus)]"
                value={strategy()}
                onChange={(event) =>
                  setStrategy(event.currentTarget.value as CaseExpansionStrategy)
                }
              >
                <option value="zip">By row · low + personal, medium + work</option>
                <option value="pairwise">Every pair · fewer runs</option>
                <option value="cartesian">Every combination · most runs</option>
              </select>
            </label>
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="inline-flex min-h-10 flex-1 items-center justify-center rounded-[7px] bg-[var(--text-interactive-base)] px-3 text-[10px] font-semibold text-white shadow-[0_1px_2px_rgb(0_0_0/14%)] transition-[filter,transform] hover:brightness-105 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45"
                disabled={variableIds().length === 0 || props.busy}
                onClick={() => {
                  const variables = selectedVariables();
                  props.onSave({
                    name:
                      props.stack?.name ??
                      (variables.length === 1 ? variables[0]!.name : "Test cases"),
                    variableIds: variableIds(),
                    strategy: strategy(),
                  });
                  setOpen(false);
                }}
              >
                {props.busy
                  ? "Saving…"
                  : variableIds().length
                    ? `Use ${draftCount().exact ? "" : "~"}${draftCount().count} cases`
                    : "Choose inputs"}
              </button>
              <Show when={props.stack}>
                <button
                  type="button"
                  class="min-h-10 rounded-[7px] px-2.5 text-[10px] text-[var(--text-weak)] hover:bg-[var(--v2-background-bg-layer-01)] hover:text-[var(--icon-critical-base)]"
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
