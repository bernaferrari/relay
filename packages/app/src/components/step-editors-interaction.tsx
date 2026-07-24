import { Show, createEffect, createSignal, type JSX } from "solid-js";
import { type RecipeStep, type StepPoint } from "../context/server";
import { cn } from "../lib/cn";
import { anchoredPoint, coordinateAnchor } from "../lib/target-inspector";
import {
  fieldInput,
  fieldLabel,
  mono,
  propertySeg,
  propertySegBtn,
  propertySegBtnOn,
  propRow,
} from "../lib/ui";
import type { StepEditorFamilyProps } from "./step-editor-types";
import { CoordinatePinPicker } from "./coordinate-constraint-picker";

const valueCls = cn(fieldInput, "min-w-0 flex-1");
const valueTimeoutCls = cn(fieldInput, "w-[52px] min-w-0 flex-none text-center tabular-nums");

function InspectorNumberField(props: {
  label: string;
  value: number;
  onValue: (value: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
  hidePrefix?: boolean;
  class?: string;
  dataTip?: string;
  /** Keep a numeric draft stable while users replace an existing value. */
  commit?: "input" | "blur";
}): JSX.Element {
  const [draft, setDraft] = createSignal(String(props.value));
  const [scrubbing, setScrubbing] = createSignal(false);
  let input: HTMLInputElement | undefined;
  let scrub:
    | {
        pointerId: number;
        startX: number;
        startValue: number;
        previousCursor: string;
        previousUserSelect: string;
      }
    | undefined;

  const constrain = (value: number) =>
    Math.min(props.max ?? Number.POSITIVE_INFINITY, Math.max(props.min ?? -Infinity, value));

  createEffect(() => {
    if (document.activeElement !== input) setDraft(String(props.value));
  });

  function setValue(value: number): void {
    const next = Math.round(constrain(value));
    setDraft(String(next));
    if (next !== props.value) props.onValue(next);
  }

  function commitDraft(): void {
    const value = Number(draft());
    if (Number.isFinite(value)) setValue(value);
    else setDraft(String(props.value));
  }

  function startScrub(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    scrub = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: props.value,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };
    setScrubbing(true);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", moveScrub);
    window.addEventListener("pointerup", stopScrub);
    window.addEventListener("pointercancel", stopScrub);
    window.addEventListener("blur", stopScrub);
  }

  function moveScrub(event: PointerEvent): void {
    const active = scrub;
    if (!active || active.pointerId !== event.pointerId) return;
    setValue(active.startValue + (event.clientX - active.startX) * (event.shiftKey ? 10 : 1));
  }

  function stopScrub(event?: Event): void {
    const active = scrub;
    if (!active || (event instanceof PointerEvent && active.pointerId !== event.pointerId)) return;
    window.removeEventListener("pointermove", moveScrub);
    window.removeEventListener("pointerup", stopScrub);
    window.removeEventListener("pointercancel", stopScrub);
    window.removeEventListener("blur", stopScrub);
    document.body.style.cursor = active.previousCursor;
    document.body.style.userSelect = active.previousUserSelect;
    scrub = undefined;
    setScrubbing(false);
  }

  return (
    <div
      class={cn(
        "flex h-8 min-w-0 items-center rounded-md bg-[var(--v2-background-bg-layer-01)]",
        "shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)] focus-within:shadow-[inset_0_0_0_1px_var(--text-base),0_0_0_2px_color-mix(in_srgb,var(--text-base)_10%,transparent)]",
        scrubbing() &&
          "shadow-[inset_0_0_0_1px_var(--v2-background-bg-accent),0_0_0_2px_color-mix(in_srgb,var(--v2-background-bg-accent)_12%,transparent)]",
        props.class,
      )}
      data-tip={props.dataTip}
    >
      <Show when={!props.hidePrefix}>
        <span
          class={cn(
            "grid h-full w-7 shrink-0 touch-none cursor-ew-resize place-items-center font-mono text-[10px] text-[var(--text-weak)] select-none",
            "hover:text-[var(--text-interactive-base)]",
            scrubbing() && "text-[var(--text-interactive-base)]",
          )}
          data-scrub-label={props.label.toLowerCase()}
          data-tip={`Drag to adjust ${props.label}`}
          aria-hidden="true"
          onPointerDown={startScrub}
        >
          {props.label}
        </span>
      </Show>
      <input
        ref={(element) => (input = element)}
        type="number"
        inputmode="numeric"
        min={props.min}
        max={props.max}
        aria-label={props.label}
        class={cn(
          "min-w-0 flex-1 bg-transparent p-0 font-mono text-[11px] tabular-nums text-[var(--text-strong)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          props.hidePrefix && "pl-2.5",
        )}
        value={draft()}
        onInput={(event) => {
          setDraft(event.currentTarget.value);
          if (props.commit !== "blur") {
            const value = Number(event.currentTarget.value);
            if (Number.isFinite(value)) setValue(value);
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || props.commit !== "blur") return;
          event.preventDefault();
          commitDraft();
        }}
        onBlur={() => (props.commit === "blur" ? commitDraft() : setDraft(String(props.value)))}
      />
      <Show when={props.suffix}>
        {(suffix) => (
          <span class="shrink-0 pr-2 text-[10.5px] text-[var(--text-weak)]">{suffix()}</span>
        )}
      </Show>
    </div>
  );
}

function SwipeCoordinateRow(props: {
  label: string;
  point: StepPoint;
  onPoint: (point: StepPoint) => void;
}): JSX.Element {
  return (
    <div class="grid grid-cols-[132px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2.5">
      <span class="text-[10.5px] font-medium text-[var(--text-strong)]">{props.label}</span>
      <InspectorNumberField
        label="X"
        value={props.point.x}
        min={0}
        onValue={(x) => props.onPoint({ ...props.point, x })}
      />
      <InspectorNumberField
        label="Y"
        value={props.point.y}
        min={0}
        onValue={(y) => props.onPoint({ ...props.point, y })}
      />
    </div>
  );
}

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
              <span class="inline-flex h-8 items-center gap-1.5">
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
                <span class="text-[11px] text-text-weak">ms</span>
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
                <span class="inline-flex h-8 min-w-0 flex-1 items-center gap-1.5">
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
                  <span class="text-[11px] text-text-weak">minutes</span>
                </span>
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Verify after</span>
                <select
                  class="h-8 w-[7.5rem] shrink-0 rounded-md border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2 text-[11px] font-normal text-text-strong outline-none focus:border-border-interactive-base"
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
              <div class={propertySeg} role="group" aria-label="Key">
                {(
                  [
                    ["back", "Back"],
                    ["home", "Home"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    type="button"
                    class={s.key === id ? propertySegBtnOn : propertySegBtn}
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
                <div class={propertySeg} role="group" aria-label="Direction">
                  {(
                    [
                      ["down", "Down"],
                      ["up", "Up"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      type="button"
                      class={s.direction === id ? propertySegBtnOn : propertySegBtn}
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
                <span class={fieldLabel}>Distance</span>
                <div class={propertySeg} role="group" aria-label="Scroll distance">
                  {(
                    [
                      [0.5, "Half screen"],
                      [1, "Full screen"],
                    ] as const
                  ).map(([amount, label]) => (
                    <button
                      type="button"
                      class={(s.amount ?? 0.5) === amount ? propertySegBtnOn : propertySegBtn}
                      onClick={() => onEdit({ ...s, amount })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          );
        })()}
      </Show>

      <Show when={kind() === "swipe"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "swipe") return null;
          const bounds = () =>
            s.evidence?.deviceBounds ?? s.from.referenceBounds ?? s.to.referenceBounds;
          return (
            <div class="grid gap-2">
              <SwipeCoordinateRow
                label="Start"
                point={s.from}
                onPoint={(from) => onEdit({ ...s, from })}
              />
              <SwipeCoordinateRow label="End" point={s.to} onPoint={(to) => onEdit({ ...s, to })} />
              <div class="grid grid-cols-[132px_minmax(0,1fr)] items-center gap-2.5">
                <span class="text-[10.5px] font-medium text-[var(--text-strong)]">Pin to</span>
                <CoordinatePinPicker
                  horizontal={coordinateAnchor(s.from).horizontal}
                  vertical={coordinateAnchor(s.from).vertical}
                  onConstraint={({ horizontal, vertical }) =>
                    onEdit({
                      ...s,
                      from: anchoredPoint(s.from, horizontal, vertical, bounds()),
                      to: anchoredPoint(s.to, horizontal, vertical, bounds()),
                    })
                  }
                />
              </div>
              <div class="grid grid-cols-[132px_minmax(0,1fr)] items-center gap-2.5">
                <span class="text-[10.5px] font-medium text-[var(--text-strong)]">Duration</span>
                <InspectorNumberField
                  label="Time"
                  value={s.durationMs ?? 300}
                  min={50}
                  max={5_000}
                  suffix="ms"
                  hidePrefix
                  class="w-full"
                  commit="blur"
                  dataTip="Set a precise duration from 50 to 5,000 ms"
                  onValue={(durationMs) => onEdit({ ...s, durationMs })}
                />
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
