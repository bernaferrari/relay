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
import { Portal } from "solid-js/web";
import {
  useServer,
  type RecordedSelectorCandidate,
  type RecipeStep,
  type StepTarget,
} from "../context/server";
import { useRecipeDraft } from "../context/recipe-draft";
import { useWorkbench, type RowAnno } from "../context/workbench";
// useWorkbench used in RecipeStepsEditor for step↔frame focus
import { sentenceForStep, stepIssue } from "../lib/step-sentence";
import { fmtMs, titleize, type TitledId } from "../lib/job";
import {
  STRATEGIES,
  defaultStrategy,
  detectedChain,
  fmtPoint,
  parsePoint,
  type Strategy,
} from "../lib/step-target";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "./icon";
import { RecordingEvidencePanel } from "./recording-evidence-panel";
import { IconButton } from "@relay/ui/icon-button";
import {
  btnBar,
  fieldInput,
  fieldLabel,
  listRow,
  listRowActive,
  listRowExpanded,
  mono,
  popover,
  propRow,
  seg,
  segBtn,
  segBtnOn,
  stepIndex,
  stepIndexOn,
} from "../lib/ui";

type AddOption = { label: string; make: () => RecipeStep };
type AddGroup = { label: string; items: AddOption[] };

const valueCls = cn(fieldInput, "min-w-0 flex-1");
const valueTimeoutCls = cn(fieldInput, "w-[52px] min-w-0 flex-none text-center tabular-nums");
/** Portal add-menu row — AB list hover wash */
const menuItemCls = cn(
  "block w-full rounded-md px-2.5 py-[7px] text-left text-12-medium text-text-strong",
  "transition-colors duration-100 ease-out",
  "hover:bg-surface-raised-base-hover",
);
const moreItemCls = cn(
  "block w-full rounded-md px-2.5 py-[7px] text-left text-12-medium text-text-strong",
  "transition-colors duration-100 ease-out",
  "hover:enabled:bg-surface-raised-base-hover disabled:cursor-default disabled:opacity-40",
);
const menuSectionCls =
  "px-2.5 pt-1.5 pb-1 text-12-medium tracking-[0.06em] text-text-weak uppercase";
/** Figma properties sheet under the selected layer */
const editorPanel = cn(
  "flex w-full min-w-0 flex-col gap-2.5 overflow-hidden border-t border-border-weak-base",
  "bg-background-base px-3.5 py-3 pl-3.5",
);

/** Short kind chip — Uber-style “Instruction / Manual” density. */
function kindLabel(kind: string): string {
  switch (kind) {
    case "tap":
      return "Tap";
    case "long-press":
      return "Hold";
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
    case "module":
      return "Reuse";
    case "clipboard":
      return "Clipboard";
    case "app":
      return "App";
    case "device":
      return "Device";
    case "rotate":
      return "Rotate";
    case "settings":
      return "Setting";
    case "location":
      return "Location";
    case "permission":
      return "Permission";
    case "alert":
      return "Alert";
    case "network":
      return "Network";
    case "logs":
      return "Logs";
    default:
      return kind;
  }
}

/** The kind chip already names the action, so the adjacent copy only carries
 * the useful payload. This avoids rows such as “Tap · Tap Sign in”. */
function stepDetail(step: RecipeStep, recipes: Iterable<TitledId>): string {
  const sentence = sentenceForStep(step, recipes);
  const prefixes: Partial<Record<RecipeStep["kind"], string[]>> = {
    tap: ["Tap "],
    "long-press": ["Long press "],
    type: ["Type "],
    expect: ["Check "],
    "wait-for": ["Wait until "],
    sleep: ["Wait "],
    key: ["Press "],
    scroll: ["Scroll "],
    swipe: ["Swipe "],
    screenshot: ["Screenshot · ", "Screenshot"],
    module: ["Run "],
    clipboard: ["Set clipboard ", "Check clipboard ", "Read clipboard"],
    app: ["Open app ", "Open ", "Close "],
    device: ["Lock ", "Unlock ", "Dismiss ", "Press "],
    rotate: ["Rotate "],
    settings: ["Set "],
    location: ["Set location "],
    permission: ["Grant ", "Deny ", "Reset "],
    alert: ["Accept ", "Dismiss ", "Wait for ", "Inspect "],
    network: ["Capture network ", "Mark network "],
    logs: ["Start ", "Stop ", "Mark ", "Clear "],
  };
  for (const prefix of prefixes[step.kind] ?? []) {
    if (sentence === prefix) return "Capture screen";
    if (sentence.startsWith(prefix)) return sentence.slice(prefix.length);
  }
  return sentence;
}

/** Add-step menu, grouped Act / Check / More. Swipe is deliberately absent —
 *  authoring meaningful from/to coordinates by hand isn't worth the UI; swipe
 *  steps still show up fine once recorded from the device. */
const ADD_GROUPS: AddGroup[] = [
  {
    label: "Act",
    items: [
      { label: "Tap element", make: () => ({ kind: "tap", target: {} }) },
      {
        label: "Long press element",
        make: () => ({ kind: "long-press", target: {}, durationMs: 700 }),
      },
      { label: "Type text", make: () => ({ kind: "type", text: "" }) },
      { label: "Scroll", make: () => ({ kind: "scroll", direction: "down" }) },
      { label: "Press Back", make: () => ({ kind: "key", key: "back" }) },
      { label: "Press Home", make: () => ({ kind: "key", key: "home" }) },
      { label: "Open app switcher", make: () => ({ kind: "app", action: "switcher" }) },
      { label: "Open app or deep link", make: () => ({ kind: "app", action: "open", app: "" }) },
      { label: "Lock device", make: () => ({ kind: "device", action: "lock" }) },
      { label: "Unlock device", make: () => ({ kind: "device", action: "unlock" }) },
      { label: "Dismiss keyboard", make: () => ({ kind: "device", action: "keyboard-dismiss" }) },
      { label: "Rotate device", make: () => ({ kind: "rotate", orientation: "landscape-left" }) },
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
      {
        label: "Check clipboard",
        make: () => ({ kind: "clipboard", action: "read", expect: "", match: "exact" }),
      },
    ],
  },
  {
    label: "More",
    items: [
      { label: "Screenshot", make: () => ({ kind: "screenshot" }) },
      { label: "Pause for human", make: () => ({ kind: "pause", message: "" }) },
      { label: "Set clipboard", make: () => ({ kind: "clipboard", action: "write", text: "" }) },
      { label: "Reuse another test", make: () => ({ kind: "module", recipeId: "" }) },
      {
        label: "Capture network",
        make: () => ({ kind: "network", action: "dump", include: "headers", limit: 100 }),
      },
      {
        label: "Mark device logs",
        make: () => ({ kind: "logs", action: "mark", message: "checkpoint" }),
      },
      { label: "Set location", make: () => ({ kind: "location", latitude: 0, longitude: 0 }) },
      {
        label: "Set permission",
        make: () => ({ kind: "permission", action: "grant", permission: "camera" }),
      },
      { label: "Handle system alert", make: () => ({ kind: "alert", action: "accept" }) },
      {
        label: "Change device setting",
        make: () => ({ kind: "settings", setting: "wifi", state: "on" }),
      },
    ],
  },
];

function isTargetKind(
  step: RecipeStep,
): step is Extract<RecipeStep, { kind: "tap" | "long-press" | "wait-for" | "expect" }> {
  return (
    step.kind === "tap" ||
    step.kind === "long-press" ||
    step.kind === "wait-for" ||
    step.kind === "expect"
  );
}

/** Target strategy + value — Figma property rows, not free-floating form soup. */
function ManualTarget(props: {
  target: Accessor<StepTarget>;
  strategy: Accessor<Strategy>;
  onStrategy: (s: Strategy) => void;
  onPatch: (patch: Partial<StepTarget>) => void;
  autofocus?: Accessor<boolean>;
  onAutofocused?: () => void;
}): JSX.Element {
  const strat = () => STRATEGIES.find((x) => x.id === props.strategy());
  let inputEl: HTMLInputElement | undefined;
  createEffect(() => {
    if (props.autofocus?.()) {
      inputEl?.focus();
      props.onAutofocused?.();
    }
  });
  return (
    <div class="flex flex-col gap-2">
      <div class={propRow}>
        <span class={fieldLabel}>Target</span>
        <div class={cn(seg, "w-fit max-w-full")} role="group" aria-label="Target strategy">
          <For each={STRATEGIES}>
            {(st) => (
              <button
                type="button"
                class={props.strategy() === st.id ? segBtnOn : segBtn}
                onClick={() => props.onStrategy(st.id)}
              >
                {st.label}
              </button>
            )}
          </For>
        </div>
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
            <div class={propRow}>
              <span class={fieldLabel}>Value</span>
              <input
                ref={(el) => {
                  inputEl = el;
                }}
                class={cn(valueCls, mono)}
                type="text"
                placeholder={st().placeholder}
                value={value()}
                onInput={(e) => onInput(e.currentTarget.value)}
                spellcheck={false}
              />
            </div>
          );
        }}
      </Show>
    </div>
  );
}

/**
 * Add-step menu — always portaled + position:fixed so it never:
 *  - expands the scroll container
 *  - gets clipped by overflow-y-auto
 *  - triggers scrollIntoView jumps when focused
 */
function AddMenu(props: {
  onPick: (step: RecipeStep) => void;
  onClose: () => void;
  /** Anchor rect in viewport coordinates */
  anchor: { left: number; top: number; bottom: number; width: number };
  /** Prefer opening above (footer) or below (insert gaps). */
  placement?: "below" | "above";
}): JSX.Element {
  let menuEl: HTMLDivElement | undefined;
  const preferAbove = () => props.placement === "above";

  const pos = () => {
    const a = props.anchor;
    const menuW = 260;
    const gap = 6;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    // Center under/over the anchor, clamp into viewport
    let left = a.left + a.width / 2 - menuW / 2;
    left = Math.max(8, Math.min(left, vw - menuW - 8));
    const spaceBelow = vh - a.bottom - gap;
    const spaceAbove = a.top - gap;
    const openAbove = preferAbove()
      ? spaceAbove >= 120 || spaceAbove > spaceBelow
      : spaceBelow < 160 && spaceAbove > spaceBelow;
    const top = openAbove ? undefined : a.bottom + gap;
    const bottom = openAbove ? vh - a.top + gap : undefined;
    const maxH = openAbove
      ? Math.min(360, Math.max(120, spaceAbove - 8))
      : Math.min(360, Math.max(120, spaceBelow - 8));
    return { left, top, bottom, maxH, openAbove };
  };

  onMount(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuEl && !menuEl.contains(t)) props.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onClose();
      }
    };
    // Defer outside-close so the opening click doesn't immediately dismiss.
    const t = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc);
    }, 0);
    window.addEventListener("keydown", onKey);
    queueMicrotask(() =>
      menuEl?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus({ preventScroll: true }),
    );
    onCleanup(() => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    });
  });

  return (
    <Portal>
      <div
        class={cn(
          popover,
          "fixed z-[200] flex w-[260px] flex-col overflow-y-auto",
          pos().openAbove ? "origin-bottom" : "origin-top",
        )}
        style={{
          left: `${pos().left}px`,
          ...(pos().top != null ? { top: `${pos().top}px` } : {}),
          ...(pos().bottom != null ? { bottom: `${pos().bottom}px` } : {}),
          "max-height": `${pos().maxH}px`,
        }}
        role="menu"
        aria-label="Add step"
        ref={(el) => {
          menuEl = el;
        }}
      >
        <For each={ADD_GROUPS}>
          {(g, gi) => (
            <div
              class={cn(
                "flex flex-col gap-px",
                gi() > 0 && "mt-1 border-t border-border-weak-base pt-1",
              )}
            >
              <div class={menuSectionCls}>{g.label}</div>
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
    </Portal>
  );
}

/**
 * Mid-list insert — zero layout height always. Menu portals to body.
 */
function InsertGap(props: {
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

function StepRow(props: {
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
      { kind: "tap" | "long-press" | "wait-for" | "expect" }
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
  const runTip = () =>
    runDisabledReason() ||
    (wb.autoContinue() ? "Run from this step (Auto-continue is on)" : "Run this step");

  function armDelete(): void {
    props.onRemove();
  }

  // Selection (phone focus) is independent of editor expand — list stays navigable.
  const selected = () => focused();
  return (
    <div
      class={cn(
        // AgentBoard: inset rounded chip, quiet hover/active only — status via StepAnno
        listRow,
        "test-step-card",
        selected() && listRowActive,
        !selected() && props.expanded() && listRowExpanded,
        props.flash() && listRowActive,
      )}
      data-selected={selected() ? "true" : undefined}
      data-expanded={props.expanded() ? "true" : undefined}
    >
      <div
        class={cn(
          "test-step-card__row grid min-h-0 w-full min-w-0 cursor-pointer grid-cols-[22px_minmax(0,1fr)_5.15rem] items-center gap-2 px-2 py-1",
          "outline-none",
        )}
        tabindex={0}
        aria-current={selected() ? "true" : undefined}
        aria-expanded={props.expanded()}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-step-actions], [data-step-more-menu]"))
            return;
          props.onRowActivate();
        }}
        onKeyDown={(e) => {
          // Nested action buttons keep their own keys; only handle on the row shell.
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onRowActivate();
          }
        }}
      >
        {/* Exclusive recipes — never stack stepIndex + stepIndexOn (cn has no merge) */}
        <span class={cn(selected() ? stepIndexOn : stepIndex, "mt-0.5")}>{props.index + 1}</span>

        <div class="test-step-card__content min-w-0 overflow-hidden">
          <div class="test-step-card__summary flex w-full min-w-0 items-center gap-1.5 overflow-hidden leading-none">
            <span class="test-step-card__kind">{kindLabel(kind())}</span>
            <span class="test-step-card__divider" aria-hidden="true">
              ·
            </span>
            <span class="test-step-card__detail min-w-0 flex-1 truncate">
              {stepDetail(props.step(), server.recipes())}
            </span>
            <StepAnno anno={anno} />
          </div>
          <Show when={issue() && !props.expanded()}>
            <span class="test-step-card__issue">Incomplete · {issue()}</span>
          </Show>
        </div>

        <span
          data-step-actions
          class={cn(
            "flex w-[5.15rem] shrink-0 items-center justify-end gap-0.5 overflow-hidden",
            "transition-opacity duration-100 ease-out",
            // Edit, explicit run, overflow. Destructive/reorder actions live in overflow.
            selected() || props.expanded()
              ? "opacity-100"
              : "pointer-events-none opacity-0 group-hover/session:pointer-events-auto group-hover/session:opacity-100 group-focus-within/session:pointer-events-auto group-focus-within/session:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
          )}
        >
          <IconButton
            variant="ghost"
            size="normal"
            class="rounded-md"
            active={props.expanded()}
            data-tip={props.expanded() ? "Close (Esc)" : "Edit"}
            aria-label={props.expanded() ? "Close step editor" : "Edit step"}
            aria-expanded={props.expanded()}
            onClick={(e) => {
              e.stopPropagation();
              props.onEditToggle();
            }}
          >
            <Icon name={props.expanded() ? "chevron-down" : "chevron-right"} size={14} />
          </IconButton>
          <IconButton
            variant="ghost"
            size="normal"
            class="rounded-md"
            data-tip={runTip()}
            aria-label="Run this step"
            disabled={!canRunStep()}
            onClick={() => void wb.runFrom(props.index)}
          >
            <Icon name="play" size={13} />
          </IconButton>
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
                <div class={propRow}>
                  <span class={fieldLabel}>Message</span>
                  <input
                    ref={(el) => {
                      inputEl = el;
                    }}
                    class={valueCls}
                    type="text"
                    placeholder="e.g. complete 2FA"
                    value={s.message}
                    onInput={(e) => onEdit({ ...s, message: e.currentTarget.value })}
                    spellcheck={false}
                  />
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
              return (
                <div class={propRow}>
                  <span class={fieldLabel}>Test</span>
                  <select
                    class={valueCls}
                    value={s.recipeId}
                    onChange={(e) => onEdit({ ...s, recipeId: e.currentTarget.value })}
                  >
                    <option value="">Choose a reusable test…</option>
                    <For each={choices}>{(r) => <option value={r.id}>{r.title}</option>}</For>
                  </select>
                </div>
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
                          action: e.currentTarget.value as "open" | "close" | "switcher",
                          ...(e.currentTarget.value !== "switcher" ? { app: s.app ?? "" } : {}),
                        })
                      }
                    >
                      <option value="open">Open app / deep link</option>
                      <option value="close">Close app</option>
                      <option value="switcher">Open app switcher</option>
                    </select>
                  </div>
                  <Show when={s.action !== "switcher"}>
                    <div class={propRow}>
                      <span class={fieldLabel}>App</span>
                      <input
                        class={cn(valueCls, mono)}
                        value={s.app ?? s.url ?? ""}
                        placeholder="package, app name, or URL"
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
                </>
              );
            })()}
          </Show>

          <Show when={kind() === "device"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "device") return null;
              return (
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

  function toggleEditor(i: number): void {
    if (expanded() === i) {
      setOpen(null);
      return;
    }
    wb.focusStep(i);
    setOpen(i);
  }

  function onRowActivate(i: number): void {
    // One click has one meaning: select this step and open its editor.
    // Running is always explicit through the play action.
    toggleEditor(i);
  }

  function onEditToggle(i: number): void {
    // Chevron always opens/closes this row's editor (and selects it).
    toggleEditor(i);
  }

  function insertAt(at: number, step: RecipeStep): void {
    draft.insertStep(at, step);
    setAddAt(null);
    wb.focusStep(at);
    setOpen(at); // new / incomplete step: open editor so they can fill it
    setFocusIndex(at);
  }

  // Reset editor chrome when switching tests — never when merely focusing a step.
  createEffect(() => {
    const id = server.selectedRecipeId();
    void id;
    setExpanded(null);
    draft.setExpandedStep(null);
    setAddAt(null);
  });

  // Escape collapses the editor (back to list context) without deselecting.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (addAt() != null) {
        e.stopPropagation();
        setAddAt(null);
        return;
      }
      if (expanded() != null) {
        e.stopPropagation();
        setOpen(null);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // Empty guide + starter chips replace the old auto-open menu (less noise).

  /** Compact starter chips — not fake step rows (that confused empty vs content). */
  const STARTERS: {
    label: string;
    description: string;
    icon: IconName;
    make: () => RecipeStep;
  }[] = [
    {
      label: "Tap",
      description: "Select an element or point",
      icon: "pointer",
      make: () => ({ kind: "tap", target: {} }),
    },
    {
      label: "Type",
      description: "Enter text or a variable",
      icon: "keyboard",
      make: () => ({ kind: "type", text: "" }),
    },
    {
      label: "Check",
      description: "Verify what appears on screen",
      icon: "check",
      make: () => ({ kind: "expect", target: {}, condition: "visible" }),
    },
    {
      label: "Wait",
      description: "Pause for a fixed duration",
      icon: "clock",
      make: () => ({ kind: "sleep", ms: 1000 }),
    },
  ];

  const isEmpty = () => draft.steps().length === 0;

  let footerBtnEl: HTMLButtonElement | undefined;
  const [footerAnchor, setFooterAnchor] = createSignal({
    left: 0,
    top: 0,
    bottom: 0,
    width: 0,
  });
  const footerOpen = () => addAt() === draft.steps().length;

  return (
    <div class="test-step-editor flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Full-height scroll — no floating card over a cream void */}
      <div class="test-step-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <Show when={isEmpty()}>
          <div class="test-step-empty" role="group" aria-label="Add first step">
            <div class="test-step-empty__content">
              <span class="test-step-empty__eyebrow">Manual step</span>
              <h3>Start with an action</h3>
              <p>
                Choose one to configure it. Recording on the device adds steps here automatically.
              </p>
              <div class="test-step-empty__grid">
                <For each={STARTERS}>
                  {(s) => (
                    <button
                      type="button"
                      class="test-step-empty__action"
                      onClick={() => insertAt(0, s.make())}
                    >
                      <span class="test-step-empty__icon" aria-hidden="true">
                        <Icon name={s.icon} size={16} strokeWidth={1.8} />
                      </span>
                      <span class="test-step-empty__action-copy">
                        <strong>{s.label}</strong>
                        <small>{s.description}</small>
                      </span>
                      <Icon name="chevron-right" size={14} class="test-step-empty__arrow" />
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Show>

        <Show when={!isEmpty()}>
          {/* Inset list — AgentBoard chip rows + gap-1 air */}
          <div class="test-step-list flex flex-col gap-2 py-4">
            <InsertGap
              at={0}
              open={addAt() === 0}
              onToggle={() => setAddAt((a) => (a === 0 ? null : 0))}
              onPick={(s) => insertAt(0, s)}
              onClose={() => setAddAt(null)}
            />

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
                    onRowActivate={() => onRowActivate(i)}
                    onEditToggle={() => onEditToggle(i)}
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
          </div>
        </Show>
      </div>

      <div class="test-step-footer relative shrink-0 border-t border-border-weak-base bg-surface-raised-stronger-non-alpha px-3 py-2.5 text-text-strong">
        <button
          type="button"
          ref={(el) => {
            footerBtnEl = el;
          }}
          class={cn(
            btnBar,
            "hover:bg-surface-raised-base-hover",
            footerOpen() && "bg-surface-base-active",
          )}
          aria-haspopup="menu"
          aria-expanded={footerOpen()}
          onClick={() => {
            const r = footerBtnEl?.getBoundingClientRect();
            if (r)
              setFooterAnchor({
                left: r.left,
                top: r.top,
                bottom: r.bottom,
                width: r.width,
              });
            setAddAt((a) => (a === draft.steps().length ? null : draft.steps().length));
          }}
        >
          <Icon name="plus" size={14} strokeWidth={2} class="text-icon-base" />
          Add a step…
        </button>
        <Show when={footerOpen()}>
          <AddMenu
            anchor={footerAnchor()}
            placement="above"
            onPick={(s) => insertAt(draft.steps().length, s)}
            onClose={() => setAddAt(null)}
          />
        </Show>
      </div>
    </div>
  );
}
