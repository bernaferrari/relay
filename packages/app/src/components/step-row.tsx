import { Show, createSignal, type Accessor, type JSX } from "solid-js";
import { type RecipeStep } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { StepRowHeader } from "./step-row-header";
import { AddMenu } from "./step-list-controls";
import { StepEditor } from "./step-editor";

export { StepAnno } from "./step-row-header";

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
    const host = gapBtnEl?.parentElement?.parentElement ?? gapBtnEl;
    const rect = (host ?? gapBtnEl)?.getBoundingClientRect();
    if (rect) {
      setAnchor({
        left: rect.left + rect.width / 2 - 10,
        top: rect.top + rect.height / 2 - 10,
        bottom: rect.top + rect.height / 2 + 10,
        width: 20,
      });
    }
    props.onToggle();
  }
  return (
    <div
      class={cn("group/gap relative z-[1] h-0 overflow-visible", props.open && "z-[14]")}
      aria-hidden={props.open ? undefined : true}
    >
      <div class="pointer-events-none absolute inset-x-0 top-1/2 z-[1] h-8 -translate-y-1/2 overflow-visible">
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
            "pointer-events-auto absolute top-1/2 left-1/2 z-[2] flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full",
            "bg-surface-brand-base text-text-on-brand-base shadow-sm ring-2 ring-surface-raised-stronger-non-alpha",
            "opacity-0 scale-90 transition-[opacity,transform] duration-100 ease-out group-hover/gap:opacity-100 group-hover/gap:scale-100 focus-visible:opacity-100 focus-visible:scale-100",
            props.open && "opacity-100 scale-100",
          )}
          aria-label="Insert step"
          aria-haspopup="menu"
          aria-expanded={props.open}
          onClick={(event) => {
            event.stopPropagation();
            openMenu();
          }}
        >
          <Icon name="plus" size={13} strokeWidth={2.75} />
        </button>
        <button
          type="button"
          class="pointer-events-auto absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 cursor-pointer border-0 bg-transparent"
          tabindex={-1}
          aria-hidden="true"
          onClick={(event) => {
            event.stopPropagation();
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

export function StepRow(props: {
  step: Accessor<RecipeStep>;
  index: number;
  total: Accessor<number>;
  expanded: Accessor<boolean>;
  flash: Accessor<boolean>;
  autofocus: Accessor<boolean>;
  onAutofocused: () => void;
  onRowActivate: () => void;
  onEditToggle: () => void;
  onChange: (next: RecipeStep) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}): JSX.Element {
  const wb = useWorkbench();
  const selected = () => wb.focusedIndex() === props.index;
  const anno = () => wb.rowAnno(props.index);
  return (
    <div
      class={cn(
        "group/session relative w-full min-w-0 overflow-hidden rounded-[11px] transition-[background-color,box-shadow] duration-150",
        "hover:bg-surface-base-hover [&:has(:focus-visible)]:bg-surface-base-hover",
        selected() &&
          "bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_8%,var(--v2-background-bg-base))] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--v2-background-bg-accent)_14%,var(--v2-border-border-muted))] hover:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_10%,var(--v2-background-bg-base))]",
        !selected() &&
          props.expanded() &&
          "bg-[var(--v2-background-bg-base)] shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]",
        selected() &&
          props.expanded() &&
          "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--v2-background-bg-accent)_22%,var(--v2-border-border-muted))]",
        props.flash() && "bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_9%,transparent)]",
      )}
      data-selected={selected() ? "true" : undefined}
      data-expanded={props.expanded() ? "true" : undefined}
    >
      <StepRowHeader
        step={props.step}
        index={props.index}
        total={props.total}
        selected={selected}
        expanded={props.expanded}
        anno={anno}
        onRowActivate={props.onRowActivate}
        onEditToggle={props.onEditToggle}
        onMove={props.onMove}
        onRemove={props.onRemove}
        onDuplicate={props.onDuplicate}
      />
      <Show when={props.expanded()}>
        <StepEditor
          step={props.step}
          index={props.index}
          autofocus={props.autofocus}
          onAutofocused={props.onAutofocused}
          onChange={props.onChange}
        />
      </Show>
    </div>
  );
}
