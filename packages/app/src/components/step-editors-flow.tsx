import { For, Show, type JSX } from "solid-js";
import { useServer, type RecipeStep } from "../context/server";
import { titleize } from "../lib/job";
import { cn } from "../lib/cn";
import { fieldInput, fieldLabel, mono, propRow } from "../lib/ui";
import type { StepEditorFamilyProps } from "./step-editor-types";

const valueCls = cn(fieldInput, "min-w-0 flex-1");
const valueTimeoutCls = cn(fieldInput, "w-[52px] min-w-0 flex-none text-center tabular-nums");

export function FlowStepEditors(props: StepEditorFamilyProps): JSX.Element {
  const server = useServer();
  const kind = () => props.step().kind;
  const onEdit = (next: RecipeStep) => props.onChange(next);
  return (
    <>
      <Show when={kind() === "flow"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "flow") return null;
          const flows = server.recipes().filter((r) => r.source === "builtin");
          return (
            <div class={propRow}>
              <span class={fieldLabel}>Flow</span>
              <select
                class={valueCls}
                aria-label="Built-in flow"
                value={s.flow}
                onChange={(e) => onEdit({ kind: "flow", flow: e.currentTarget.value })}
              >
                <Show when={s.flow && !flows.some((f) => f.id === s.flow)}>
                  <option value={s.flow}>{titleize(s.flow, server.recipes())}</option>
                </Show>
                <For each={flows}>{(f) => <option value={f.id}>{f.title}</option>}</For>
              </select>
            </div>
          );
        })()}
      </Show>

      <Show when={kind() === "module"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "module") return null;
          const choices = server.recipes().filter((r) => r.id !== server.selectedAppMapId());
          const attached = () => choices.find((recipe) => recipe.id === s.recipeId);
          const parameters = () => attached()?.parameters ?? [];
          const setBinding = (name: string, value: string) => {
            const next = { ...s.bindings };
            if (value.trim()) next[name] = value;
            else delete next[name];
            onEdit({
              ...s,
              ...(Object.keys(next).length ? { bindings: next } : { bindings: undefined }),
            });
          };
          return (
            <>
              <div class={propRow}>
                <span class={fieldLabel}>Attached setup</span>
                <select
                  class={valueCls}
                  value={s.recipeId}
                  onChange={(e) => onEdit({ ...s, recipeId: e.currentTarget.value })}
                >
                  <option value="">Choose a recorded or reusable test…</option>
                  <For each={choices}>
                    {(r) => (
                      <option value={r.id}>
                        {r.title}
                        {r.parameters?.length
                          ? ` · ${r.parameters.length} input${r.parameters.length === 1 ? "" : "s"}`
                          : ""}
                      </option>
                    )}
                  </For>
                </select>
              </div>
              <Show when={parameters().length > 0}>
                <div class="my-0.5 mb-1 grid gap-2 rounded-[9px] border border-[var(--v2-border-border-muted)] bg-[color-mix(in_srgb,var(--v2-background-bg-layer-01)_60%,transparent)] p-2.5">
                  <div class="flex items-center justify-between gap-2 text-[11px] font-semibold text-[var(--text-base)]">
                    <span>Flow inputs</span>
                    <small class="text-[10px] font-normal text-[var(--text-weak)]">
                      Used in this run
                    </small>
                  </div>
                  <For each={parameters()}>
                    {(parameter) => (
                      <label class="grid gap-1 text-[10px] text-[var(--text-base)]">
                        <span class="flex items-center justify-between gap-2">
                          {parameter.label || parameter.name}
                          <Show when={parameter.required}>
                            <b
                              class="text-[9px] font-semibold tracking-[0.03em] text-[var(--icon-warning-base)] uppercase"
                              aria-label="Required"
                            >
                              Required
                            </b>
                          </Show>
                        </span>
                        <input
                          class={cn(valueCls, mono)}
                          value={s.bindings?.[parameter.name] ?? ""}
                          placeholder={parameter.default ?? `{{${parameter.name}}}`}
                          onInput={(event) => setBinding(parameter.name, event.currentTarget.value)}
                        />
                        <Show when={parameter.description}>
                          <small class="text-[10px] font-normal leading-[1.35] text-[var(--text-weak)]">
                            {parameter.description}
                          </small>
                        </Show>
                      </label>
                    )}
                  </For>
                </div>
              </Show>
              <p class="mt-1 text-[11px] leading-[1.45] text-[var(--text-weak)]">
                Record any repeatable routine once—sign-in, onboarding, permissions, or a recovery
                path—then attach it here. It stays editable and receives this run’s frozen
                variables, such as {"{{login_email}}"}.
              </p>
            </>
          );
        })()}
      </Show>

      <Show when={kind() === "branch"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "branch") return null;
          const choices = server.recipes().filter((r) => r.id !== server.selectedAppMapId());
          return (
            <>
              <div class={propRow}>
                <span class={fieldLabel}>Input</span>
                <input
                  class={cn(valueCls, mono)}
                  value={s.input}
                  placeholder="response"
                  onInput={(event) => onEdit({ ...s, input: event.currentTarget.value })}
                />
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Condition</span>
                <select
                  class={valueCls}
                  value={s.operator}
                  onChange={(event) =>
                    onEdit({ ...s, operator: event.currentTarget.value as typeof s.operator })
                  }
                >
                  <option value="contains">Contains</option>
                  <option value="equals">Equals</option>
                  <option value="not-equals">Does not equal</option>
                  <option value="exists">Exists</option>
                </select>
              </div>
              <Show when={s.operator !== "exists"}>
                <div class={propRow}>
                  <span class={fieldLabel}>Value</span>
                  <input
                    class={valueCls}
                    value={s.expected ?? ""}
                    onInput={(event) => onEdit({ ...s, expected: event.currentTarget.value })}
                  />
                </div>
              </Show>
              <div class={propRow}>
                <span class={fieldLabel}>If matched</span>
                <select
                  class={valueCls}
                  value={s.thenRecipeId}
                  onChange={(event) => onEdit({ ...s, thenRecipeId: event.currentTarget.value })}
                >
                  <option value="">Choose a test…</option>
                  <For each={choices}>
                    {(recipe) => <option value={recipe.id}>{recipe.title}</option>}
                  </For>
                </select>
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Otherwise</span>
                <select
                  class={valueCls}
                  value={s.elseRecipeId ?? ""}
                  onChange={(event) =>
                    onEdit({ ...s, elseRecipeId: event.currentTarget.value || undefined })
                  }
                >
                  <option value="">Continue without branching</option>
                  <For each={choices}>
                    {(recipe) => <option value={recipe.id}>{recipe.title}</option>}
                  </For>
                </select>
              </div>
            </>
          );
        })()}
      </Show>

      <Show when={kind() === "repeat"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "repeat") return null;
          const choices = server.recipes().filter((r) => r.id !== server.selectedAppMapId());
          return (
            <>
              <div class={propRow}>
                <span class={fieldLabel}>Test</span>
                <select
                  class={valueCls}
                  value={s.recipeId}
                  onChange={(event) => onEdit({ ...s, recipeId: event.currentTarget.value })}
                >
                  <option value="">Choose a reusable test…</option>
                  <For each={choices}>
                    {(recipe) => <option value={recipe.id}>{recipe.title}</option>}
                  </For>
                </select>
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Times</span>
                <input
                  class={cn(valueTimeoutCls, mono)}
                  type="number"
                  min={1}
                  max={20}
                  value={s.count}
                  onInput={(event) => onEdit({ ...s, count: Number(event.currentTarget.value) })}
                />
              </div>
            </>
          );
        })()}
      </Show>

      <Show when={kind() === "script"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "script") return null;
          return (
            <>
              <div class={propRow}>
                <span class={fieldLabel}>Commands</span>
                <textarea
                  class={cn(valueCls, mono, "min-h-24 resize-y py-2")}
                  value={s.source}
                  spellcheck={false}
                  onInput={(event) => onEdit({ ...s, source: event.currentTarget.value })}
                />
              </div>
              <p class="mt-1 text-[11px] leading-[1.45] text-[var(--text-weak)]">
                Safe commands: set name = value, copy new = existing, delete name, assert name
                contains value.
              </p>
            </>
          );
        })()}
      </Show>
    </>
  );
}
