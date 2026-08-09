import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import type { RecipeStep, StepTarget } from "../context/server";
import { STRATEGIES, fmtPoint, parsePoint, type Strategy } from "../lib/step-target";
import { cn } from "../lib/cn";
import { ADD_GROUPS } from "./step-list-metadata";
import { accentForStep, iconForStep } from "./take-step-presentation";
import { Icon } from "./icon";
import { fieldInput, fieldLabel, mono, propRow, seg, segBtn, segBtnOn } from "../lib/ui";

const valueCls = cn(fieldInput, "min-w-0 flex-1");
const menuItemCls = cn(
  "grid min-h-8 w-full grid-cols-[20px_minmax(0,1fr)] items-center gap-2 rounded-md px-2",
  "text-left text-[12px] font-medium text-text-weak",
  "transition-colors duration-100 ease-out",
  "hover:bg-surface-raised-base-hover hover:text-text-strong",
);
const menuSectionCls = cn(
  "sticky top-0 z-[1] bg-surface-raised-stronger-non-alpha px-2 pt-2 pb-1",
  "text-[10px] font-semibold tracking-[0.08em] text-text-weaker uppercase",
);

export function ManualTarget(props: {
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

export function AddMenu(props: {
  onPick: (step: RecipeStep) => void;
  onClose: () => void;
  anchor: { left: number; top: number; bottom: number; width: number };
  placement?: "below" | "above";
  /** Record on the device — the default way to add a step. */
  onRecord?: () => void;
}): JSX.Element {
  const [query, setQuery] = createSignal("");
  const groups = createMemo(() => {
    const value = query().trim().toLocaleLowerCase();
    if (!value) return ADD_GROUPS;
    return ADD_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${group.label} ${item.label}`.toLocaleLowerCase().includes(value),
      ),
    })).filter((group) => group.items.length > 0);
  });
  let menuEl: HTMLDivElement | undefined;
  let search: HTMLInputElement | undefined;
  const pos = () => {
    const a = props.anchor;
    const menuW = 288,
      gap = 6;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const left = Math.max(8, Math.min(a.left + a.width / 2 - menuW / 2, vw - menuW - 8));
    const spaceBelow = vh - a.bottom - gap,
      spaceAbove = a.top - gap;
    const openAbove =
      props.placement === "above"
        ? spaceAbove >= 120 || spaceAbove > spaceBelow
        : spaceBelow < 160 && spaceAbove > spaceBelow;
    const top = openAbove ? undefined : a.bottom + gap;
    const bottom = openAbove ? vh - a.top + gap : undefined;
    const maxH = openAbove
      ? Math.min(420, Math.max(120, spaceAbove - 8))
      : Math.min(420, Math.max(120, spaceBelow - 8));
    return { left, top, bottom, maxH, openAbove };
  };
  onMount(() => {
    const onDoc = (e: MouseEvent) => {
      if (menuEl && !menuEl.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onClose();
      }
    };
    const timer = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    window.addEventListener("keydown", onKey);
    queueMicrotask(() => search?.focus({ preventScroll: true }));
    onCleanup(() => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    });
  });
  return (
    <Portal>
      {/* The search field is a sibling of the scroller, not a sticky child of
          it. Sticky inside a padded scroll container leaves a gap at the top
          that rows visibly scroll through. */}
      <div
        ref={(el) => {
          menuEl = el;
        }}
        class={cn(
          "ui-pop fixed z-[200] flex w-[288px] flex-col overflow-hidden rounded-xl",
          "border border-[var(--border-strong-base)] bg-surface-raised-stronger-non-alpha",
          "text-text-strong shadow-[var(--shadow-lg)]",
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
      >
        <label class="flex h-10 shrink-0 items-center gap-2 border-b border-border-weak-base px-3 text-text-weaker">
          <Icon name="search" size={14} />
          <input
            ref={(element) => {
              search = element;
            }}
            class="min-w-0 flex-1 bg-transparent text-[12.5px] text-text-strong outline-none placeholder:text-text-weaker"
            type="search"
            value={query()}
            placeholder="Find a step"
            aria-label="Find a step"
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <div class="min-h-0 flex-1 overflow-y-auto p-1">
          {/* Recording on the device is the default. The catalog below is for
              the things you cannot demonstrate — waits, checks, reuse. */}
          <Show when={props.onRecord && !query().trim()}>
            <button
              type="button"
              role="menuitem"
              class={cn(menuItemCls, "text-text-strong")}
              onClick={() => {
                props.onClose();
                props.onRecord?.();
              }}
            >
              <span
                class="size-2 justify-self-center rounded-full bg-[var(--icon-critical-base)]"
                aria-hidden="true"
              />
              <span class="truncate">Record path</span>
            </button>
            <div class="my-1 h-px bg-border-weak-base" />
          </Show>
          <For each={groups()}>
            {(g) => (
              <div class="flex flex-col gap-px">
                <div class={menuSectionCls}>{g.label}</div>
                <For each={g.items}>
                  {(o) => {
                    const step = createMemo(() => o.make());
                    return (
                      <button
                        type="button"
                        class={menuItemCls}
                        role="menuitem"
                        onClick={() => props.onPick(o.make())}
                      >
                        <span
                          class="justify-self-center text-[color-mix(in_srgb,var(--map-node-accent)_78%,white)]"
                          style={{ "--map-node-accent": accentForStep(step()) }}
                          aria-hidden="true"
                        >
                          <Icon name={iconForStep(step())} size={13} />
                        </span>
                        <span class="truncate">{o.label}</span>
                      </button>
                    );
                  }}
                </For>
              </div>
            )}
          </For>
          <Show when={groups().length === 0}>
            <p class="px-3 py-6 text-center text-[12px] text-text-weak">No matching step</p>
          </Show>
        </div>
      </div>
    </Portal>
  );
}
