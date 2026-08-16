import { For, Show } from "solid-js";
import type { AppMap } from "@relay/protocol";
import { APP_MAP_TEST_INTENT_LIMITS } from "@relay/protocol";
import { cn } from "../lib/cn";
import { menuOption, popover, productIconButton } from "../lib/ui";
import {
  SCENARIO_STEP_KINDS,
  SCENARIO_STEP_LABELS,
  type ScenarioDiagnostic,
  type ScenarioStepKind,
} from "../lib/app-map-test-editor-model";
import { scenarioStepPath, scenarioStepTitle } from "../lib/app-map-test-step-path";
import { testQuietRow, testSelectedRow } from "../lib/app-map-test-editor-styles";
import type { ScenarioStepBranch, ScenarioStepOutlineItem } from "../lib/app-map-test-editor-tree";
import { Icon } from "./icon";

export type StepDropTarget = { stepId: string; edge: "before" | "after" };

const rowMenuItem = cn(
  menuOption,
  "flex min-h-11 w-full items-center gap-2 px-2.5 text-left text-caption text-text-base",
  "hover:text-text-strong focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-border-strong-focus",
  "disabled:cursor-not-allowed disabled:text-text-weaker",
);

export function branchLabel(branch: ScenarioStepBranch): string {
  if (branch === "then") return "Then";
  if (branch === "else") return "Else";
  if (branch === "loop") return "Loop";
  return "Test";
}

export function stepRowLabel(item: ScenarioStepOutlineItem): string {
  return item.branch === "root"
    ? `Step ${item.index + 1}`
    : `${branchLabel(item.branch)} ${item.index + 1}`;
}

/**
 * One step. The primary line is the step's intent, because every row in a real
 * map shares a long identical binding prefix and the old row title was the step
 * *kind* — so 39 rows read "Instruction" and truncated away the only part that
 * differed. The binding path below it keeps its leaf visible by truncating the
 * ancestors instead of the tail.
 */
export function StepRow(props: {
  item: ScenarioStepOutlineItem;
  map: AppMap;
  selected: boolean;
  issue?: ScenarioDiagnostic;
  dropTarget?: StepDropTarget;
  dragging: boolean;
  onSelect: (stepId: string) => void;
  onOpen: (stepId: string) => void;
  onNavigate: (event: KeyboardEvent) => void;
  onAddChild: (
    parentStepId: string,
    branch: Exclude<ScenarioStepBranch, "root">,
    kind: ScenarioStepKind,
  ) => void;
  onMove: (stepId: string, direction: -1 | 1) => void;
  onDuplicate: (stepId: string) => void;
  onDelete: (stepId: string) => void;
  onDragStart: (item: ScenarioStepOutlineItem) => void;
  /** Returns true when this row can accept the dragged step. */
  onDragOver: (item: ScenarioStepOutlineItem, edge: "before" | "after") => boolean;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const step = () => props.item.step;
  const path = () => scenarioStepPath(props.map, step());
  const title = () => scenarioStepTitle(props.map, step());
  const canNest = () => props.item.depth < APP_MAP_TEST_INTENT_LIMITS.maxDepth;
  const dropEdge = () =>
    props.dropTarget?.stepId === step().id ? props.dropTarget.edge : undefined;

  return (
    <li
      class="relative grid gap-1"
      style={{ "padding-left": `${Math.min(props.item.depth, 3) * 14}px` }}
    >
      <Show when={props.item.depth > 0}>
        <span
          class="absolute top-0 bottom-0 w-px bg-border-weak-base"
          style={{ left: `${Math.min(props.item.depth, 3) * 14 - 7}px` }}
          aria-hidden="true"
        />
      </Show>
      <div
        class={cn(
          "group/step relative flex items-stretch rounded-md",
          props.dragging && "opacity-50",
          dropEdge() === "before" && "shadow-[inset_0_2px_0_0_var(--border-interactive-base)]",
          dropEdge() === "after" && "shadow-[inset_0_-2px_0_0_var(--border-interactive-base)]",
        )}
        draggable
        onDragStart={(event) => {
          event.dataTransfer?.setData("text/plain", step().id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
          props.onDragStart(props.item);
        }}
        onDragOver={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const edge = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
          if (props.onDragOver(props.item, edge)) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          props.onDrop();
        }}
        onDragEnd={props.onDragEnd}
      >
        <button
          type="button"
          id={`test-step-row-${step().id}`}
          data-step-row={step().id}
          tabindex={props.selected ? 0 : -1}
          class={cn(
            testQuietRow,
            "flex min-h-11 flex-1 items-center gap-2 py-1.5 pr-1 pl-1.5",
            props.selected && testSelectedRow,
          )}
          aria-current={props.selected ? "step" : undefined}
          aria-label={`${stepRowLabel(props.item)}: ${SCENARIO_STEP_LABELS[step().kind]} · ${title()}`}
          title={path().full || title()}
          onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest" })}
          onClick={() => props.onSelect(step().id)}
          onKeyDown={(event) => {
            if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
              event.preventDefault();
              props.onMove(step().id, event.key === "ArrowUp" ? -1 : 1);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              props.onOpen(step().id);
              return;
            }
            props.onNavigate(event);
          }}
        >
          <span
            class={cn(
              "grid size-5 shrink-0 place-items-center rounded text-micro font-semibold tabular-nums",
              props.selected
                ? "text-text-interactive-base"
                : props.issue?.tone === "blocker"
                  ? "text-icon-critical-base"
                  : "text-text-weaker",
            )}
            aria-hidden="true"
          >
            {props.item.branch === "root" ? props.item.index + 1 : branchGlyph(props.item.branch)}
          </span>
          <span class="grid min-w-0 flex-1 gap-px">
            <span class="flex min-w-0 items-center gap-1.5">
              <span class="min-w-0 truncate text-caption font-medium text-text-strong">
                {title()}
              </span>
              <Show when={props.issue}>
                {(issue) => (
                  <Icon
                    name={issue().tone === "blocker" ? "alert" : "info"}
                    size={11}
                    class={cn(
                      "shrink-0",
                      issue().tone === "blocker"
                        ? "text-icon-critical-base"
                        : "text-icon-warning-base",
                    )}
                  />
                )}
              </Show>
            </span>
            <span class="flex min-w-0 items-baseline gap-1 text-caption/[1.3] text-text-weak">
              <Show when={props.item.branch !== "root"}>
                <span class="shrink-0 font-medium text-text-weaker">
                  {branchLabel(props.item.branch)}
                </span>
              </Show>
              <span class="shrink-0 text-text-weaker">{SCENARIO_STEP_LABELS[step().kind]}</span>
              <Show when={path().leaf}>
                <span class="shrink-0 text-text-weaker" aria-hidden="true">
                  ·
                </span>
                <Show when={path().ancestors}>
                  <span class="min-w-0 truncate text-text-weaker">
                    {path().ancestors} <span aria-hidden="true">→</span>
                  </span>
                </Show>
                <span class="shrink-0 truncate">{path().leaf}</span>
              </Show>
            </span>
          </span>
        </button>
        <details
          class="relative shrink-0 self-center"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            event.currentTarget.removeAttribute("open");
            event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
          }}
        >
          <summary
            tabindex={props.selected ? 0 : -1}
            class={cn(
              productIconButton,
              "size-8 cursor-pointer list-none opacity-0",
              "group-hover/step:opacity-100 group-focus-within/step:opacity-100",
              props.selected && "opacity-100",
            )}
            aria-label={`Actions for ${stepRowLabel(props.item)}`}
          >
            <Icon name="more" size={14} />
          </summary>
          <div class={cn(popover, "absolute top-[calc(100%+4px)] right-0 z-30 grid w-48")}>
            <button
              type="button"
              class={rowMenuItem}
              aria-label={`Move ${stepRowLabel(props.item)} up`}
              disabled={props.item.index === 0}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                props.onMove(step().id, -1);
              }}
            >
              <Icon name="chevron-up" size={13} />
              <span class="flex-1">Move up</span>
              <kbd class="text-micro font-normal text-text-weaker">⌥↑</kbd>
            </button>
            <button
              type="button"
              class={rowMenuItem}
              aria-label={`Move ${stepRowLabel(props.item)} down`}
              disabled={props.item.index === props.item.siblingCount - 1}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                props.onMove(step().id, 1);
              }}
            >
              <Icon name="chevron-down" size={13} />
              <span class="flex-1">Move down</span>
              <kbd class="text-micro font-normal text-text-weaker">⌥↓</kbd>
            </button>
            <button
              type="button"
              class={rowMenuItem}
              aria-label={`Duplicate ${stepRowLabel(props.item)}`}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                props.onDuplicate(step().id);
              }}
            >
              <Icon name="copy" size={13} /> Duplicate
            </button>
            <button
              type="button"
              class={cn(rowMenuItem, "text-text-critical-base hover:text-icon-critical-base")}
              aria-label={`Delete ${stepRowLabel(props.item)}`}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                props.onDelete(step().id);
              }}
            >
              <Icon name="trash" size={13} /> Delete…
            </button>
          </div>
        </details>
      </div>
      <Show when={canNest() && step().kind === "decision"}>
        <BranchAdd parentId={step().id} branch="then" onAdd={props.onAddChild} />
        <BranchAdd parentId={step().id} branch="else" onAdd={props.onAddChild} />
      </Show>
      <Show when={canNest() && step().kind === "loop"}>
        <BranchAdd parentId={step().id} branch="loop" onAdd={props.onAddChild} />
      </Show>
    </li>
  );
}

function BranchAdd(props: {
  parentId: string;
  branch: Exclude<ScenarioStepBranch, "root">;
  onAdd: (
    parentStepId: string,
    branch: Exclude<ScenarioStepBranch, "root">,
    kind: ScenarioStepKind,
  ) => void;
}) {
  return (
    <div class="pl-3.5">
      <StepKindMenu
        label={`Add to ${branchLabel(props.branch)}`}
        variant="quiet"
        onPick={(kind) => props.onAdd(props.parentId, props.branch, kind)}
      />
    </div>
  );
}

/**
 * One primary "add" affordance with the eight step kinds behind it, replacing a
 * permanent `select` + button form that sat in the rail footer and again under
 * every decision and loop.
 */
export function StepKindMenu(props: {
  label: string;
  variant: "primary" | "quiet";
  onPick: (kind: ScenarioStepKind) => void;
}) {
  return (
    <details
      class="relative"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        event.currentTarget.removeAttribute("open");
        event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
      }}
    >
      <summary
        class={cn(
          "flex min-h-11 cursor-pointer list-none items-center justify-center gap-1.5 rounded-md",
          "transition-colors duration-150 motion-reduce:transition-none",
          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-border-strong-focus",
          props.variant === "primary"
            ? "w-full border border-border-weak-base bg-background-base text-caption font-medium text-text-strong hover:bg-surface-base-hover"
            : "justify-start px-2 text-caption font-medium text-text-weak hover:bg-surface-base-hover hover:text-text-strong",
        )}
        aria-label={props.label}
      >
        <Icon name="plus" size={13} />
        {props.label}
        <Show when={props.variant === "primary"}>
          <Icon name="chevron-down" size={12} class="text-text-weak" />
        </Show>
      </summary>
      <div
        class={cn(
          popover,
          "absolute bottom-[calc(100%+4px)] left-0 z-30 grid w-52",
          props.variant === "quiet" && "top-[calc(100%+4px)] bottom-auto",
        )}
        role="menu"
        aria-label={props.label}
      >
        <For each={SCENARIO_STEP_KINDS}>
          {(kind) => (
            <button
              type="button"
              role="menuitem"
              data-step-kind={kind}
              class={rowMenuItem}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                props.onPick(kind);
              }}
            >
              {SCENARIO_STEP_LABELS[kind]}
            </button>
          )}
        </For>
      </div>
    </details>
  );
}

function branchGlyph(branch: ScenarioStepBranch): string {
  if (branch === "then") return "T";
  if (branch === "else") return "E";
  return "↻";
}
