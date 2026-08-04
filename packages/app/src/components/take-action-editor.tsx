import { For, Show, createEffect, createSignal, createUniqueId, type JSX } from "solid-js";
import type { AuthoringInteraction, StepTarget } from "@relay/protocol";
import type { RecordingTakeAction } from "../context/recorder";
import { cn } from "../lib/cn";
import { STRATEGIES, type Strategy } from "../lib/step-target";
import { Icon } from "./icon";

/** Focused editor for one interaction in an uncommitted Take. */
import {
  TAKE_ACTION_KINDS,
  interactionForAction,
  interactionWithKind,
  strategyForTarget,
  takeActionError,
  targetValue,
  targetWithStrategy,
  type TakeActionKind,
} from "./take-action-model";

const field =
  "h-11 w-full rounded-[8px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[16px] text-[var(--text-strong)] outline-none transition-[border-color,box-shadow] duration-100 placeholder:text-[var(--text-weak)] focus-visible:border-[var(--text-interactive-base)] focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--text-interactive-base)_14%,transparent)] min-[761px]:text-[12px]";
const label = "grid gap-1.5 text-[10.5px] font-medium text-[var(--text-base)]";
const iconButton =
  "grid size-11 shrink-0 place-items-center rounded-[8px] text-[var(--text-weak)] transition-[background-color,color,transform] duration-100 hover:bg-[var(--v2-background-bg-layer-03)] hover:text-[var(--text-strong)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] disabled:cursor-not-allowed disabled:opacity-35";

type BindingRow = { id: number; name: string; value: string };

export function TakeActionEditor(props: {
  action: RecordingTakeAction;
  pending?: boolean;
  onSave: (interaction: AuthoringInteraction) => void | Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const titleId = createUniqueId();
  const errorId = createUniqueId();
  const [draft, setDraft] = createSignal<AuthoringInteraction>(interactionForAction(props.action));
  const [strategy, setStrategy] = createSignal<Strategy>(
    strategyForTarget(targetFrom(interactionForAction(props.action))),
  );
  const [error, setError] = createSignal<string>();
  const [bindingRows, setBindingRows] = createSignal<BindingRow[]>([]);
  let nextBindingId = 1;
  let firstField: HTMLSelectElement | undefined;

  createEffect(() => {
    const interaction = interactionForAction(props.action);
    setDraft(interaction);
    setStrategy(strategyForTarget(targetFrom(interaction)));
    setBindingRows(
      interaction.kind === "reusable"
        ? Object.entries(interaction.bindings ?? {}).map(([name, value]) => ({
            id: nextBindingId++,
            name,
            value,
          }))
        : [],
    );
    setError(undefined);
    if (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) return;
    queueMicrotask(() => firstField?.focus({ preventScroll: true }));
  });

  function updateTarget(target: StepTarget | undefined): void {
    setDraft((current) => {
      if (current.kind === "tap") return { ...current, target: target ?? {} };
      if (current.kind === "type")
        return target
          ? { ...current, target }
          : { kind: "type", text: current.text, mode: "append" };
      return current;
    });
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    let next = draft();
    if (next.kind === "reusable") {
      const rows = bindingRows();
      const names = rows.map((row) => row.name.trim());
      if (names.some((name) => !name) || new Set(names).size !== names.length) {
        setError(
          names.some((name) => !name)
            ? "Every routine input needs a name."
            : "Routine input names must be unique.",
        );
        queueMicrotask(() => firstField?.focus({ preventScroll: true }));
        return;
      }
      next = {
        ...next,
        ...(rows.length
          ? { bindings: Object.fromEntries(rows.map((row) => [row.name.trim(), row.value])) }
          : { bindings: undefined }),
      };
    }
    const nextError = takeActionError(next);
    if (nextError) {
      setError(nextError);
      queueMicrotask(() => firstField?.focus({ preventScroll: true }));
      return;
    }
    setError(undefined);
    await props.onSave(next);
  }

  return (
    <form
      class="grid gap-3 border-t border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] px-3 py-3"
      aria-labelledby={titleId}
      aria-describedby={error() ? errorId : undefined}
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        props.onCancel();
      }}
    >
      <div class="flex items-center justify-between gap-3">
        <strong id={titleId} class="text-[11.5px] font-semibold text-[var(--text-strong)]">
          Edit action
        </strong>
        <span class="text-[9.5px] text-[var(--text-weak)]">Changes require replay</span>
      </div>

      <label class={label}>
        Action
        <select
          ref={(element) => {
            firstField = element;
          }}
          class={field}
          value={draft().kind}
          disabled={props.pending}
          onChange={(event) => {
            const next = interactionWithKind(draft(), event.currentTarget.value as TakeActionKind);
            setDraft(next);
            setStrategy(strategyForTarget(targetFrom(next)));
            setError(undefined);
          }}
        >
          <For each={TAKE_ACTION_KINDS}>
            {(kind) => <option value={kind.id}>{kind.label}</option>}
          </For>
        </select>
      </label>

      <Show when={draft().kind === "tap" || draft().kind === "type"}>
        <Show when={draft().kind !== "type" || targetFrom(draft())}>
          <TargetFields
            target={() => targetFrom(draft())}
            strategy={strategy}
            disabled={props.pending}
            onStrategy={setStrategy}
            onTarget={updateTarget}
          />
        </Show>
      </Show>

      <Show when={draft().kind === "type"}>
        {(() => {
          const interaction = draft();
          if (interaction.kind !== "type") return null;
          return (
            <>
              <label class={label}>
                Text to type
                <input
                  class={field}
                  value={interaction.text}
                  disabled={props.pending}
                  spellcheck={false}
                  autocomplete="off"
                  onInput={(event) => setDraft({ ...interaction, text: event.currentTarget.value })}
                />
              </label>
              <label class="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[8px] px-1 text-[11px] text-[var(--text-base)]">
                <input
                  type="checkbox"
                  checked={Boolean(interaction.target)}
                  disabled={props.pending}
                  onChange={(event) =>
                    updateTarget(
                      event.currentTarget.checked ? (interaction.target ?? {}) : undefined,
                    )
                  }
                />
                Type into a specific element
              </label>
              <Show when={interaction.target}>
                <label class={label}>
                  Existing text
                  <select
                    class={field}
                    value={interaction.mode ?? "append"}
                    disabled={props.pending}
                    onChange={(event) =>
                      setDraft({
                        ...interaction,
                        mode: event.currentTarget.value as "append" | "replace",
                      })
                    }
                  >
                    <option value="append">Append</option>
                    <option value="replace">Replace</option>
                  </select>
                </label>
              </Show>
            </>
          );
        })()}
      </Show>

      <Show when={draft().kind === "swipe"}>
        {(() => {
          const interaction = draft();
          if (interaction.kind !== "swipe") return null;
          const numberField = (
            fieldLabel: string,
            value: number,
            onValue: (value: number) => void,
          ) => (
            <label class={label}>
              {fieldLabel}
              <input
                class={field}
                type="number"
                min={0}
                value={value}
                disabled={props.pending}
                onInput={(event) => onValue(Number(event.currentTarget.value))}
              />
            </label>
          );
          return (
            <div class="grid grid-cols-2 gap-2">
              {numberField("Start X", interaction.from.x, (x) =>
                setDraft({ ...interaction, from: { ...interaction.from, x } }),
              )}
              {numberField("Start Y", interaction.from.y, (y) =>
                setDraft({ ...interaction, from: { ...interaction.from, y } }),
              )}
              {numberField("End X", interaction.to.x, (x) =>
                setDraft({ ...interaction, to: { ...interaction.to, x } }),
              )}
              {numberField("End Y", interaction.to.y, (y) =>
                setDraft({ ...interaction, to: { ...interaction.to, y } }),
              )}
              <label class={cn(label, "col-span-2")}>
                Duration (ms)
                <input
                  class={field}
                  type="number"
                  min={0}
                  value={interaction.durationMs ?? 300}
                  disabled={props.pending}
                  onInput={(event) =>
                    setDraft({ ...interaction, durationMs: Number(event.currentTarget.value) })
                  }
                />
              </label>
            </div>
          );
        })()}
      </Show>

      <Show when={draft().kind === "key"}>
        {(() => {
          const interaction = draft();
          if (interaction.kind !== "key") return null;
          return (
            <label class={label}>
              Key
              <select
                class={field}
                value={interaction.key}
                disabled={props.pending}
                onChange={(event) =>
                  setDraft({ ...interaction, key: event.currentTarget.value as "back" | "home" })
                }
              >
                <option value="back">Back</option>
                <option value="home">Home</option>
              </select>
            </label>
          );
        })()}
      </Show>

      <Show when={draft().kind === "wait"}>
        {(() => {
          const interaction = draft();
          if (interaction.kind !== "wait") return null;
          return (
            <label class={label}>
              Wait time
              <span class="relative block">
                <input
                  class={cn(field, "pr-9 tabular-nums")}
                  type="number"
                  min={0}
                  step={0.1}
                  value={Number((interaction.ms / 1_000).toFixed(2))}
                  disabled={props.pending}
                  onInput={(event) =>
                    setDraft({
                      ...interaction,
                      ms: Math.max(0, Math.round(Number(event.currentTarget.value) * 1_000)),
                    })
                  }
                />
                <span class="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-[10.5px] text-[var(--text-weak)]">
                  sec
                </span>
              </span>
            </label>
          );
        })()}
      </Show>

      <Show when={draft().kind === "observe" || draft().kind === "screenshot"}>
        {(() => {
          const interaction = draft();
          if (interaction.kind !== "observe" && interaction.kind !== "screenshot") return null;
          return (
            <label class={label}>
              Label <span class="font-normal text-[var(--text-weak)]">(optional)</span>
              <input
                class={field}
                value={interaction.label ?? ""}
                disabled={props.pending}
                onInput={(event) =>
                  setDraft({ ...interaction, label: event.currentTarget.value || undefined })
                }
              />
            </label>
          );
        })()}
      </Show>

      <Show when={draft().kind === "reusable"}>
        {(() => {
          const interaction = draft();
          if (interaction.kind !== "reusable") return null;
          return (
            <>
              <label class={label}>
                Routine ID
                <input
                  class={field}
                  value={interaction.recipeId}
                  disabled={props.pending}
                  spellcheck={false}
                  onInput={(event) =>
                    setDraft({ ...interaction, recipeId: event.currentTarget.value })
                  }
                />
              </label>
              <div class="grid gap-2" aria-label="Routine inputs">
                <For each={bindingRows()}>
                  {(row) => (
                    <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] gap-2">
                      <input
                        class={field}
                        value={row.name}
                        placeholder="Input name"
                        aria-label="Routine input name"
                        disabled={props.pending}
                        spellcheck={false}
                        onInput={(event) =>
                          setBindingRows((rows) =>
                            rows.map((candidate) =>
                              candidate.id === row.id
                                ? { ...candidate, name: event.currentTarget.value }
                                : candidate,
                            ),
                          )
                        }
                      />
                      <input
                        class={field}
                        value={row.value}
                        placeholder="Value"
                        aria-label="Routine input value"
                        disabled={props.pending}
                        onInput={(event) =>
                          setBindingRows((rows) =>
                            rows.map((candidate) =>
                              candidate.id === row.id
                                ? { ...candidate, value: event.currentTarget.value }
                                : candidate,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        class={iconButton}
                        aria-label="Remove routine input"
                        disabled={props.pending}
                        onClick={() =>
                          setBindingRows((rows) =>
                            rows.filter((candidate) => candidate.id !== row.id),
                          )
                        }
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </div>
                  )}
                </For>
                <button
                  type="button"
                  class="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[8px] border border-[var(--v2-border-border-muted)] px-3 text-[11px] font-medium text-[var(--text-base)] transition-[background-color,color] duration-100 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                  disabled={props.pending}
                  onClick={() =>
                    setBindingRows((rows) => [
                      ...rows,
                      { id: nextBindingId++, name: "", value: "" },
                    ])
                  }
                >
                  <Icon name="plus" size={12} /> Add input
                </button>
              </div>
            </>
          );
        })()}
      </Show>

      <Show when={draft().kind === "steps"}>
        <p class="m-0 rounded-[8px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)] px-3 py-2.5 text-[10.5px]/[1.5] text-[var(--text-weak)]">
          This action contains custom or grouped steps. They will stay unchanged unless you choose
          another action type.
        </p>
      </Show>

      <Show when={error()}>
        {(message) => (
          <p
            id={errorId}
            class="m-0 flex items-start gap-2 rounded-[8px] bg-[color-mix(in_srgb,var(--icon-critical-base)_8%,transparent)] px-3 py-2.5 text-[10.5px]/[1.45] text-[var(--icon-critical-base)]"
            role="alert"
          >
            <Icon name="alert" size={12} class="mt-0.5 shrink-0" /> {message()}
          </p>
        )}
      </Show>

      <div class="grid grid-cols-2 gap-2">
        <button
          type="button"
          class="min-h-11 rounded-[8px] px-3 text-[11px] font-medium text-[var(--text-base)] transition-[background-color,color] duration-100 hover:bg-[var(--v2-background-bg-layer-03)] hover:text-[var(--text-strong)]"
          disabled={props.pending}
          onClick={props.onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          class="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[8px] bg-[var(--product-accent-soft)] px-3 text-[11.5px] font-semibold text-[var(--text-interactive-base)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_18%,transparent)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
          disabled={props.pending}
        >
          <Show when={props.pending} fallback={<Icon name="check" size={12} />}>
            <Icon name="refresh" size={12} class="motion-safe:animate-spin" />
          </Show>
          {props.pending ? "Saving…" : "Save action"}
        </button>
      </div>
    </form>
  );
}

function TargetFields(props: {
  target: () => StepTarget | undefined;
  strategy: () => Strategy;
  disabled?: boolean;
  onStrategy: (strategy: Strategy) => void;
  onTarget: (target: StepTarget) => void;
}): JSX.Element {
  return (
    <div class="grid grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] gap-2">
      <label class={label}>
        Find by
        <select
          class={field}
          value={props.strategy()}
          disabled={props.disabled}
          onChange={(event) => {
            const next = event.currentTarget.value as Strategy;
            props.onStrategy(next);
            props.onTarget(
              targetWithStrategy(props.target(), next, targetValue(props.target(), next)),
            );
          }}
        >
          <For each={STRATEGIES}>
            {(strategy) => <option value={strategy.id}>{strategy.label}</option>}
          </For>
        </select>
      </label>
      <label class={label}>
        Target
        <input
          class={field}
          value={targetValue(props.target(), props.strategy())}
          placeholder={STRATEGIES.find((item) => item.id === props.strategy())?.placeholder}
          disabled={props.disabled}
          spellcheck={false}
          autocomplete="off"
          onInput={(event) =>
            props.onTarget(
              targetWithStrategy(props.target(), props.strategy(), event.currentTarget.value),
            )
          }
        />
      </label>
    </div>
  );
}

function targetFrom(interaction: AuthoringInteraction): StepTarget | undefined {
  if (interaction.kind === "tap" || interaction.kind === "type") return interaction.target;
  return undefined;
}
