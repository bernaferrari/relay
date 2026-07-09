import {
  For,
  Index,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type JSX,
} from "solid-js";
import { useServer, type RecipeStep, type StepTarget } from "../context/server";
import { useRecipeDraft } from "../context/recipe-draft";
import { useWorkbench, type RowAnno } from "../context/workbench";
// useWorkbench used in RecipeStepsEditor for step↔frame focus
import { sentenceForStep, stepIssue } from "../lib/step-sentence";
import { fmtMs, titleize } from "../lib/job";
import {
  STRATEGIES,
  defaultStrategy,
  detectedChain,
  fmtPoint,
  parsePoint,
  type Strategy,
} from "../lib/step-target";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

type AddOption = { label: string; make: () => RecipeStep };
type AddGroup = { label: string; items: AddOption[] };

/** Shared field chrome for expanded step editors. */
const valueCls =
  "h-[30px] min-w-[140px] flex-1 rounded-control border border-border bg-base px-2.5 text-body text-text transition-[border-color] focus:border-border-focus focus:outline-none";
const valueTimeoutCls = cn(valueCls, "w-[72px] min-w-0 flex-none");
const iconBtnCls =
  "grid size-[26px] shrink-0 place-items-center rounded-control text-text-faint transition-[background,color,transform] hover:enabled:bg-hover hover:enabled:text-text active:enabled:scale-[0.94] disabled:cursor-default disabled:opacity-35";
const stepICls =
  "mono w-[18px] shrink-0 text-right text-xs font-medium tabular-nums text-text-faint";
const kindCls = "block text-[10.5px] font-semibold uppercase tracking-[0.04em] text-text-faint";
const menuItemCls =
  "block w-full rounded-lg px-3 py-2 text-left text-body font-medium text-text transition-colors hover:bg-hover active:scale-[0.99]";
const moreItemCls =
  "block w-full rounded-md px-2.5 py-[7px] text-left text-body text-text transition-colors hover:enabled:bg-hover disabled:cursor-default disabled:opacity-40";

/** Short kind chip — Uber-style “Instruction / Manual” density. */
function kindLabel(kind: string): string {
  switch (kind) {
    case "tap":
      return "Tap";
    case "type":
      return "Type";
    case "expect":
      return "Check";
    case "wait-for":
      return "Wait";
    case "sleep":
      return "Sleep";
    case "pause":
      return "Pause";
    case "key":
      return "Key";
    case "scroll":
      return "Scroll";
    case "swipe":
      return "Swipe";
    case "screenshot":
      return "Shot";
    case "flow":
      return "Flow";
    default:
      return kind;
  }
}

/** Add-step menu, grouped Act / Check / More. Swipe is deliberately absent —
 *  authoring meaningful from/to coordinates by hand isn't worth the UI; swipe
 *  steps still show up fine once recorded from the device. */
const ADD_GROUPS: AddGroup[] = [
  {
    label: "Act",
    items: [
      { label: "Tap element", make: () => ({ kind: "tap", target: {} }) },
      { label: "Type text", make: () => ({ kind: "type", text: "" }) },
      { label: "Scroll", make: () => ({ kind: "scroll", direction: "down" }) },
      { label: "Press Back", make: () => ({ kind: "key", key: "back" }) },
      { label: "Press Home", make: () => ({ kind: "key", key: "home" }) },
    ],
  },
  {
    label: "Check",
    items: [
      {
        label: "Check element is visible",
        make: () => ({ kind: "expect", target: {}, condition: "visible" }),
      },
      {
        label: "Check element is gone",
        make: () => ({ kind: "expect", target: {}, condition: "gone" }),
      },
      { label: "Wait for element", make: () => ({ kind: "wait-for", target: {} }) },
      { label: "Wait (sleep)", make: () => ({ kind: "sleep", ms: 500 }) },
    ],
  },
  {
    label: "More",
    items: [
      { label: "Screenshot", make: () => ({ kind: "screenshot" }) },
      { label: "Pause for human", make: () => ({ kind: "pause", message: "" }) },
    ],
  },
];

function isTargetKind(
  step: RecipeStep,
): step is Extract<RecipeStep, { kind: "tap" | "wait-for" | "expect" }> {
  return step.kind === "tap" || step.kind === "wait-for" || step.kind === "expect";
}

/** Manual target editor: segmented strategy selector + one input for the
 *  chosen field's value. Shared by tap / wait-for / expect rows. */
function ManualTarget(props: {
  target: Accessor<StepTarget>;
  strategy: Accessor<Strategy>;
  onStrategy: (s: Strategy) => void;
  onPatch: (patch: Partial<StepTarget>) => void;
  autofocus?: Accessor<boolean>;
  onAutofocused?: () => void;
}): JSX.Element {
  const strat = () => STRATEGIES.find((x) => x.id === props.strategy());
  let inputRef: HTMLInputElement | undefined;
  // createEffect (not onMount): runs after this subtree is in the DOM AND
  // re-runs when the wants-focus flag flips, so it works whether the flag was
  // set before or after the input mounted (the old onMount raced the flag).
  createEffect(() => {
    if (props.autofocus?.()) {
      inputRef?.focus();
      props.onAutofocused?.();
    }
  });
  return (
    <>
      <div class="seg" role="group" aria-label="Target strategy">
        <For each={STRATEGIES}>
          {(st) => (
            <button
              type="button"
              class="seg__btn"
              classList={{ "seg__btn--on": props.strategy() === st.id }}
              onClick={() => props.onStrategy(st.id)}
            >
              {st.label}
            </button>
          )}
        </For>
      </div>
      <Show when={strat()}>
        {(st) => {
          const t = props.target();
          const value = () =>
            st().id === "ref"
              ? (t.ref ?? "")
              : st().id === "label"
                ? (t.label ?? "")
                : st().id === "text"
                  ? (t.text ?? "")
                  : fmtPoint(t.point);
          const onInput = (v: string) => {
            if (st().id === "ref") props.onPatch({ ref: v || undefined });
            else if (st().id === "label") props.onPatch({ label: v || undefined });
            else if (st().id === "text") props.onPatch({ text: v || undefined });
            else props.onPatch({ point: parsePoint(v) });
          };
          return (
            <input
              ref={inputRef}
              class={cn(valueCls, "mono")}
              type="text"
              placeholder={st().placeholder}
              value={value()}
              onInput={(e) => onInput(e.currentTarget.value)}
              spellcheck={false}
            />
          );
        }}
      </Show>
    </>
  );
}

/** Grouped add-step popover — closes on outside click, Escape, or a pick. */
function AddMenu(props: { onPick: (step: RecipeStep) => void; onClose: () => void }): JSX.Element {
  let ref: HTMLDivElement | undefined;
  onMount(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref && !ref.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onClose();
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    // Focus first item so keyboard users land in the menu.
    queueMicrotask(() => ref?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus());
    onCleanup(() => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    });
  });
  return (
    <div
      class="absolute top-[calc(100%+6px)] left-0 z-[12] flex max-h-[min(420px,calc(100vh-100px))] w-[min(280px,100%)] origin-top-left flex-col overflow-y-auto rounded-xl border border-border bg-layer-1 p-1.5 shadow-[var(--v2-elevation-overlay,0_12px_40px_rgba(0,0,0,0.32))]"
      role="menu"
      aria-label="Add step"
      ref={ref}
    >
      <For each={ADD_GROUPS}>
        {(g, gi) => (
          <div class={cn("flex flex-col", gi() > 0 && "mt-1 border-t border-border pt-1")}>
            <div class="px-2.5 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wide text-text-faint uppercase">
              {g.label}
            </div>
            <For each={g.items}>
              {(o) => (
                <button
                  type="button"
                  class={menuItemCls}
                  role="menuitem"
                  onClick={() => props.onPick(o.make())}
                >
                  {o.label}
                </button>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}

/** Slim hover-reveal insertion point between two rows. */
function InsertGap(props: {
  at: number;
  open: boolean;
  onToggle: () => void;
  onPick: (step: RecipeStep) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      class={cn(
        "group relative z-[1] -my-1 flex h-3 items-center justify-center",
        props.open && "z-[14]",
      )}
    >
      <div
        class={cn(
          "pointer-events-none absolute inset-x-7 h-px bg-transparent transition-colors",
          "group-hover:bg-accent/35",
          props.open && "bg-accent/35",
        )}
        aria-hidden="true"
      />
      <button
        type="button"
        class={cn(
          "z-[1] grid size-5 place-items-center rounded-full border border-border bg-layer-1 text-text-faint",
          "scale-[0.85] opacity-0 transition-[opacity,transform,background,color,border-color]",
          "group-hover:scale-100 group-hover:opacity-100",
          "focus-visible:scale-100 focus-visible:opacity-100",
          "hover:border-accent hover:bg-accent hover:text-accent-fg",
          props.open && "scale-100 opacity-100",
        )}
        aria-label="Insert step here"
        data-tip="Insert step here"
        onClick={() => props.onToggle()}
      >
        <Icon name="plus" size={11} />
      </button>
      <Show when={props.open}>
        <AddMenu onPick={props.onPick} onClose={props.onClose} />
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
  // Idle dots are pure noise — only render when a run left a mark.
  return (
    <Show when={props.anno().status !== "idle"}>
      <span
        class="inline-flex min-w-[52px] shrink-0 items-center justify-end gap-1.5 tabular-nums"
        aria-hidden="true"
      >
        <Show when={props.anno().status === "running"}>
          <span class="size-1.5 animate-pulse rounded-full bg-run" />
        </Show>
        <Show when={props.anno().status === "pass"}>
          <span class="inline-grid place-items-center text-pass">
            <Icon name="check" size={13} />
          </span>
          <Show when={dur()}>
            <span class="mono whitespace-nowrap text-meta text-text-faint">{dur()}</span>
          </Show>
        </Show>
        <Show when={props.anno().status === "fail"}>
          <span class="inline-grid place-items-center text-fail">
            <Icon name="x" size={13} />
          </span>
          <Show when={dur()}>
            <span class="mono whitespace-nowrap text-meta text-text-faint">{dur()}</span>
          </Show>
        </Show>
      </span>
    </Show>
  );
}

function StepRow(props: {
  step: Accessor<RecipeStep>;
  index: number;
  total: Accessor<number>;
  expanded: Accessor<boolean>;
  flash: Accessor<boolean>;
  autofocus: Accessor<boolean>;
  onAutofocused: () => void;
  onToggleExpand: () => void;
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

  const target = (): StepTarget => {
    const s = props.step();
    return isTargetKind(s) ? s.target : {};
  };
  const setTarget = (patch: Partial<StepTarget>) => {
    const s = props.step() as Extract<RecipeStep, { kind: "tap" | "wait-for" | "expect" }>;
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
  const runTip = () =>
    runDisabledReason() ||
    (wb.autoContinue() ? "Run from this step (Auto-continue is on)" : "Run this step");

  function armDelete(): void {
    props.onRemove();
  }

  const selected = () => focused() || props.expanded();

  return (
    <div
      class={cn(
        "group relative border-b border-border transition-colors",
        selected() && "bg-accent/10 shadow-[inset_3px_0_0_0_var(--color-accent)]",
        !selected() && anno().status === "running" && "bg-run/[0.08]",
        !selected() && anno().status === "pass" && "bg-pass/[0.06]",
        !selected() && anno().status === "fail" && "bg-fail/[0.09]",
        !selected() && anno().status === "idle" && "hover:bg-layer-2/70",
        // Red only when incomplete AND collapsed — while editing, don't scold.
        Boolean(issue()) && !props.expanded() && "bg-fail/[0.04]",
        props.flash() && "bg-accent/25",
      )}
    >
      <div
        class="flex min-h-12 cursor-pointer items-center gap-2.5 px-2 py-2 pl-1.5"
        onClick={(e) => {
          // The whole row toggles the editor — except clicks meant for the
          // action buttons / menus.
          if ((e.target as HTMLElement).closest("[data-step-actions], [data-step-more-menu]"))
            return;
          props.onToggleExpand();
        }}
      >
        <span class={stepICls}>{props.index + 1}</span>
        <button
          type="button"
          class="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0 border-0 bg-transparent py-0 text-left text-[13.5px] font-medium tracking-[-0.012em] text-text hover:text-text-strong"
          aria-expanded={props.expanded()}
        >
          <span class={kindCls}>{kindLabel(kind())}</span>
          <span class="w-full truncate font-medium text-text">
            {sentenceForStep(props.step(), server.recipes())}
          </span>
        </button>

        <StepAnno anno={anno} />

        <span
          data-step-actions
          class={cn(
            "flex shrink-0 items-center gap-px opacity-55 transition-opacity",
            "group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
            props.expanded() && "opacity-100",
          )}
        >
          <button
            type="button"
            class={cn(iconBtnCls, "hover:enabled:bg-accent/15 hover:enabled:text-accent-soft")}
            data-tip={runTip()}
            aria-label="Run this step"
            disabled={!canRunStep()}
            onClick={() => void wb.runFrom(props.index)}
          >
            <Icon name="play" size={12} />
          </button>
          <button
            type="button"
            class={cn(iconBtnCls, "hover:enabled:bg-fail/15 hover:enabled:text-fail")}
            data-tip="Delete step"
            aria-label="Delete step"
            onClick={() => armDelete()}
          >
            <Icon name="trash" size={12} />
          </button>
          <div class="relative" data-step-more>
            <button
              type="button"
              class={iconBtnCls}
              data-tip="More"
              aria-label="Step options"
              aria-haspopup="menu"
              aria-expanded={moreOpen()}
              onClick={() => setMoreOpen((o) => !o)}
            >
              <Icon name="more" size={12} />
            </button>
            <Show when={moreOpen()}>
              <div
                data-step-more-menu
                class="absolute top-[calc(100%+4px)] right-0 z-[16] min-w-[148px] origin-top-right rounded-[10px] border border-border bg-layer-1 p-1 shadow-[var(--v2-elevation-overlay)]"
                role="menu"
              >
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
              </div>
            </Show>
          </div>
        </span>
      </div>

      {/* Failure auto-surfaces as one compact line — no expand needed. */}
      <Show when={anno().status === "fail" && anno().error}>
        <p class="mb-2 flex items-center gap-1.5 px-3 pr-3 pl-10 text-meta leading-snug text-fail">
          <Icon name="alert" size={11} />
          {anno().error}
        </p>
      </Show>

      <Show when={issue() && !props.expanded()}>
        <p class="mb-2 px-3 pl-10 text-meta text-fail">Click to finish — {issue()}</p>
      </Show>

      <Show when={props.expanded()}>
        <div class="mx-1 flex flex-wrap items-center gap-2 border-t border-border px-3 pt-0.5 pb-3 pl-10">
          {/* tap — detected chain as one-click retargeting when captured */}
          <Show when={kind() === "tap"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "tap") return null;
              const chain = detectedChain(s.target);
              const hasDetected = chain.some((c) => c.id !== "point");
              if (!hasDetected) {
                return (
                  <div class="flex w-full basis-full flex-col gap-2">
                    <ManualTarget
                      target={target}
                      strategy={strategy}
                      onStrategy={setStrategy}
                      onPatch={setTarget}
                      autofocus={props.autofocus}
                      onAutofocused={props.onAutofocused}
                    />
                  </div>
                );
              }
              return (
                <div
                  class="flex w-full basis-full flex-col gap-0.5"
                  role="radiogroup"
                  aria-label="Retarget tap"
                >
                  <For each={chain}>
                    {(c) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={strategy() === c.id}
                        class={cn(
                          "flex items-center gap-2 rounded-control px-2 py-[7px] text-text-muted transition-colors hover:bg-hover",
                          strategy() === c.id && "bg-accent/10 text-text",
                        )}
                        onClick={() => retargetTap(c.id)}
                      >
                        <span
                          class={cn(
                            "mono shrink-0 text-body",
                            strategy() === c.id ? "text-accent-soft" : "text-text-faint",
                          )}
                          aria-hidden="true"
                        >
                          {strategy() === c.id ? "◉" : "○"}
                        </span>
                        <span class="min-w-11 shrink-0 text-meta font-medium text-text-faint">
                          {c.label}
                        </span>
                        <span class="mono min-w-0 flex-1 truncate text-body text-text">
                          {c.value}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              );
            })()}
          </Show>

          {/* wait-for — manual strategy selector + timeout */}
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
                <span class="inline-flex items-center gap-1">
                  <input
                    class={cn(valueTimeoutCls, "mono")}
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
                  <span class="mono text-meta text-text-faint">s</span>
                </span>
              );
            })()}
          </Show>

          {/* expect — target + condition (implied by which add-option was
              chosen) + timeout */}
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
                  <div class="seg" role="group" aria-label="Condition">
                    {(
                      [
                        ["visible", "Is visible"],
                        ["gone", "Is gone"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        type="button"
                        class="seg__btn"
                        classList={{ "seg__btn--on": s.condition === id }}
                        onClick={() => onEdit({ ...s, condition: id })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span class="inline-flex items-center gap-1">
                    <input
                      class={cn(valueTimeoutCls, "mono")}
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
                    <span class="mono text-meta text-text-faint">s</span>
                  </span>
                </>
              );
            })()}
          </Show>

          {/* type */}
          <Show when={kind() === "type"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "type") return null;
              let ref: HTMLInputElement | undefined;
              createEffect(() => {
                if (props.autofocus()) {
                  ref?.focus();
                  props.onAutofocused();
                }
              });
              return (
                <input
                  ref={ref}
                  class={cn(valueCls, "mono")}
                  type="text"
                  placeholder="text to type"
                  value={s.text}
                  onInput={(e) => onEdit({ ...s, text: e.currentTarget.value })}
                  spellcheck={false}
                />
              );
            })()}
          </Show>

          {/* sleep */}
          <Show when={kind() === "sleep"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "sleep") return null;
              let ref: HTMLInputElement | undefined;
              createEffect(() => {
                if (props.autofocus()) {
                  ref?.focus();
                  props.onAutofocused();
                }
              });
              return (
                <span class="inline-flex items-center gap-1">
                  <input
                    ref={ref}
                    class={cn(valueTimeoutCls, "mono")}
                    type="number"
                    min={0}
                    placeholder="500"
                    value={s.ms}
                    onInput={(e) => onEdit({ ...s, ms: parseInt(e.currentTarget.value, 10) || 0 })}
                  />
                  <span class="mono text-meta text-text-faint">ms</span>
                </span>
              );
            })()}
          </Show>

          {/* pause */}
          <Show when={kind() === "pause"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "pause") return null;
              let ref: HTMLInputElement | undefined;
              createEffect(() => {
                if (props.autofocus()) {
                  ref?.focus();
                  props.onAutofocused();
                }
              });
              return (
                <input
                  ref={ref}
                  class={valueCls}
                  type="text"
                  placeholder="instructions for the human (e.g. complete 2FA)"
                  value={s.message}
                  onInput={(e) => onEdit({ ...s, message: e.currentTarget.value })}
                  spellcheck={false}
                />
              );
            })()}
          </Show>

          {/* key */}
          <Show when={kind() === "key"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "key") return null;
              return (
                <div class="seg" role="group" aria-label="Key">
                  {(
                    [
                      ["back", "Back"],
                      ["home", "Home"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      type="button"
                      class="seg__btn"
                      classList={{ "seg__btn--on": s.key === id }}
                      onClick={() => onEdit({ kind: "key", key: id })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              );
            })()}
          </Show>

          {/* scroll */}
          <Show when={kind() === "scroll"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "scroll") return null;
              return (
                <>
                  <div class="seg" role="group" aria-label="Direction">
                    {(
                      [
                        ["down", "Down"],
                        ["up", "Up"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        type="button"
                        class="seg__btn"
                        classList={{ "seg__btn--on": s.direction === id }}
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
                  <input
                    class={cn(valueCls, "mono")}
                    type="number"
                    min={0}
                    placeholder="amount (optional)"
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
                </>
              );
            })()}
          </Show>

          {/* screenshot */}
          <Show when={kind() === "screenshot"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "screenshot") return null;
              return (
                <input
                  class={valueCls}
                  type="text"
                  placeholder="caption (optional)"
                  value={s.caption ?? ""}
                  onInput={(e) =>
                    onEdit({
                      kind: "screenshot",
                      ...(e.currentTarget.value ? { caption: e.currentTarget.value } : {}),
                    })
                  }
                  spellcheck={false}
                />
              );
            })()}
          </Show>

          {/* flow — pick which built-in flow this step runs */}
          <Show when={kind() === "flow"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "flow") return null;
              const flows = server.recipes().filter((r) => r.source === "builtin");
              return (
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
              );
            })()}
          </Show>

          {/* When annotated, the expanded row also shows that step's log. */}
          <Show when={anno().log}>
            <pre class="mono mt-1 max-h-40 w-full basis-full overflow-y-auto rounded-control bg-base px-2.5 py-2 text-meta leading-relaxed break-words whitespace-pre-wrap text-text-muted">
              {anno().log}
            </pre>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/**
 * The interactive step list for a custom recipe — the run pane's body when a
 * custom recipe is selected and no run is showing. Reads/writes through
 * `useRecipeDraft()`, which owns the debounced autosave; this component is
 * purely presentational + row-local ephemeral state (expand, run result).
 */
export function RecipeStepsEditor(): JSX.Element {
  const draft = useRecipeDraft();
  const server = useServer();
  const [expanded, setExpanded] = createSignal<number | null>(null);
  const [addAt, setAddAt] = createSignal<number | null>(null);
  const [focusIndex, setFocusIndex] = createSignal<number | null>(null);

  const wb = useWorkbench();

  function setOpen(i: number | null): void {
    setExpanded(i);
    draft.setExpandedStep(i);
  }

  function toggle(i: number): void {
    // Uber-style: click = select (and show on phone). Second click collapses detail only.
    if (expanded() === i && wb.focusedIndex() === i) {
      setOpen(null);
      return;
    }
    wb.focusStep(i);
    setExpanded(i);
  }

  function insertAt(at: number, step: RecipeStep): void {
    draft.insertStep(at, step);
    setAddAt(null);
    wb.focusStep(at);
    setExpanded(at);
    setFocusIndex(at);
  }

  // Keep draft.expandedStep in sync on selection changes / unmount.
  createEffect(() => {
    const id = server.selectedRecipeId();
    void id;
    setExpanded(null);
    draft.setExpandedStep(null);
    setAddAt(null);
  });

  // External focus (filmstrip / board card) opens the matching row.
  createEffect(() => {
    const f = wb.focusedIndex();
    if (f != null && f >= 0 && f < draft.steps().length) {
      setExpanded(f);
    }
  });

  // Empty guide + starter chips replace the old auto-open menu (less noise).

  /** Starters look like real steps (Uber density), not orphan chips in white space. */
  const STARTERS: { kind: string; title: string; make: () => RecipeStep }[] = [
    {
      kind: "Tap",
      title: "Tap an element on the phone",
      make: () => ({ kind: "tap", target: {} }),
    },
    { kind: "Type", title: "Type text into a field", make: () => ({ kind: "type", text: "" }) },
    {
      kind: "Check",
      title: "Check that something is visible",
      make: () => ({ kind: "expect", target: {}, condition: "visible" }),
    },
    { kind: "Wait", title: "Wait a moment", make: () => ({ kind: "sleep", ms: 1000 }) },
  ];

  const isEmpty = () => draft.steps().length === 0;

  return (
    <div class={cn("flex flex-col gap-0.5 pt-1 pb-6", isEmpty() && "pt-0")}>
      <Show when={isEmpty()}>
        <div class="flex w-full flex-col" role="group" aria-label="Add first step">
          <For each={STARTERS}>
            {(s, i) => (
              <button
                type="button"
                class="group flex w-full min-h-14 cursor-pointer items-center gap-3 border-0 border-b border-border bg-transparent px-4 py-2.5 text-left font-[inherit] text-inherit transition-colors hover:bg-accent/[0.08]"
                onClick={() => insertAt(0, s.make())}
              >
                <span class={cn(stepICls, "opacity-55")}>{i() + 1}</span>
                <span class="flex min-w-0 flex-1 flex-col items-start gap-0">
                  <span class={kindCls}>{s.kind}</span>
                  <span class="truncate font-medium text-text-muted">{s.title}</span>
                </span>
                <span
                  class="ml-auto grid size-7 shrink-0 place-items-center rounded-lg border border-border bg-layer-2 text-text-faint transition-colors group-hover:border-accent/35 group-hover:text-accent-soft"
                  aria-hidden="true"
                >
                  <Icon name="plus" size={14} />
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={!isEmpty()}>
        <InsertGap
          at={0}
          open={addAt() === 0}
          onToggle={() => setAddAt((a) => (a === 0 ? null : 0))}
          onPick={(s) => insertAt(0, s)}
          onClose={() => setAddAt(null)}
        />
      </Show>

      <Index each={draft.steps()}>
        {(step, i) => (
          <>
            <StepRow
              step={step}
              index={i}
              total={() => draft.steps().length}
              expanded={() => expanded() === i}
              flash={() => draft.flashSteps().has(step())}
              autofocus={() => focusIndex() === i}
              onAutofocused={() => setFocusIndex((f) => (f === i ? null : f))}
              onToggleExpand={() => toggle(i)}
              onChange={(next) => draft.updateStep(i, next)}
              onMove={(dir) => {
                draft.moveStep(i, dir);
                setOpen(expanded() === i ? i + dir : expanded() === i + dir ? i : expanded());
              }}
              onRemove={() => {
                draft.removeStep(i);
                const e = expanded();
                setOpen(e === null ? null : e === i ? null : e > i ? e - 1 : e);
              }}
              onDuplicate={() => draft.duplicateStep(i)}
            />
            <Show when={i + 1 < draft.steps().length}>
              <InsertGap
                at={i + 1}
                open={addAt() === i + 1}
                onToggle={() => setAddAt((a) => (a === i + 1 ? null : i + 1))}
                onPick={(s) => insertAt(i + 1, s)}
                onClose={() => setAddAt(null)}
              />
            </Show>
          </>
        )}
      </Index>

      <div class="relative mt-2 px-4 pt-2.5">
        <button
          type="button"
          class={cn(
            "btn btn-ghost h-[38px] w-full justify-center rounded-[10px] border border-border font-medium text-text-muted",
            "hover:border-accent/45 hover:bg-accent/[0.08] hover:text-accent-soft",
            isEmpty() && "border-dashed",
          )}
          aria-haspopup="menu"
          aria-expanded={addAt() === draft.steps().length}
          onClick={() =>
            setAddAt((a) => (a === draft.steps().length ? null : draft.steps().length))
          }
        >
          <Icon name="plus" size={14} />
          Add Step
        </button>
        <Show when={addAt() === draft.steps().length}>
          <AddMenu
            onPick={(s) => insertAt(draft.steps().length, s)}
            onClose={() => setAddAt(null)}
          />
        </Show>
      </div>
    </div>
  );
}
