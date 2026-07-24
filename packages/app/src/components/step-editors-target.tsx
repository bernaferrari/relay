import { For, Show, type JSX } from "solid-js";
import { type RecipeStep } from "../context/server";
import { detectedChain } from "../lib/step-target";
import { cn } from "../lib/cn";
import {
  fieldInput,
  fieldLabel,
  mono,
  propertySeg,
  propertySegBtn,
  propertySegBtnOn,
  propRow,
} from "../lib/ui";
import { ManualTarget } from "./step-list-controls";
import type { StepEditorFamilyProps } from "./step-editor-types";

const valueCls = cn(fieldInput, "min-w-0 flex-1");
const valueTimeoutCls = cn(fieldInput, "w-[52px] min-w-0 flex-none text-center tabular-nums");

export function TargetStepEditors(props: StepEditorFamilyProps): JSX.Element {
  const kind = () => props.step().kind;
  const onEdit = (next: RecipeStep) => props.onChange(next);
  const target = props.target;
  const strategy = props.strategy;
  const setStrategy = props.onStrategy;
  const setTarget = props.onPatchTarget;
  const retargetTap = props.onRetargetTap;
  return (
    <>
      <Show when={kind() === "tap"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "tap") return null;
          const chain = detectedChain(s.target);
          const hasDetected = chain.some((c) => c.id !== "point");
          if (!hasDetected) {
            return (
              <ManualTarget
                target={target}
                strategy={strategy}
                onStrategy={setStrategy}
                onPatch={setTarget}
                autofocus={props.autofocus}
                onAutofocused={props.onAutofocused}
              />
            );
          }
          return (
            <div class={propRow} role="radiogroup" aria-label="Retarget tap">
              <span class={fieldLabel}>Match</span>
              <div class="flex min-w-0 flex-col gap-0.5 overflow-hidden rounded-md bg-surface-raised-stronger-non-alpha p-0.5 ring-1 ring-inset ring-border-weak-base">
                <For each={chain}>
                  {(c) => {
                    const on = () => strategy() === c.id;
                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={on()}
                        class={cn(
                          "flex items-center gap-2 rounded-[5px] px-2 py-1.5 text-left transition-colors duration-100 ease-out",
                          on()
                            ? "bg-surface-base-active text-text-strong"
                            : "text-text-strong hover:bg-surface-raised-base-hover",
                        )}
                        onClick={() => retargetTap(c.id)}
                      >
                        <span
                          class={cn(
                            "size-1.5 shrink-0 rounded-full",
                            on() ? "bg-text-strong" : "bg-text-weak/45",
                          )}
                          aria-hidden="true"
                        />
                        <span
                          class={cn(
                            "min-w-10 shrink-0 text-12-medium leading-none",
                            on() ? "text-text-strong" : "text-text-weak",
                          )}
                        >
                          {c.label}
                        </span>
                        <span
                          class={cn(
                            mono,
                            "min-w-0 flex-1 truncate text-12-regular leading-none",
                            on() ? "font-medium text-text-strong" : "text-text-strong",
                          )}
                        >
                          {c.value}
                        </span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
          );
        })()}
      </Show>

      <Show when={kind() === "wait-for"}>
        <ManualTarget
          target={target}
          strategy={strategy}
          onStrategy={setStrategy}
          onPatch={setTarget}
          autofocus={props.autofocus}
          onAutofocused={props.onAutofocused}
        />
        {(() => {
          const s = props.step();
          if (s.kind !== "wait-for") return null;
          return (
            <div class={propRow}>
              <span class={fieldLabel}>Timeout</span>
              <span class="inline-flex h-8 items-center gap-1.5">
                <input
                  class={cn(valueTimeoutCls, mono)}
                  type="number"
                  min={0}
                  placeholder="5"
                  value={s.timeoutMs ? Math.round(s.timeoutMs / 1000) : ""}
                  onInput={(e) => {
                    const v = e.currentTarget.value;
                    onEdit({
                      ...s,
                      ...(v
                        ? { timeoutMs: (parseInt(v, 10) || 0) * 1000 }
                        : { timeoutMs: undefined }),
                    });
                  }}
                />
                <span class="text-[11px] text-text-weak">sec</span>
              </span>
            </div>
          );
        })()}
      </Show>

      <Show when={kind() === "wait-response"}>
        <ManualTarget
          target={target}
          strategy={strategy}
          onStrategy={setStrategy}
          onPatch={setTarget}
          autofocus={props.autofocus}
          onAutofocused={props.onAutofocused}
        />
        {(() => {
          const s = props.step();
          if (s.kind !== "wait-response") return null;
          const setOptionalTextTarget = (key: "busyTarget" | "idleTarget", value: string) =>
            onEdit({ ...s, [key]: value.trim() ? { text: value } : undefined });
          return (
            <>
              <div class={propRow}>
                <span class={fieldLabel}>Stable</span>
                <span class="inline-flex h-8 items-center gap-1.5">
                  <input
                    class={cn(valueTimeoutCls, mono)}
                    type="number"
                    min={0.5}
                    max={30}
                    step={0.5}
                    value={(s.stableForMs ?? 2_000) / 1_000}
                    onInput={(event) =>
                      onEdit({ ...s, stableForMs: Number(event.currentTarget.value) * 1_000 })
                    }
                  />
                  <span class="text-[11px] text-text-weak">sec</span>
                </span>
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Timeout</span>
                <span class="inline-flex h-8 items-center gap-1.5">
                  <input
                    class={cn(valueTimeoutCls, mono)}
                    type="number"
                    min={1}
                    max={900}
                    value={(s.timeoutMs ?? 90_000) / 1_000}
                    onInput={(event) =>
                      onEdit({ ...s, timeoutMs: Number(event.currentTarget.value) * 1_000 })
                    }
                  />
                  <span class="text-[11px] text-text-weak">sec</span>
                </span>
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Generating</span>
                <input
                  class={valueCls}
                  value={s.busyTarget?.text ?? s.busyTarget?.label ?? ""}
                  placeholder="optional indicator text"
                  onInput={(event) =>
                    setOptionalTextTarget("busyTarget", event.currentTarget.value)
                  }
                />
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Ready</span>
                <input
                  class={valueCls}
                  value={s.idleTarget?.text ?? s.idleTarget?.label ?? ""}
                  placeholder="optional idle control text"
                  onInput={(event) =>
                    setOptionalTextTarget("idleTarget", event.currentTarget.value)
                  }
                />
              </div>
              <p class="px-0.5 text-12-regular leading-relaxed text-text-weak">
                Relay waits for the response to change and become stable. Optional generating and
                ready indicators add an independent completion signal.
              </p>
            </>
          );
        })()}
      </Show>

      <Show when={kind() === "expect"}>
        <ManualTarget
          target={target}
          strategy={strategy}
          onStrategy={setStrategy}
          onPatch={setTarget}
          autofocus={props.autofocus}
          onAutofocused={props.onAutofocused}
        />
        {(() => {
          const s = props.step();
          if (s.kind !== "expect") return null;
          return (
            <>
              <div class={propRow}>
                <span class={fieldLabel}>When</span>
                <div class={propertySeg} role="group" aria-label="Condition">
                  {(
                    [
                      ["visible", "Visible"],
                      ["gone", "Gone"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      type="button"
                      class={s.condition === id ? propertySegBtnOn : propertySegBtn}
                      onClick={() => onEdit({ ...s, condition: id })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Timeout</span>
                <span class="inline-flex h-8 items-center gap-1.5">
                  <input
                    class={cn(valueTimeoutCls, mono)}
                    type="number"
                    min={0}
                    placeholder="5"
                    value={s.timeoutMs ? Math.round(s.timeoutMs / 1000) : ""}
                    onInput={(e) => {
                      const v = e.currentTarget.value;
                      onEdit({
                        ...s,
                        ...(v
                          ? { timeoutMs: (parseInt(v, 10) || 0) * 1000 }
                          : { timeoutMs: undefined }),
                      });
                    }}
                  />
                  <span class="text-[11px] text-text-weak">sec</span>
                </span>
              </div>
            </>
          );
        })()}
      </Show>

      <Show when={kind() === "extract"}>
        <ManualTarget
          target={target}
          strategy={strategy}
          onStrategy={setStrategy}
          onPatch={setTarget}
          autofocus={props.autofocus}
          onAutofocused={props.onAutofocused}
        />
        {(() => {
          const s = props.step();
          if (s.kind !== "extract") return null;
          return (
            <>
              <div class={propRow}>
                <span class={fieldLabel}>Save as</span>
                <input
                  class={cn(valueCls, mono)}
                  value={s.as}
                  placeholder="response"
                  onInput={(event) => onEdit({ ...s, as: event.currentTarget.value })}
                  spellcheck={false}
                />
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Role</span>
                <select
                  class={valueCls}
                  value={s.role ?? "assistant"}
                  onChange={(event) =>
                    onEdit({
                      ...s,
                      role: event.currentTarget.value as "user" | "assistant" | "system",
                    })
                  }
                >
                  <option value="assistant">Assistant</option>
                  <option value="user">User</option>
                  <option value="system">System</option>
                </select>
              </div>
            </>
          );
        })()}
      </Show>

      <Show when={kind() === "assert-content"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "assert-content") return null;
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
                <span class={fieldLabel}>Match</span>
                <select
                  class={valueCls}
                  value={s.match}
                  onChange={(event) =>
                    onEdit({ ...s, match: event.currentTarget.value as typeof s.match })
                  }
                >
                  <option value="contains">Contains</option>
                  <option value="exact">Exact</option>
                  <option value="not-contains">Does not contain</option>
                </select>
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Expected</span>
                <input
                  class={valueCls}
                  value={s.expected}
                  placeholder="required content"
                  onInput={(event) => onEdit({ ...s, expected: event.currentTarget.value })}
                />
              </div>
            </>
          );
        })()}
      </Show>

      <Show when={kind() === "evaluate-semantic"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "evaluate-semantic") return null;
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
                <span class={fieldLabel}>Criteria</span>
                <textarea
                  class={cn(valueCls, "min-h-20 resize-y py-1.5")}
                  value={s.criteria.join("\n")}
                  placeholder="One criterion per line"
                  onInput={(event) =>
                    onEdit({
                      ...s,
                      criteria: event.currentTarget.value
                        .split("\n")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Threshold</span>
                <input
                  class={cn(valueTimeoutCls, mono)}
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={s.threshold ?? 0.9}
                  onInput={(event) =>
                    onEdit({ ...s, threshold: Number(event.currentTarget.value) })
                  }
                />
              </div>
              <label class={propRow}>
                <span class={fieldLabel}>Confidence</span>
                <span class="grid size-[18px] place-items-center rounded text-[var(--text-interactive-base)]">
                  <input
                    type="checkbox"
                    checked={s.requireAgreement ?? false}
                    onChange={(event) =>
                      onEdit({ ...s, requireAgreement: event.currentTarget.checked })
                    }
                  />
                  Require a second judge to agree
                </span>
              </label>
              <Show when={s.requireAgreement}>
                <div class={propRow}>
                  <span class={fieldLabel}>Second judge</span>
                  <input
                    class={cn(valueCls, mono)}
                    value={s.secondProvider ?? ""}
                    placeholder="anthropic, openai, google, local"
                    onInput={(event) => onEdit({ ...s, secondProvider: event.currentTarget.value })}
                  />
                </div>
              </Show>
            </>
          );
        })()}
      </Show>
    </>
  );
}
