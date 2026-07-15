import { Show, createSignal, onCleanup, onMount, type Accessor, type JSX } from "solid-js";
import { IconButton } from "@relay/ui/icon-button";
import { useServer, type RecipeStep } from "../context/server";
import { useWorkbench, type RowAnno } from "../context/workbench";
import { cn } from "../lib/cn";
import { fmtMs } from "../lib/job";
import { stepIssue } from "../lib/step-sentence";
import { mono, popover } from "../lib/ui";
import { Icon } from "./icon";
import { kindIcon, kindLabel, stepDetail } from "./step-list-metadata";

const moreItemCls = cn(
  "block w-full rounded-md px-2.5 py-[7px] text-left text-12-medium text-text-strong",
  "transition-colors duration-100 ease-out",
  "hover:enabled:bg-surface-raised-base-hover disabled:cursor-default disabled:opacity-40",
);

/** The single run-state annotation used by every compact step row. */
export function StepAnno(props: { anno: Accessor<RowAnno> }): JSX.Element {
  const duration = () => fmtMs(props.anno().durationMs);
  return (
    <Show when={props.anno().status !== "idle"}>
      <span
        class="inline-flex shrink-0 items-center justify-end gap-1 tabular-nums"
        aria-hidden="true"
      >
        <Show when={props.anno().status === "running"}>
          <span class="size-1.5 animate-pulse rounded-full bg-icon-info-base" />
        </Show>
        <Show when={props.anno().status === "pass"}>
          <span class="ui-check grid size-4 place-items-center text-icon-success-base">
            <Icon name="check" size={12} strokeWidth={2.5} />
          </span>
          <Show when={duration()}>
            <span class={cn(mono, "text-12-regular leading-none text-text-weak")}>
              {duration()}
            </span>
          </Show>
        </Show>
        <Show when={props.anno().status === "fail"}>
          <span class="ui-check grid size-4 place-items-center text-icon-critical-base">
            <Icon name="x" size={12} strokeWidth={2.5} />
          </span>
          <Show when={duration()}>
            <span class={cn(mono, "text-12-regular leading-none text-text-weak")}>
              {duration()}
            </span>
          </Show>
        </Show>
      </span>
    </Show>
  );
}

/**
 * The compact, always-visible portion of a step row. It owns row actions and
 * run affordances; the parent continues to own selection and editor state.
 */
export function StepRowHeader(props: {
  step: Accessor<RecipeStep>;
  index: number;
  total: Accessor<number>;
  selected: Accessor<boolean>;
  expanded: Accessor<boolean>;
  anno: Accessor<RowAnno>;
  onRowActivate: () => void;
  onEditToggle: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}): JSX.Element {
  const server = useServer();
  const wb = useWorkbench();
  const [moreOpen, setMoreOpen] = createSignal(false);
  const kind = () => props.step().kind;
  const issue = () => stepIssue(props.step());

  onMount(() => {
    const onDoc = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.("[data-step-more]")) setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && moreOpen()) {
        event.stopPropagation();
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

  return (
    <>
      <div class="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-1 pr-2">
        <button
          type="button"
          class="grid min-w-0 cursor-pointer grid-cols-[30px_minmax(0,1fr)] items-start gap-3 rounded-[11px] px-3 py-3 text-left outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus"
          aria-current={props.selected() ? "step" : undefined}
          aria-expanded={props.expanded()}
          onClick={props.onRowActivate}
        >
          <span
            class={cn(
              "grid size-[30px] place-items-center rounded-[9px] font-mono text-[12px] font-medium tabular-nums transition-[background-color,color,box-shadow] duration-150",
              props.selected()
                ? "bg-[color-mix(in_srgb,var(--relay-accent)_16%,transparent)] text-[var(--text-interactive-base)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--relay-accent)_30%,transparent)]"
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
                class={cn("shrink-0", props.selected() && "text-[var(--text-interactive-base)]")}
                aria-hidden={true}
              />
              <span class={cn(props.selected() && "text-[var(--relay-text-secondary)]")}>
                {kindLabel(kind())}
              </span>
              <span class="ml-auto shrink-0 pl-2">
                <StepAnno anno={props.anno} />
              </span>
            </div>
            <span class="mt-1.5 block w-full min-w-0 truncate text-[14px]/[1.4] font-medium tracking-[-0.005em] text-[var(--relay-text)]">
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
            props.selected() || props.expanded()
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
              onClick={() => setMoreOpen((open) => !open)}
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
                    props.onRemove();
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
            onClick={(event) => {
              event.stopPropagation();
              props.onEditToggle();
            }}
          >
            <Icon name={props.expanded() ? "chevron-down" : "chevron-right"} size={14} />
          </IconButton>
        </span>
      </div>

      <Show when={props.anno().status === "fail" && props.anno().error}>
        <p class="mb-2 flex items-start gap-1.5 px-3 pr-3 pl-11 text-12-regular leading-snug text-icon-critical-base">
          <Icon name="alert" size={11} class="mt-0.5 shrink-0" />
          <span class="min-w-0 break-words">{props.anno().error}</span>
        </p>
      </Show>
    </>
  );
}
