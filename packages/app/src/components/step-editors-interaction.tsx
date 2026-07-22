import { Show, createEffect, type JSX } from "solid-js";
import { type RecipeStep } from "../context/server";
import { cn } from "../lib/cn";
import { fieldInput, fieldLabel, mono, propRow, seg, segBtn, segBtnOn } from "../lib/ui";
import type { StepEditorFamilyProps } from "./step-editor-types";

const valueCls = cn(fieldInput, "min-w-0 flex-1");
const valueTimeoutCls = cn(fieldInput, "w-[52px] min-w-0 flex-none text-center tabular-nums");

export function InteractionStepEditors(props: StepEditorFamilyProps): JSX.Element {
  const kind = () => props.step().kind;
  const onEdit = (next: RecipeStep) => props.onChange(next);
  return (
    <>
      <Show when={kind() === "type"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "type") return null;
          let inputEl: HTMLInputElement | undefined;
          createEffect(() => {
            if (props.autofocus()) {
              inputEl?.focus();
              props.onAutofocused();
            }
          });
          return (
            <div class={propRow}>
              <span class={fieldLabel}>Text</span>
              <input
                ref={(el) => {
                  inputEl = el;
                }}
                class={cn(valueCls, mono)}
                type="text"
                placeholder="text to type"
                value={s.text}
                onInput={(e) => onEdit({ ...s, text: e.currentTarget.value })}
                spellcheck={false}
              />
            </div>
          );
        })()}
      </Show>

      <Show when={kind() === "sleep"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "sleep") return null;
          let inputEl: HTMLInputElement | undefined;
          createEffect(() => {
            if (props.autofocus()) {
              inputEl?.focus();
              props.onAutofocused();
            }
          });
          return (
            <div class={propRow}>
              <span class={fieldLabel}>Wait</span>
              <span class="inline-flex h-7 items-center gap-1.5">
                <input
                  ref={(el) => {
                    inputEl = el;
                  }}
                  class={cn(valueTimeoutCls, mono)}
                  type="number"
                  min={0}
                  placeholder="500"
                  value={s.ms}
                  onInput={(e) => onEdit({ ...s, ms: parseInt(e.currentTarget.value, 10) || 0 })}
                />
                <span class="text-12-regular text-text-weak">ms</span>
              </span>
            </div>
          );
        })()}
      </Show>

      <Show when={kind() === "pause"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "pause") return null;
          let inputEl: HTMLInputElement | undefined;
          createEffect(() => {
            if (props.autofocus()) {
              inputEl?.focus();
              props.onAutofocused();
            }
          });
          return (
            <div class="flex min-w-0 flex-col gap-2">
              <div class={propRow}>
                <span class={fieldLabel}>What you need to do</span>
                <input
                  ref={(el) => {
                    inputEl = el;
                  }}
                  class={valueCls}
                  type="text"
                  placeholder="e.g. approve the Okta sign-in"
                  value={s.message}
                  onInput={(e) => onEdit({ ...s, message: e.currentTarget.value })}
                  spellcheck={false}
                />
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Reason</span>
                <select
                  class={valueCls}
                  value={s.reason ?? "other"}
                  onChange={(e) =>
                    onEdit({
                      ...s,
                      reason: e.currentTarget.value as NonNullable<typeof s.reason>,
                    })
                  }
                >
                  <option value="authentication">Authentication</option>
                  <option value="consent">Consent / approval</option>
                  <option value="verification">Verification code</option>
                  <option value="captcha">CAPTCHA</option>
                  <option value="permission">Permission prompt</option>
                  <option value="review">Review before continuing</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Continue button</span>
                <input
                  class={valueCls}
                  type="text"
                  placeholder="Continue test"
                  value={s.resumeLabel ?? ""}
                  onInput={(e) => onEdit({ ...s, resumeLabel: e.currentTarget.value || undefined })}
                />
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Timeout</span>
                <span class="inline-flex h-7 min-w-0 flex-1 items-center gap-1.5">
                  <input
                    class={cn(valueTimeoutCls, mono)}
                    type="number"
                    min={1}
                    max={1440}
                    placeholder="none"
                    value={s.timeoutMs ? Math.round(s.timeoutMs / 60_000) : ""}
                    onInput={(e) => {
                      const minutes = Number(e.currentTarget.value);
                      onEdit({
                        ...s,
                        timeoutMs:
                          Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : undefined,
                      });
                    }}
                  />
                  <span class="text-12-regular text-text-weak">minutes</span>
                </span>
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Verify after</span>
                <select
                  class="h-7 w-[7.5rem] shrink-0 rounded-md border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2 text-12-regular text-text-strong outline-none focus:border-border-interactive-base"
                  value={s.verifyAfter?.condition ?? "visible"}
                  disabled={!s.verifyAfter}
                  onChange={(e) =>
                    s.verifyAfter &&
                    onEdit({
                      ...s,
                      verifyAfter: {
                        ...s.verifyAfter,
                        condition: e.currentTarget.value as "visible" | "gone",
                      },
                    })
                  }
                >
                  <option value="visible">is visible</option>
                  <option value="gone">is gone</option>
                </select>
                <input
                  class={valueCls}
                  type="text"
                  placeholder="Optional screen or control text"
                  value={s.verifyAfter?.target.label ?? s.verifyAfter?.target.text ?? ""}
                  onInput={(e) => {
                    const value = e.currentTarget.value.trim();
                    onEdit({
                      ...s,
                      verifyAfter: value
                        ? {
                            target: { label: value },
                            condition: s.verifyAfter?.condition ?? "visible",
                            ...(s.verifyAfter?.timeoutMs !== undefined
                              ? { timeoutMs: s.verifyAfter.timeoutMs }
                              : {}),
                          }
                        : undefined,
                    });
                  }}
                />
              </div>
              <p class="m-0 px-0.5 text-12-regular leading-relaxed text-text-weak">
                The run pauses on the live device. Act in the app, then press Continue test. Add a
                post-handoff check to make Relay confirm the expected state before advancing.
              </p>
            </div>
          );
        })()}
      </Show>

      <Show when={kind() === "key"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "key") return null;
          return (
            <div class={propRow}>
              <span class={fieldLabel}>Key</span>
              <div class={cn(seg, "w-fit")} role="group" aria-label="Key">
                {(
                  [
                    ["back", "Back"],
                    ["home", "Home"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    type="button"
                    class={s.key === id ? segBtnOn : segBtn}
                    onClick={() => onEdit({ kind: "key", key: id })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
      </Show>

      <Show when={kind() === "scroll"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "scroll") return null;
          return (
            <>
              <div class={propRow}>
                <span class={fieldLabel}>Direction</span>
                <div class={seg} role="group" aria-label="Direction">
                  {(
                    [
                      ["down", "Down"],
                      ["up", "Up"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      type="button"
                      class={s.direction === id ? segBtnOn : segBtn}
                      onClick={() =>
                        onEdit({
                          kind: "scroll",
                          direction: id,
                          ...(s.amount !== undefined ? { amount: s.amount } : {}),
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Amount</span>
                <input
                  class={cn(valueCls, mono)}
                  type="number"
                  min={0}
                  placeholder="optional"
                  value={s.amount ?? ""}
                  onInput={(e) => {
                    const n = parseInt(e.currentTarget.value, 10);
                    onEdit({
                      kind: "scroll",
                      direction: s.direction,
                      ...(Number.isFinite(n) ? { amount: n } : {}),
                    });
                  }}
                />
              </div>
            </>
          );
        })()}
      </Show>

      <Show when={kind() === "swipe"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "swipe") return null;
          const coordinate = (
            label: string,
            point: { x: number; y: number },
            onPoint: (point: { x: number; y: number }) => void,
          ) => (
            <label class={propRow}>
              <span class={fieldLabel}>{label}</span>
              <span class="flex min-w-0 flex-1 items-center justify-end gap-1.5">
                <input
                  class={cn(fieldInput, mono, "!w-[72px] flex-none px-2 text-right")}
                  type="number"
                  aria-label={`${label} X`}
                  value={point.x}
                  onInput={(event) =>
                    onPoint({ x: Number(event.currentTarget.value) || 0, y: point.y })
                  }
                />
                <span class="text-12-regular text-text-weak">×</span>
                <input
                  class={cn(fieldInput, mono, "!w-[72px] flex-none px-2 text-right")}
                  type="number"
                  aria-label={`${label} Y`}
                  value={point.y}
                  onInput={(event) =>
                    onPoint({ x: point.x, y: Number(event.currentTarget.value) || 0 })
                  }
                />
              </span>
            </label>
          );
          return (
            <div class="grid gap-2">
              {coordinate("From", s.from, (from) => onEdit({ ...s, from }))}
              {coordinate("To", s.to, (to) => onEdit({ ...s, to }))}
              <div class={propRow}>
                <span class={fieldLabel}>Duration</span>
                <span class="inline-flex items-center gap-1.5">
                  <input
                    class={cn(fieldInput, mono, "!w-[72px] flex-none px-2 text-right")}
                    type="number"
                    min="50"
                    max="10000"
                    step="50"
                    value={s.durationMs ?? 300}
                    onInput={(event) =>
                      onEdit({ ...s, durationMs: Number(event.currentTarget.value) || 300 })
                    }
                  />
                  <span class="text-12-regular text-text-weak">ms</span>
                </span>
              </div>
            </div>
          );
        })()}
      </Show>

      <Show when={kind() === "screenshot"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "screenshot") return null;
          return (
            <div class={propRow}>
              <span class={fieldLabel}>Caption</span>
              <input
                class={valueCls}
                type="text"
                placeholder="optional"
                value={s.caption ?? ""}
                onInput={(e) =>
                  onEdit({
                    kind: "screenshot",
                    ...(e.currentTarget.value ? { caption: e.currentTarget.value } : {}),
                  })
                }
                spellcheck={false}
              />
            </div>
          );
        })()}
      </Show>
    </>
  );
}
