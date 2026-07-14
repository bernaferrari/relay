import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type JSX,
} from "solid-js";
import {
  useServer,
  type RecordedSelectorCandidate,
  type RecipeStep,
  type StepTarget,
} from "../context/server";
import { useWorkbench, type RowAnno } from "../context/workbench";
import { stepIssue } from "../lib/step-sentence";
import { fmtMs, titleize } from "../lib/job";
import { defaultStrategy, detectedChain, type Strategy } from "../lib/step-target";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { RecordingEvidencePanel } from "./recording-evidence-panel";
import { IconButton } from "@relay/ui/icon-button";
import { kindIcon, kindLabel, stepDetail } from "./step-list-metadata";
import { AddMenu, ManualTarget } from "./step-list-controls";
import { fieldInput, fieldLabel, mono, popover, propRow, seg, segBtn, segBtnOn } from "../lib/ui";

const valueCls = cn(fieldInput, "min-w-0 flex-1");
const valueTimeoutCls = cn(fieldInput, "w-[52px] min-w-0 flex-none text-center tabular-nums");
const moreItemCls = cn(
  "block w-full rounded-md px-2.5 py-[7px] text-left text-12-medium text-text-strong",
  "transition-colors duration-100 ease-out",
  "hover:enabled:bg-surface-raised-base-hover disabled:cursor-default disabled:opacity-40",
);
const editorPanel = cn(
  "flex w-full min-w-0 flex-col gap-2.5 overflow-hidden border-t border-border-weak-base",
  "bg-background-base px-3.5 py-3 pl-3.5",
);

function isTargetKind(
  step: RecipeStep,
): step is Extract<
  RecipeStep,
  { kind: "tap" | "long-press" | "wait-for" | "wait-response" | "expect" | "extract" }
> {
  return (
    step.kind === "tap" ||
    step.kind === "long-press" ||
    step.kind === "wait-for" ||
    step.kind === "wait-response" ||
    step.kind === "expect" ||
    step.kind === "extract"
  );
}

export function InsertGap(props: {
  at: number;
  open: boolean;
  onToggle: () => void;
  onPick: (step: RecipeStep) => void;
  onClose: () => void;
}): JSX.Element {
  let gapBtnEl: HTMLButtonElement | undefined;
  const [anchor, setAnchor] = createSignal({ left: 0, top: 0, bottom: 0, width: 0 });

  function openMenu() {
    // Measure the gap center for a stable anchor (not a zero-size floating btn).
    const host = gapBtnEl?.parentElement?.parentElement ?? gapBtnEl;
    const r = (host ?? gapBtnEl)?.getBoundingClientRect();
    if (r) {
      setAnchor({
        left: r.left + r.width / 2 - 10,
        top: r.top + r.height / 2 - 10,
        bottom: r.top + r.height / 2 + 10,
        width: 20,
      });
    }
    props.onToggle();
  }

  return (
    <div
      class={cn(
        // h-0 keeps layout stable; overflow-visible so the + paints outside the line
        "group/gap relative z-[1] h-0 overflow-visible",
        props.open && "z-[14]",
      )}
      aria-hidden={props.open ? undefined : true}
    >
      {/*
        Paint box is taller than the flow gap (h-0) so the size-6 + ring isn't
        clipped by ancestor overflow-y-auto at the top/bottom of the list.
        Centered on the seam; list uses py-4 to reserve that space.
      */}
      <div class="pointer-events-none absolute inset-x-0 top-1/2 z-[1] h-8 -translate-y-1/2 overflow-visible">
        {/* Rule: thicker on hover/open */}
        <div
          class={cn(
            "pointer-events-none absolute inset-x-5 top-1/2 -translate-y-1/2 rounded-full",
            "h-px bg-transparent transition-[height,background-color] duration-100 ease-out",
            "group-hover/gap:h-[2px] group-hover/gap:bg-border-interactive-base",
            props.open && "h-[2px] bg-border-interactive-base",
          )}
        />
        <button
          type="button"
          ref={(el) => {
            gapBtnEl = el;
          }}
          class={cn(
            "pointer-events-auto absolute top-1/2 left-1/2 z-[2] flex size-6 -translate-x-1/2 -translate-y-1/2",
            "items-center justify-center rounded-full",
            "bg-surface-brand-base text-text-on-brand-base shadow-sm",
            // Solid paper ring — never alpha raised-base
            "ring-2 ring-surface-raised-stronger-non-alpha",
            "opacity-0 scale-90 transition-[opacity,transform] duration-100 ease-out",
            "group-hover/gap:opacity-100 group-hover/gap:scale-100",
            "focus-visible:opacity-100 focus-visible:scale-100",
            props.open && "opacity-100 scale-100",
          )}
          aria-label="Insert step"
          aria-haspopup="menu"
          aria-expanded={props.open}
          onClick={(e) => {
            e.stopPropagation();
            openMenu();
          }}
        >
          <Icon name="plus" size={13} strokeWidth={2.75} />
        </button>
        {/* Wider invisible hit strip for easier hover — still zero flow height */}
        <button
          type="button"
          class="pointer-events-auto absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 cursor-pointer border-0 bg-transparent"
          tabindex={-1}
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation();
            openMenu();
          }}
        />
      </div>
      <Show when={props.open}>
        <AddMenu
          anchor={anchor()}
          placement="below"
          onPick={props.onPick}
          onClose={props.onClose}
        />
      </Show>
    </div>
  );
}

/**
 * The row annotation badge — the ONE place run state renders on a step row.
 * idle dot · pulsing running dot · green check (pops in) · red cross, with
 * duration in tabular figures. Shared by the editor rows and the builtin
 * planned rows so every list annotates identically.
 */
export function StepAnno(props: { anno: Accessor<RowAnno> }): JSX.Element {
  const dur = () => fmtMs(props.anno().durationMs);
  // Idle is pure noise — only render when a run left a mark.
  return (
    <Show when={props.anno().status !== "idle"}>
      <span
        class="inline-flex shrink-0 items-center justify-end gap-1 tabular-nums"
        aria-hidden="true"
      >
        <Show when={props.anno().status === "running"}>
          <span class="size-1.5 animate-pulse rounded-full bg-icon-info-base shadow-[0_0_0_2px_color-mix(in_srgb,var(--icon-info-base)_22%,transparent)]" />
        </Show>
        <Show when={props.anno().status === "pass"}>
          <span class="ui-check grid size-4 place-items-center text-icon-success-base">
            <Icon name="check" size={12} strokeWidth={2.5} />
          </span>
          <Show when={dur()}>
            <span class={cn(mono, "text-12-regular leading-none text-text-weak")}>{dur()}</span>
          </Show>
        </Show>
        <Show when={props.anno().status === "fail"}>
          <span class="ui-check grid size-4 place-items-center text-icon-critical-base">
            <Icon name="x" size={12} strokeWidth={2.5} />
          </span>
          <Show when={dur()}>
            <span class={cn(mono, "text-12-regular leading-none text-text-weak")}>{dur()}</span>
          </Show>
        </Show>
      </span>
    </Show>
  );
}

export function StepRow(props: {
  step: Accessor<RecipeStep>;
  index: number;
  total: Accessor<number>;
  expanded: Accessor<boolean>;
  flash: Accessor<boolean>;
  autofocus: Accessor<boolean>;
  onAutofocused: () => void;
  /** Row body: select / second-click toggles editor. */
  onRowActivate: () => void;
  /** Chevron: always open/close editor for this step. */
  onEditToggle: () => void;
  onChange: (next: RecipeStep) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}): JSX.Element {
  const server = useServer();
  const wb = useWorkbench();
  const focused = () => wb.focusedIndex() === props.index;
  const initialStep = props.step();
  const [strategy, setStrategy] = createSignal<Strategy>(
    isTargetKind(initialStep) ? defaultStrategy(initialStep.target) : "label",
  );
  createEffect(() => {
    const step = props.step();
    if (isTargetKind(step)) setStrategy(defaultStrategy(step.target));
  });
  const [moreOpen, setMoreOpen] = createSignal(false);
  onMount(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.("[data-step-more]")) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && moreOpen()) {
        e.stopPropagation();
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    });
  });

  const kind = () => props.step().kind;
  const issue = () => stepIssue(props.step());
  const anno = () => wb.rowAnno(props.index);
  const evidence = () => {
    const step = props.step();
    return "evidence" in step ? step.evidence : undefined;
  };

  const target = (): StepTarget => {
    const s = props.step();
    return isTargetKind(s) ? s.target : {};
  };
  const setTarget = (patch: Partial<StepTarget>) => {
    const s = props.step() as Extract<
      RecipeStep,
      { kind: "tap" | "long-press" | "wait-for" | "wait-response" | "expect" | "extract" }
    >;
    props.onChange({ ...s, target: { ...s.target, ...patch } } as RecipeStep);
  };
  /** One-click retarget for a captured tap: prune to the chosen strategy as
   *  primary, keeping `point` as the emergency fallback. */
  const retargetTap = (id: Strategy) => {
    const s = props.step();
    if (s.kind !== "tap") return;
    const t = s.target;
    const pruned: typeof t = {};
    if (id === "ref" && t.ref) pruned.ref = t.ref;
    else if (id === "label" && t.label) pruned.label = t.label;
    else if (id === "text" && t.text) pruned.text = t.text;
    if (t.point) pruned.point = t.point;
    props.onChange({ ...s, target: pruned });
    setStrategy(id);
  };

  const applyRecordedCandidate = (candidate: RecordedSelectorCandidate) => {
    const step = props.step();
    if (step.kind !== "tap") return;
    props.onChange({ ...step, target: candidate.target });
    setStrategy(candidate.strategy);
  };

  function onEdit(next: RecipeStep): void {
    props.onChange(next);
  }

  const canRunStep = () =>
    kind() !== "pause" &&
    !issue() &&
    !wb.running() &&
    server.health() === "online" &&
    !server.isEmptyDevices();
  const runDisabledReason = () => {
    if (kind() === "pause") return "Pause steps need a human — they run inside a full run";
    if (issue()) return issue()!;
    if (wb.running()) return "Already stepping — stop first";
    if (server.health() !== "online") return "Server is offline";
    if (server.isEmptyDevices()) return "Connect a device to run steps";
    return "";
  };
  function armDelete(): void {
    props.onRemove();
  }

  // Selection (phone focus) is independent of editor expand — list stays navigable.
  const selected = () => focused();
  return (
    <div
      class={cn(
        // Flat, spacious rows — hierarchy from type and tint, not card borders.
        "group/session relative w-full min-w-0 rounded-xl transition-colors duration-100",
        "hover:bg-white/[0.03] [&:has(:focus-visible)]:bg-white/[0.03]",
        selected() &&
          "bg-[color-mix(in_srgb,var(--relay-accent)_9%,transparent)] hover:bg-[color-mix(in_srgb,var(--relay-accent)_11%,transparent)]",
        !selected() &&
          props.expanded() &&
          "bg-[var(--relay-panel)] ring-1 ring-[var(--relay-line)]",
        selected() &&
          props.expanded() &&
          "ring-1 ring-[color-mix(in_srgb,var(--relay-accent)_35%,transparent)]",
        props.flash() && "bg-[color-mix(in_srgb,var(--relay-accent)_9%,transparent)]",
      )}
      data-selected={selected() ? "true" : undefined}
      data-expanded={props.expanded() ? "true" : undefined}
    >
      <div class="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-1 pr-2">
        <button
          type="button"
          class="grid min-w-0 cursor-pointer grid-cols-[34px_minmax(0,1fr)] items-start gap-3.5 rounded-xl px-3.5 py-3.5 text-left outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus"
          aria-current={selected() ? "step" : undefined}
          aria-expanded={props.expanded()}
          onClick={props.onRowActivate}
        >
          <span
            class={cn(
              "grid size-[34px] place-items-center rounded-[10px] font-mono text-[14px] font-medium tabular-nums transition-colors",
              selected()
                ? "bg-[var(--relay-accent)] text-white shadow-[0_5px_16px_color-mix(in_srgb,var(--relay-accent)_40%,transparent)]"
                : "text-[var(--relay-text-secondary)] ring-1 ring-inset ring-[var(--relay-line-strong)]",
            )}
          >
            {props.index + 1}
          </span>

          <div class="min-w-0 overflow-hidden">
            <div class="flex w-full min-w-0 items-center gap-2 overflow-hidden text-[12.5px]/none font-medium text-[var(--relay-text-tertiary)]">
              <Icon
                name={kindIcon(kind())}
                size={13}
                strokeWidth={1.9}
                class={cn("shrink-0", selected() && "text-[var(--relay-accent-2)]")}
                aria-hidden={true}
              />
              <span class={cn(selected() && "text-[var(--relay-text-secondary)]")}>
                {kindLabel(kind())}
              </span>
              <span class="ml-auto shrink-0 pl-2">
                <StepAnno anno={anno} />
              </span>
            </div>
            <span class="mt-2 block w-full min-w-0 truncate text-[15px]/[1.4] font-medium tracking-[-0.005em] text-[var(--relay-text)]">
              {stepDetail(props.step(), server.recipes())}
            </span>
            <Show when={issue() && !props.expanded()}>
              <span class="mt-1.5 flex items-center gap-1.5 truncate text-[11px]/[1.3] text-text-critical-base">
                <Icon name="alert" size={11} /> Incomplete · {issue()}
              </span>
            </Show>
          </div>
        </button>

        <span
          data-step-actions
          class={cn(
            "flex w-[3.5rem] shrink-0 items-center justify-end gap-0.5 overflow-hidden",
            "transition-opacity duration-100 ease-out",
            // One quiet overflow plus one trailing disclosure. Execution lives in the menu.
            selected() || props.expanded()
              ? "opacity-100"
              : "pointer-events-none opacity-0 group-hover/session:pointer-events-auto group-hover/session:opacity-100 group-focus-within/session:pointer-events-auto group-focus-within/session:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
          )}
        >
          <div class="relative" data-step-more>
            <IconButton
              variant="ghost"
              size="normal"
              class="rounded-md"
              data-tip="More"
              aria-label="Step options"
              aria-haspopup="menu"
              aria-expanded={moreOpen()}
              active={moreOpen()}
              onClick={() => setMoreOpen((o) => !o)}
            >
              <Icon name="more" size={13} />
            </IconButton>
            <Show when={moreOpen()}>
              <div
                data-step-more-menu
                class={cn(
                  popover,
                  "absolute top-[calc(100%+4px)] right-0 z-[16] min-w-[148px] origin-top-right p-1",
                )}
                role="menu"
              >
                <button
                  type="button"
                  class={moreItemCls}
                  role="menuitem"
                  disabled={!canRunStep()}
                  onClick={() => {
                    setMoreOpen(false);
                    void wb.runFrom(props.index);
                  }}
                >
                  {runDisabledReason() ||
                    (wb.autoContinue() ? "Run from here (continues)" : "Run from here")}
                </button>
                <button
                  type="button"
                  class={moreItemCls}
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    props.onDuplicate();
                  }}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  class={moreItemCls}
                  role="menuitem"
                  disabled={props.index === 0}
                  onClick={() => {
                    setMoreOpen(false);
                    props.onMove(-1);
                  }}
                >
                  Move up
                </button>
                <button
                  type="button"
                  class={moreItemCls}
                  role="menuitem"
                  disabled={props.index === props.total() - 1}
                  onClick={() => {
                    setMoreOpen(false);
                    props.onMove(1);
                  }}
                >
                  Move down
                </button>
                <button
                  type="button"
                  class={cn(moreItemCls, "text-icon-critical-base")}
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    armDelete();
                  }}
                >
                  Delete step
                </button>
              </div>
            </Show>
          </div>
          <IconButton
            variant="ghost"
            size="normal"
            class="rounded-md"
            active={props.expanded()}
            data-tip={props.expanded() ? "Close (Esc)" : "Edit step"}
            aria-label={props.expanded() ? "Close step editor" : "Edit step"}
            aria-expanded={props.expanded()}
            onClick={(e) => {
              e.stopPropagation();
              props.onEditToggle();
            }}
          >
            <Icon name={props.expanded() ? "chevron-down" : "chevron-right"} size={14} />
          </IconButton>
        </span>
      </div>

      <Show when={anno().status === "fail" && anno().error}>
        <p class="mb-2 flex items-start gap-1.5 px-3 pr-3 pl-11 text-12-regular leading-snug text-icon-critical-base">
          <Icon name="alert" size={11} class="mt-0.5 shrink-0" />
          <span class="min-w-0 break-words">{anno().error}</span>
        </p>
      </Show>

      <Show when={props.expanded()}>
        <div class={editorPanel}>
          <Show when={evidence()}>
            {(captured) => (
              <RecordingEvidencePanel
                evidence={captured()}
                target={kind() === "tap" ? target() : undefined}
                onApply={kind() === "tap" ? applyRecordedCandidate : undefined}
              />
            )}
          </Show>
          {/* tap — detected chain as one-click retargeting when captured */}
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
                  <span class="inline-flex h-7 items-center gap-1.5">
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
                    <span class="text-12-regular text-text-weak">sec</span>
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
                    <span class="inline-flex h-7 items-center gap-1.5">
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
                      <span class="text-12-regular text-text-weak">sec</span>
                    </span>
                  </div>
                  <div class={propRow}>
                    <span class={fieldLabel}>Timeout</span>
                    <span class="inline-flex h-7 items-center gap-1.5">
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
                      <span class="text-12-regular text-text-weak">sec</span>
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
                    Relay waits for the response to change and become stable. Optional generating
                    and ready indicators add an independent completion signal.
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
                    <div class={seg} role="group" aria-label="Condition">
                      {(
                        [
                          ["visible", "Visible"],
                          ["gone", "Gone"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          type="button"
                          class={s.condition === id ? segBtnOn : segBtn}
                          onClick={() => onEdit({ ...s, condition: id })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div class={propRow}>
                    <span class={fieldLabel}>Timeout</span>
                    <span class="inline-flex h-7 items-center gap-1.5">
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
                      <span class="text-12-regular text-text-weak">sec</span>
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
                    <span class="grid size-[18px] place-items-center rounded text-[var(--relay-accent-2)]">
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
                        onInput={(event) =>
                          onEdit({ ...s, secondProvider: event.currentTarget.value })
                        }
                      />
                    </div>
                  </Show>
                </>
              );
            })()}
          </Show>

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
                      onInput={(e) =>
                        onEdit({ ...s, ms: parseInt(e.currentTarget.value, 10) || 0 })
                      }
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
                      onInput={(e) =>
                        onEdit({ ...s, resumeLabel: e.currentTarget.value || undefined })
                      }
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
                              Number.isFinite(minutes) && minutes > 0
                                ? minutes * 60_000
                                : undefined,
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
                    The run pauses on the live device. Act in the app, then press Continue test. Add
                    a post-handoff check to make Relay confirm the expected state before advancing.
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

          <Show when={kind() === "long-press"}>
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
              if (s.kind !== "long-press") return null;
              return (
                <div class={propRow}>
                  <span class={fieldLabel}>Duration</span>
                  <span class="inline-flex items-center gap-1.5">
                    <input
                      class={cn(valueTimeoutCls, mono)}
                      type="number"
                      min={100}
                      max={10000}
                      value={s.durationMs ?? 700}
                      onInput={(e) => onEdit({ ...s, durationMs: Number(e.currentTarget.value) })}
                    />
                    <span class="text-12-regular text-text-weak">ms</span>
                  </span>
                </div>
              );
            })()}
          </Show>

          <Show when={kind() === "module"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "module") return null;
              const choices = server.recipes().filter((r) => r.id !== server.selectedRecipeId());
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
                    <div class="my-0.5 mb-1 grid gap-2 rounded-[9px] border border-[var(--relay-line)] bg-[color-mix(in_srgb,var(--relay-surface-raised)_60%,transparent)] p-2.5">
                      <div class="flex items-center justify-between gap-2 text-[11px] font-semibold text-[var(--relay-text-secondary)]">
                        <span>Flow inputs</span>
                        <small class="text-[10px] font-normal text-[var(--relay-text-tertiary)]">
                          Used in this run
                        </small>
                      </div>
                      <For each={parameters()}>
                        {(parameter) => (
                          <label class="grid gap-1 text-[10px] text-[var(--relay-text-secondary)]">
                            <span class="flex items-center justify-between gap-2">
                              {parameter.label || parameter.name}
                              <Show when={parameter.required}>
                                <b
                                  class="text-[9px] font-semibold tracking-[0.03em] text-[var(--relay-amber)] uppercase"
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
                              onInput={(event) =>
                                setBinding(parameter.name, event.currentTarget.value)
                              }
                            />
                            <Show when={parameter.description}>
                              <small class="text-[10px] font-normal leading-[1.35] text-[var(--relay-text-tertiary)]">
                                {parameter.description}
                              </small>
                            </Show>
                          </label>
                        )}
                      </For>
                    </div>
                  </Show>
                  <p class="mt-1 text-[11px] leading-[1.45] text-[var(--relay-text-tertiary)]">
                    Record any repeatable routine once—sign-in, onboarding, permissions, or a
                    recovery path—then attach it here. It stays editable and receives this run’s
                    frozen variables, such as {"{{login_email}}"}.
                  </p>
                </>
              );
            })()}
          </Show>

          <Show when={kind() === "branch"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "branch") return null;
              const choices = server.recipes().filter((r) => r.id !== server.selectedRecipeId());
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
                      onChange={(event) =>
                        onEdit({ ...s, thenRecipeId: event.currentTarget.value })
                      }
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
              const choices = server.recipes().filter((r) => r.id !== server.selectedRecipeId());
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
                      onInput={(event) =>
                        onEdit({ ...s, count: Number(event.currentTarget.value) })
                      }
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
                  <p class="mt-1 text-[11px] leading-[1.45] text-[var(--relay-text-tertiary)]">
                    Safe commands: set name = value, copy new = existing, delete name, assert name
                    contains value.
                  </p>
                </>
              );
            })()}
          </Show>

          <Show when={kind() === "clipboard"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "clipboard") return null;
              const value = s.action === "write" ? (s.text ?? "") : (s.expect ?? "");
              return (
                <>
                  <div class={propRow}>
                    <span class={fieldLabel}>Action</span>
                    <div class={seg}>
                      {(
                        [
                          ["write", "Write"],
                          ["read", "Read & check"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          type="button"
                          class={s.action === id ? segBtnOn : segBtn}
                          onClick={() =>
                            onEdit(
                              id === "write"
                                ? { kind: "clipboard", action: "write", text: value }
                                : {
                                    kind: "clipboard",
                                    action: "read",
                                    expect: value,
                                    match: "exact",
                                  },
                            )
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div class={propRow}>
                    <span class={fieldLabel}>{s.action === "write" ? "Text" : "Expected"}</span>
                    <input
                      class={cn(valueCls, mono)}
                      value={value}
                      placeholder="clipboard text"
                      onInput={(e) =>
                        onEdit(
                          s.action === "write"
                            ? { ...s, text: e.currentTarget.value }
                            : { ...s, expect: e.currentTarget.value },
                        )
                      }
                    />
                  </div>
                  <Show when={s.action === "read"}>
                    <div class={propRow}>
                      <span class={fieldLabel}>Match</span>
                      <div class={seg}>
                        {(
                          [
                            ["exact", "Exact"],
                            ["contains", "Contains"],
                          ] as const
                        ).map(([id, label]) => (
                          <button
                            type="button"
                            class={
                              (s.match !== "contains" && id === "exact") || s.match === id
                                ? segBtnOn
                                : segBtn
                            }
                            onClick={() => onEdit({ ...s, match: id })}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </Show>
                </>
              );
            })()}
          </Show>

          <Show when={kind() === "app"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "app") return null;
              return (
                <>
                  <div class={propRow}>
                    <span class={fieldLabel}>Action</span>
                    <select
                      class={valueCls}
                      value={s.action}
                      onChange={(e) =>
                        onEdit({
                          kind: "app",
                          action: e.currentTarget.value as typeof s.action,
                          ...(e.currentTarget.value !== "switcher" ? { app: s.app ?? "" } : {}),
                        })
                      }
                    >
                      <option value="open">Open app / deep link</option>
                      <option value="close">Close app</option>
                      <option value="switcher">Open app switcher</option>
                      <option value="inspect">Record installed version</option>
                      <option value="assert-installed">Check app is installed</option>
                      <option value="assert-not-installed">Check app is not installed</option>
                      <option value="install">Install local APK</option>
                      <option value="update">Update from local APK</option>
                      <option value="uninstall">Uninstall app</option>
                    </select>
                  </div>
                  <Show when={s.action !== "switcher"}>
                    <div class={propRow}>
                      <span class={fieldLabel}>
                        {s.action === "open" ? "App or link" : "Package / bundle ID"}
                      </span>
                      <input
                        class={cn(valueCls, mono)}
                        value={s.app ?? s.url ?? ""}
                        placeholder={
                          s.action === "open" ? "package, app name, or URL" : "com.example.app"
                        }
                        onInput={(e) => {
                          const v = e.currentTarget.value;
                          onEdit(
                            v.includes("://")
                              ? { ...s, app: undefined, url: v }
                              : { ...s, app: v, url: undefined },
                          );
                        }}
                      />
                    </div>
                  </Show>
                  <Show when={s.action === "install" || s.action === "update"}>
                    <div class={propRow}>
                      <span class={fieldLabel}>Local APK</span>
                      <input
                        class={cn(valueCls, mono)}
                        value={s.artifact ?? ""}
                        placeholder="/path/to/build.apk"
                        onInput={(e) => onEdit({ ...s, artifact: e.currentTarget.value })}
                      />
                    </div>
                    <p class="mt-1 text-[11px] leading-[1.45] text-[var(--relay-text-tertiary)]">
                      Android only. Relay runs the selected local APK directly and freezes the
                      observed installed version into the report.
                    </p>
                  </Show>
                  <Show
                    when={
                      s.action === "inspect" ||
                      s.action === "assert-installed" ||
                      s.action === "assert-not-installed"
                    }
                  >
                    <Show when={s.action !== "assert-not-installed"}>
                      <div class={propRow}>
                        <span class={fieldLabel}>Expected version</span>
                        <input
                          class={cn(valueCls, mono)}
                          value={s.version ?? ""}
                          placeholder="Optional, e.g. 1.24.0"
                          onInput={(e) =>
                            onEdit({ ...s, version: e.currentTarget.value || undefined })
                          }
                        />
                      </div>
                    </Show>
                    <Show when={s.action === "inspect"}>
                      <div class={propRow}>
                        <span class={fieldLabel}>Save as</span>
                        <input
                          class={cn(valueCls, mono)}
                          value={s.as ?? "app_version"}
                          placeholder="app_version"
                          onInput={(e) => onEdit({ ...s, as: e.currentTarget.value || undefined })}
                        />
                      </div>
                    </Show>
                    <Show when={s.version}>
                      <div class={propRow}>
                        <span class={fieldLabel}>Version match</span>
                        <select
                          class={valueCls}
                          value={s.versionMatch ?? "exact"}
                          onChange={(e) =>
                            onEdit({
                              ...s,
                              versionMatch: e.currentTarget.value as "exact" | "contains",
                            })
                          }
                        >
                          <option value="exact">Exact</option>
                          <option value="contains">Contains</option>
                        </select>
                      </div>
                    </Show>
                    <p class="mt-1 text-[11px] leading-[1.45] text-[var(--relay-text-tertiary)]">
                      Relay records the installed version with the result. Credentials and app files
                      stay on your machine.
                    </p>
                  </Show>
                </>
              );
            })()}
          </Show>

          <Show when={kind() === "device"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "device") return null;
              const targetPlatform =
                server.devices().find((device) => device.serial === server.selectedDevice())
                  ?.platform ?? "android";
              return (
                <>
                  <div class={propRow}>
                    <span class={fieldLabel}>Action</span>
                    <select
                      class={valueCls}
                      value={s.action}
                      onChange={(e) =>
                        onEdit({ kind: "device", action: e.currentTarget.value as typeof s.action })
                      }
                    >
                      <option value="lock">Lock screen</option>
                      <option value="unlock">Wake & unlock</option>
                      <option value="keyboard-dismiss">Dismiss keyboard</option>
                      <option value="keyboard-enter">Keyboard Enter</option>
                    </select>
                  </div>
                  <Show
                    when={
                      targetPlatform === "ios" && (s.action === "lock" || s.action === "unlock")
                    }
                  >
                    <p class="mt-1 text-[11px] leading-[1.45] text-[var(--relay-text-tertiary)]">
                      Lock-screen control is unavailable on this iOS runner. Relay will report a
                      capability failure instead of guessing.
                    </p>
                  </Show>
                </>
              );
            })()}
          </Show>

          <Show when={kind() === "rotate"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "rotate") return null;
              return (
                <div class={propRow}>
                  <span class={fieldLabel}>Orientation</span>
                  <select
                    class={valueCls}
                    value={s.orientation}
                    onChange={(e) =>
                      onEdit({ ...s, orientation: e.currentTarget.value as typeof s.orientation })
                    }
                  >
                    <option value="portrait">Portrait</option>
                    <option value="portrait-upside-down">Portrait upside down</option>
                    <option value="landscape-left">Landscape left</option>
                    <option value="landscape-right">Landscape right</option>
                  </select>
                </div>
              );
            })()}
          </Show>

          <Show when={kind() === "settings"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "settings") return null;
              const appearance = s.setting === "appearance";
              return (
                <>
                  <div class={propRow}>
                    <span class={fieldLabel}>Setting</span>
                    <select
                      class={valueCls}
                      value={s.setting}
                      onChange={(e) => {
                        const setting = e.currentTarget.value as typeof s.setting;
                        onEdit({
                          kind: "settings",
                          setting,
                          state: setting === "appearance" ? "light" : "on",
                        });
                      }}
                    >
                      <option value="wifi">Wi-Fi</option>
                      <option value="airplane">Airplane mode</option>
                      <option value="location">Location services</option>
                      <option value="animations">Animations</option>
                      <option value="appearance">Appearance</option>
                    </select>
                  </div>
                  <div class={propRow}>
                    <span class={fieldLabel}>State</span>
                    <select
                      class={valueCls}
                      value={s.state}
                      onChange={(e) =>
                        onEdit({ ...s, state: e.currentTarget.value as typeof s.state })
                      }
                    >
                      {appearance ? (
                        <>
                          <option value="light">Light</option>
                          <option value="dark">Dark</option>
                          <option value="toggle">Toggle</option>
                        </>
                      ) : (
                        <>
                          <option value="on">On</option>
                          <option value="off">Off</option>
                        </>
                      )}
                    </select>
                  </div>
                </>
              );
            })()}
          </Show>

          <Show when={kind() === "location"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "location") return null;
              return (
                <>
                  <div class={propRow}>
                    <span class={fieldLabel}>Latitude</span>
                    <input
                      class={cn(valueCls, mono)}
                      type="number"
                      step="any"
                      value={s.latitude}
                      onInput={(e) => onEdit({ ...s, latitude: Number(e.currentTarget.value) })}
                    />
                  </div>
                  <div class={propRow}>
                    <span class={fieldLabel}>Longitude</span>
                    <input
                      class={cn(valueCls, mono)}
                      type="number"
                      step="any"
                      value={s.longitude}
                      onInput={(e) => onEdit({ ...s, longitude: Number(e.currentTarget.value) })}
                    />
                  </div>
                </>
              );
            })()}
          </Show>

          <Show when={kind() === "permission"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "permission") return null;
              const permissions = [
                "camera",
                "microphone",
                "photos",
                "contacts",
                "notifications",
                "calendar",
                "location",
                "location-always",
                "media-library",
                "motion",
                "reminders",
                "siri",
              ] as const;
              return (
                <>
                  <div class={propRow}>
                    <span class={fieldLabel}>Action</span>
                    <select
                      class={valueCls}
                      value={s.action}
                      onChange={(e) =>
                        onEdit({ ...s, action: e.currentTarget.value as typeof s.action })
                      }
                    >
                      <option value="grant">Grant</option>
                      <option value="deny">Deny</option>
                      <option value="reset">Reset</option>
                    </select>
                  </div>
                  <div class={propRow}>
                    <span class={fieldLabel}>Permission</span>
                    <select
                      class={valueCls}
                      value={s.permission}
                      onChange={(e) =>
                        onEdit({ ...s, permission: e.currentTarget.value as typeof s.permission })
                      }
                    >
                      <For each={permissions}>
                        {(p) => <option value={p}>{p.replaceAll("-", " ")}</option>}
                      </For>
                    </select>
                  </div>
                </>
              );
            })()}
          </Show>

          <Show when={kind() === "alert"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "alert") return null;
              return (
                <div class={propRow}>
                  <span class={fieldLabel}>Action</span>
                  <select
                    class={valueCls}
                    value={s.action}
                    onChange={(e) =>
                      onEdit({ ...s, action: e.currentTarget.value as typeof s.action })
                    }
                  >
                    <option value="accept">Accept</option>
                    <option value="dismiss">Dismiss</option>
                    <option value="wait">Wait for alert</option>
                    <option value="get">Inspect alert</option>
                  </select>
                </div>
              );
            })()}
          </Show>

          <Show when={kind() === "network"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "network") return null;
              return (
                <>
                  <div class={propRow}>
                    <span class={fieldLabel}>Evidence</span>
                    <select
                      class={valueCls}
                      value={s.include ?? "summary"}
                      onChange={(e) =>
                        onEdit({
                          ...s,
                          include: e.currentTarget.value as NonNullable<typeof s.include>,
                        })
                      }
                    >
                      <option value="summary">Summary</option>
                      <option value="headers">Headers</option>
                      <option value="body">Bodies</option>
                      <option value="all">Everything</option>
                    </select>
                  </div>
                  <div class={propRow}>
                    <span class={fieldLabel}>Limit</span>
                    <input
                      class={cn(valueCls, mono)}
                      type="number"
                      min={1}
                      max={1000}
                      value={s.limit ?? 100}
                      onInput={(e) => onEdit({ ...s, limit: Number(e.currentTarget.value) })}
                    />
                  </div>
                </>
              );
            })()}
          </Show>

          <Show when={kind() === "logs"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "logs") return null;
              return (
                <>
                  <div class={propRow}>
                    <span class={fieldLabel}>Action</span>
                    <select
                      class={valueCls}
                      value={s.action}
                      onChange={(e) =>
                        onEdit({ ...s, action: e.currentTarget.value as typeof s.action })
                      }
                    >
                      <option value="mark">Add marker</option>
                      <option value="start">Start capture</option>
                      <option value="stop">Stop capture</option>
                      <option value="clear">Clear logs</option>
                    </select>
                  </div>
                  <Show when={s.action === "mark"}>
                    <div class={propRow}>
                      <span class={fieldLabel}>Marker</span>
                      <input
                        class={valueCls}
                        value={s.message ?? ""}
                        onInput={(e) => onEdit({ ...s, message: e.currentTarget.value })}
                      />
                    </div>
                  </Show>
                </>
              );
            })()}
          </Show>

          {/* When annotated, the expanded row also shows that step's log. */}
          <Show when={anno().log}>
            <pre
              class={cn(
                mono,
                "max-h-40 w-full overflow-y-auto rounded-md border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 py-2 text-12-regular leading-relaxed break-words whitespace-pre-wrap text-text-weak",
              )}
            >
              {anno().log}
            </pre>
          </Show>
        </div>
      </Show>
    </div>
  );
}
