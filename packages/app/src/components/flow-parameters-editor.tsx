import { Index, Show } from "solid-js";
import type { RecipeParameter } from "../context/server";
import { useRecipeDraft } from "../context/recipe-draft";
import { cn } from "../lib/cn";
import { productIconButtonDanger, productSecondary } from "../lib/ui";
import { Icon } from "./icon";

export function FlowParametersEditor() {
  const draft = useRecipeDraft();
  const add = () => {
    const used = new Set(draft.parameters().map((parameter) => parameter.name));
    let index = draft.parameters().length + 1;
    while (used.has(`input_${index}`)) index += 1;
    draft.setParameters([
      ...draft.parameters(),
      { name: `input_${index}`, label: `Input ${index}`, required: true },
    ]);
  };
  const patch = (index: number, changes: Partial<RecipeParameter>) =>
    draft.setParameters(
      draft
        .parameters()
        .map((parameter, current) =>
          current === index ? { ...parameter, ...changes } : parameter,
        ),
    );
  const remove = (index: number) =>
    draft.setParameters(draft.parameters().filter((_, current) => current !== index));

  const field =
    "h-[30px] w-full min-w-0 rounded-[7px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)] px-2 text-[11px] text-[var(--text-strong)] outline-none focus:border-[var(--text-interactive-base)]";
  const label = "grid min-w-0 gap-1 text-[10px] text-[var(--text-weak)]";

  return (
    <div class="grid gap-2.5">
      <header class="flex items-center justify-between gap-3">
        <div class="grid min-w-0 gap-1">
          <h3 class="m-0 text-[12px] font-semibold leading-[1.2] text-[var(--text-strong)]">
            Inputs
          </h3>
          <p class="m-0 text-[10px]/[1.35] text-[var(--text-weak)]">
            Values changed when this flow is reused.
          </p>
        </div>
        <button
          type="button"
          class={cn(productSecondary, "min-h-8 shrink-0 whitespace-nowrap px-2.5 text-[10.5px]")}
          onClick={add}
        >
          <Icon name="plus" size={13} /> Add input
        </button>
      </header>
      <Show
        when={draft.parameters().length > 0}
        fallback={
          <div class="flex min-h-10 items-center gap-2 rounded-lg bg-[var(--v2-background-bg-layer-01)] px-3">
            <Icon name="check" size={13} class="shrink-0 text-[var(--text-weak)]" />
            <span class="text-[10.5px] text-[var(--text-weak)]">
              No inputs — recorded values will be used.
            </span>
          </div>
        }
      >
        <div class="grid gap-2">
          <Index each={draft.parameters()}>
            {(parameter, index) => (
              <article class="grid gap-2.5 rounded-[10px] border border-[var(--v2-border-border-muted)] bg-surface-raised-stronger-non-alpha p-[11px]">
                <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_28px] items-end gap-2 max-sm:grid-cols-1">
                  <label class={label}>
                    <span>Variable name</span>
                    <input
                      class={cn(field, "font-mono")}
                      value={parameter().name}
                      placeholder="login_email"
                      onInput={(event) => patch(index, { name: event.currentTarget.value })}
                    />
                  </label>
                  <label class={label}>
                    <span>Label</span>
                    <input
                      class={field}
                      value={parameter().label ?? ""}
                      placeholder="Login email"
                      onInput={(event) =>
                        patch(index, { label: event.currentTarget.value || undefined })
                      }
                    />
                  </label>
                  <label class="flex h-[30px] items-center gap-1.5 whitespace-nowrap text-[10px] text-[var(--text-base)]">
                    <input
                      type="checkbox"
                      checked={parameter().required === true}
                      onChange={(event) => patch(index, { required: event.currentTarget.checked })}
                    />
                    <span>Required</span>
                  </label>
                  <button
                    type="button"
                    class={productIconButtonDanger}
                    aria-label={`Remove ${parameter().label || parameter().name}`}
                    onClick={() => remove(index)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
                <div class="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                  <label class={label}>
                    <span>Default</span>
                    <input
                      class={cn(field, "font-mono")}
                      value={parameter().default ?? ""}
                      placeholder="Optional safe default"
                      onInput={(event) =>
                        patch(index, { default: event.currentTarget.value || undefined })
                      }
                    />
                  </label>
                  <label class={label}>
                    <span>Guidance</span>
                    <input
                      class={field}
                      value={parameter().description ?? ""}
                      placeholder="What the flow expects"
                      onInput={(event) =>
                        patch(index, { description: event.currentTarget.value || undefined })
                      }
                    />
                  </label>
                </div>
              </article>
            )}
          </Index>
        </div>
      </Show>
      <Show when={draft.parameterIssue()}>
        {(message) => (
          <p
            class="m-0 rounded-lg border border-[color-mix(in_srgb,var(--icon-critical-base)_45%,var(--v2-border-border-muted))] bg-[color-mix(in_srgb,var(--icon-critical-base)_8%,transparent)] px-2.5 py-2 text-[11px] text-[var(--icon-critical-base)]"
            role="alert"
          >
            {message()}
          </p>
        )}
      </Show>
    </div>
  );
}
