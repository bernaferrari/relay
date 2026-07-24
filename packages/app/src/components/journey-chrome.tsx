import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { useRecipeDraft } from "../context/recipe-draft";
import {
  useServer,
  type RecipeStep,
  type RecordedNodeEvidence,
  type StepTarget,
} from "../context/server";
import { toast } from "../context/toast";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { sentenceForStep, stepValid } from "../lib/step-sentence";
import { defaultStrategy, fmtPoint, type Strategy } from "../lib/step-target";
import {
  anchoredPoint,
  coordinateAnchor,
  pointForAnchor,
  targetHierarchy,
  targetNodeIndex,
  type HorizontalConstraint,
  type VerticalConstraint,
} from "../lib/target-inspector";
import { fmtAgo, fmtDur } from "../lib/job";
import {
  convertStepAction,
  convertTapGesture,
  FALLBACK_DEVICE_BOUNDS,
  isTapAction,
  tapGesture,
  type EditableActionKind,
  type TapGesture,
} from "../lib/journey-action-conversion";
import { testRunBlocker } from "../lib/test-run-readiness";
import { Icon } from "./icon";
import {
  accentForStep,
  actionForStep,
  evidenceForStep,
  iconForStep,
} from "./journey-step-presentation";
import { ActionPicker } from "./action-picker";
import { CoordinateConstraintPicker } from "./coordinate-constraint-picker";
import { MaterialDiscreteSlider } from "./material-discrete-slider";
import { StepEditor } from "./step-editor";
import { AddMenu } from "./step-list-controls";
import { eyebrow, productPrimary, propertySeg, propertySegBtn, propertySegBtnOn } from "../lib/ui";

const chromePanel =
  "relative z-[2] flex min-h-0 min-w-0 flex-col bg-[color-mix(in_srgb,var(--v2-background-bg-base)_96%,var(--v2-background-bg-deep))]";

const walkStepBtn = cn(
  "grid size-6 shrink-0 place-items-center rounded-md text-[var(--text-weak)] transition-colors duration-150",
  "hover:enabled:bg-[var(--v2-background-bg-layer-01)] hover:enabled:text-[var(--text-strong)]",
  "disabled:cursor-not-allowed disabled:opacity-35",
);

const statusDot = (status: string) =>
  cn(
    "size-1.5 rounded-full",
    status === "ok" || status === "healed" || status === "pass"
      ? "bg-[var(--icon-success-base)]"
      : status === "error" || status === "cancelled" || status === "fail"
        ? "bg-[var(--icon-critical-base)]"
        : status === "running"
          ? "bg-[var(--v2-background-bg-accent)] shadow-[0_0_10px_var(--v2-background-bg-accent)]"
          : "bg-[var(--text-weak)]",
  );

type TargetStep = Extract<
  RecipeStep,
  { kind: "tap" | "wait-for" | "wait-response" | "expect" | "extract" }
>;

function hasEditableTarget(step: RecipeStep): step is TargetStep {
  return (
    step.kind === "tap" ||
    step.kind === "wait-for" ||
    step.kind === "wait-response" ||
    step.kind === "expect" ||
    step.kind === "extract"
  );
}

function targetText(target: StepTarget): string {
  return target.label ?? target.text ?? target.ref ?? "";
}

function patchReadableTarget(target: StepTarget, value: string): StepTarget {
  const key: "label" | "text" | "ref" = target.label
    ? "label"
    : target.text
      ? "text"
      : target.ref
        ? "ref"
        : "label";
  return { ...target, [key]: value };
}

function editableTarget(step: RecipeStep): StepTarget | undefined {
  return hasEditableTarget(step) ? step.target : undefined;
}

type TargetChoice = {
  strategy: Strategy;
  title: string;
  value: string;
  target: StepTarget;
};

function targetValue(strategy: Strategy, target: StepTarget): string {
  if (strategy === "label") return `“${target.label ?? ""}”`;
  if (strategy === "text") return `“${target.text ?? ""}”`;
  if (strategy === "ref") return target.ref ?? "";
  return fmtPoint(target.point);
}

function targetMatches(strategy: Strategy, target: StepTarget, candidate: StepTarget): boolean {
  if (defaultStrategy(target) !== strategy) return false;
  if (strategy === "label") return target.label === candidate.label;
  if (strategy === "text") return target.text === candidate.text;
  if (strategy === "ref") return target.ref === candidate.ref;
  return target.point?.x === candidate.point?.x && target.point?.y === candidate.point?.y;
}

function choicesForTargetStep(
  step: TargetStep,
  node: RecordedNodeEvidence | undefined,
): TargetChoice[] {
  const title: Record<Exclude<Strategy, "point">, string> = {
    label: "Accessibility label",
    text: "Visible text",
    ref: "UI element",
  };
  const fallbackPoint = step.target.point ?? (node ? pointForAnchor(node, "center") : undefined);
  const choices: TargetChoice[] = [];
  const push = (strategy: Exclude<Strategy, "point">, target: StepTarget) => {
    if (!targetValue(strategy, target)) return;
    choices.push({
      strategy,
      title: title[strategy],
      value: targetValue(strategy, target),
      target,
    });
  };

  if (node) {
    const label = (node.label ?? node.value ?? "").trim();
    const text = (node.value ?? "").trim();
    if (label) push("label", { label, ...(fallbackPoint ? { point: fallbackPoint } : {}) });
    if (text && text !== label)
      push("text", { text, ...(fallbackPoint ? { point: fallbackPoint } : {}) });
    if (node.ref)
      push("ref", { ref: node.ref, ...(fallbackPoint ? { point: fallbackPoint } : {}) });
  } else {
    if (step.target.label) push("label", { ...step.target });
    if (step.target.text) push("text", { ...step.target });
    if (step.target.ref) push("ref", { ...step.target });
  }

  return choices;
}

function elementName(node: RecordedNodeEvidence | undefined): string {
  const human = (node?.label ?? node?.value ?? node?.identifier ?? "").trim();
  if (human) return human;
  const technical = node?.role ?? node?.type ?? "";
  return technical.split(/[.$]/).filter(Boolean).at(-1) ?? "Element";
}

function simpleField(step: RecipeStep): {
  label: string;
  value: string | number;
  number?: boolean;
} {
  if (step.kind === "type") return { label: "Text", value: step.text };
  if (step.kind === "sleep") return { label: "Seconds", value: step.ms / 1_000, number: true };
  if (step.kind === "screenshot") return { label: "Caption", value: step.caption ?? "" };
  if (step.kind === "pause") return { label: "Message", value: step.message };
  if (step.kind === "assert-content") return { label: "Expected", value: step.expected };
  return { label: "Note", value: step.note ?? "" };
}

function usesCompactInspector(step: RecipeStep): boolean {
  return [
    "tap",
    "type",
    "expect",
    "wait-for",
    "sleep",
    "screenshot",
    "pause",
    "assert-content",
  ].includes(step.kind);
}

export function JourneyOutline(props: { compact?: boolean } = {}) {
  const server = useServer();
  const draft = useRecipeDraft();
  const workbench = useWorkbench();
  const active = () => workbench.focusedIndex() ?? 0;
  const [addAnchor, setAddAnchor] = createSignal<
    { left: number; top: number; bottom: number; width: number } | undefined
  >();
  let addButton: HTMLButtonElement | undefined;
  let stepList: HTMLElement | undefined;
  let previousActive = active();

  createEffect(() => {
    const current = active();
    if (current === previousActive) return;
    previousActive = current;

    queueMicrotask(() => {
      const container = stepList;
      const row = container?.querySelector<HTMLElement>(`[data-step-row="${current}"]`);
      if (!container || !row) return;

      const top = row.offsetTop - container.offsetTop;
      const bottom = top + row.offsetHeight;
      const visibleTop = container.scrollTop;
      const visibleBottom = visibleTop + container.clientHeight;
      if (top >= visibleTop && bottom <= visibleBottom) return;

      container.scrollTo({
        top: top < visibleTop ? top : bottom - container.clientHeight,
        behavior: "smooth",
      });
    });
  });

  const appendStep = (step: RecipeStep) => {
    const index = draft.steps().length;
    draft.insertStep(index, step);
    workbench.focusStep(index);
    setAddAnchor(undefined);
  };

  return (
    <aside
      class={cn(chromePanel, "border-r border-[var(--v2-border-border-muted)] max-[900px]:!hidden")}
      aria-label="Journey actions"
    >
      <header class="border-b border-[var(--v2-border-border-muted)] px-[15px] pt-[17px] pb-[15px]">
        <Show
          when={props.compact}
          fallback={
            <>
              <span class={eyebrow}>Journey</span>
              <h2 class="mt-1.5 overflow-hidden text-[18px] font-semibold tracking-[-0.025em] text-ellipsis whitespace-nowrap text-[var(--text-strong)]">
                {draft.title()}
              </h2>
              <Show when={draft.description()}>
                <p class="mt-1.5 mb-[15px] line-clamp-2 text-[12px]/[1.5] text-[var(--text-weak)]">
                  {draft.description()}
                </p>
              </Show>
              <div
                class={cn(
                  "grid grid-cols-[repeat(auto-fit,minmax(8px,1fr))] gap-1",
                  !draft.description() && "mt-[15px]",
                )}
                aria-label={`Action ${active() + 1} of ${draft.steps().length}`}
              >
                <For each={draft.steps()}>
                  {(_, index) => (
                    <i
                      class={cn(
                        "h-0.5 rounded-full bg-[var(--v2-border-border-strong)]",
                        index() <= active() && "bg-[var(--v2-background-bg-accent)]",
                      )}
                    />
                  )}
                </For>
              </div>
              <div class="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  class={walkStepBtn}
                  aria-label="Previous action"
                  disabled={active() <= 0}
                  onClick={() => workbench.focusStep(Math.max(0, active() - 1))}
                >
                  <Icon name="chevron-left" size={12} />
                </button>
                <small class="block font-mono text-[10.5px]/[1.2] tabular-nums text-[var(--text-weak)]">
                  Action {Math.min(active() + 1, draft.steps().length)} of {draft.steps().length}
                </small>
                <button
                  type="button"
                  class={walkStepBtn}
                  aria-label="Next action"
                  disabled={active() >= draft.steps().length - 1}
                  onClick={() =>
                    workbench.focusStep(Math.min(draft.steps().length - 1, active() + 1))
                  }
                >
                  <Icon name="chevron-right" size={12} />
                </button>
              </div>
            </>
          }
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <span class={eyebrow}>Journey</span>
              <strong class="mt-1 block truncate text-[14px] font-semibold tracking-[-0.015em] text-[var(--text-strong)]">
                {draft.title() || "Untitled journey"}
              </strong>
            </div>
            <span class="shrink-0 pt-0.5 font-mono text-[10.5px] tabular-nums text-[var(--text-weak)]">
              {draft.steps().length} actions
            </span>
          </div>
          <Show when={draft.description()}>
            <p class="mt-1.5 line-clamp-1 text-[12px] text-[var(--text-base)]">
              {draft.description()}
            </p>
          </Show>
        </Show>
      </header>
      <nav
        ref={(element) => {
          stepList = element;
        }}
        class="min-h-0 flex-1 overflow-y-auto p-2"
      >
        <For each={draft.steps()}>
          {(step, index) => {
            const annotation = () => workbench.rowAnno(index());
            const isActive = () => active() === index();
            const nestedCount = () => {
              const id =
                step.kind === "module" ? step.recipeId : step.kind === "flow" ? step.flow : null;
              return id
                ? (server.recipes().find((recipe) => recipe.id === id)?.steps.length ?? 0)
                : 0;
            };
            return (
              <button
                type="button"
                data-step-row={index()}
                class={cn(
                  "relative grid min-h-[56px] w-full grid-cols-[32px_minmax(0,1fr)_7px] items-center gap-2.5 rounded-[10px] border border-transparent px-2.5 py-2 text-left text-[var(--text-weak)] transition-colors duration-150",
                  "hover:bg-[var(--v2-background-bg-layer-01)] hover:text-[var(--text-base)]",
                  isActive() &&
                    "border-[rgb(139_114_255/30%)] bg-[rgb(116_92_242/13%)] text-[var(--text-strong)] hover:bg-[rgb(116_92_242/13%)] hover:text-[var(--text-strong)]",
                )}
                onClick={() => workbench.focusStep(index())}
              >
                <span
                  class="grid size-8 place-items-center rounded-[9px] border border-[color-mix(in_srgb,var(--journey-node-accent)_28%,var(--v2-border-border-muted))] bg-[color-mix(in_srgb,var(--journey-node-accent)_11%,var(--v2-background-bg-layer-01))] text-[color-mix(in_srgb,var(--journey-node-accent)_75%,white)]"
                  style={{ "--journey-node-accent": accentForStep(step) }}
                >
                  <Icon name={iconForStep(step)} size={15} />
                </span>
                <span class="min-w-0">
                  <small class="mb-1 flex items-center gap-1.5 font-mono text-[10px]/[1.2] tracking-[0.08em] text-[var(--text-weak)] uppercase">
                    <span>{String(index() + 1).padStart(2, "0")}</span>
                    <Show when={nestedCount() > 0}>
                      <span aria-hidden="true">·</span>
                      <span>
                        {nestedCount()} action{nestedCount() === 1 ? "" : "s"}
                      </span>
                    </Show>
                  </small>
                  <strong class="block overflow-hidden text-[13px] font-medium leading-[1.35] text-ellipsis whitespace-nowrap text-inherit">
                    {sentenceForStep(step, server.recipes())}
                  </strong>
                </span>
                <Show when={annotation().status !== "idle"}>
                  <i class={statusDot(annotation().status)} />
                </Show>
              </button>
            );
          }}
        </For>
      </nav>
      <Show when={props.compact}>
        <footer class="relative shrink-0 border-t border-[var(--v2-border-border-muted)] p-2.5">
          <div class="flex h-8 items-center justify-between px-0.5">
            <button
              type="button"
              class={walkStepBtn}
              aria-label="Previous action"
              disabled={draft.steps().length === 0 || active() <= 0}
              onClick={() => workbench.focusStep(Math.max(0, active() - 1))}
            >
              <Icon name="chevron-left" size={12} />
            </button>
            <span
              class="font-mono text-[10.5px] tabular-nums text-[var(--text-weak)]"
              aria-live="polite"
            >
              {draft.steps().length
                ? `Action ${active() + 1} of ${draft.steps().length}`
                : "No actions"}
            </span>
            <button
              type="button"
              class={walkStepBtn}
              aria-label="Next action"
              disabled={draft.steps().length === 0 || active() >= draft.steps().length - 1}
              onClick={() => workbench.focusStep(Math.min(draft.steps().length - 1, active() + 1))}
            >
              <Icon name="chevron-right" size={12} />
            </button>
          </div>
          <div class="mt-1 border-t border-[var(--v2-border-border-muted)] pt-1">
            <button
              ref={(element) => {
                addButton = element;
              }}
              type="button"
              class="flex min-h-9 w-full items-center justify-center gap-2 rounded-lg text-[12px] font-medium text-[var(--text-base)] transition-[background-color,color,transform] duration-150 ease-out hover:bg-[var(--v2-background-bg-layer-01)] hover:text-[var(--text-strong)] active:scale-[0.98]"
              aria-expanded={Boolean(addAnchor())}
              onClick={() => {
                if (addAnchor()) {
                  setAddAnchor(undefined);
                  return;
                }
                const rect = addButton?.getBoundingClientRect();
                if (!rect) return;
                setAddAnchor({
                  left: rect.left,
                  top: rect.top,
                  bottom: rect.bottom,
                  width: rect.width,
                });
              }}
            >
              <Icon name="plus" size={14} /> Add action
            </button>
          </div>
          <Show when={addAnchor()}>
            {(anchor) => (
              <AddMenu
                anchor={anchor()}
                placement="above"
                onClose={() => setAddAnchor(undefined)}
                onPick={appendStep}
              />
            )}
          </Show>
        </footer>
      </Show>
    </aside>
  );
}

export function JourneyInspector(props: { onOpenTargets: () => void; compact?: boolean }) {
  const server = useServer();
  const draft = useRecipeDraft();
  const workbench = useWorkbench();
  const index = createMemo(() =>
    Math.max(0, Math.min(workbench.focusedIndex() ?? 0, draft.steps().length - 1)),
  );
  const step = createMemo(() => draft.steps()[index()]);
  const holdStep = createMemo(() => {
    const current = step();
    return current && isTapAction(current) && tapGesture(current) === "hold" ? current : undefined;
  });
  const multiTapStep = createMemo(() => {
    const current = step();
    return current && isTapAction(current) && tapGesture(current) === "multi" ? current : undefined;
  });
  const multiTapCount = createMemo(() => {
    const current = multiTapStep();
    return current?.kind === "tap" ? (current.tapCount ?? 2) : 2;
  });
  const multiTapInterval = createMemo(() => {
    const current = multiTapStep();
    return current?.kind === "tap" ? (current.intervalMs ?? 100) : 100;
  });
  const tapEvidence = createMemo(() => {
    const current = step();
    return current && isTapAction(current) ? current.evidence : undefined;
  });
  const hierarchy = createMemo(() => targetHierarchy(tapEvidence()));
  const [targetDepth, setTargetDepth] = createSignal(0);
  createEffect(() => {
    const current = step();
    setTargetDepth(
      current && isTapAction(current) ? targetNodeIndex(current.evidence, current.target) : 0,
    );
  });
  const previewNode = createMemo(() => {
    const nodes = hierarchy();
    return nodes[Math.max(0, Math.min(targetDepth(), nodes.length - 1))];
  });
  const [horizontalConstraint, setHorizontalConstraint] =
    createSignal<HorizontalConstraint>("left");
  const [verticalConstraint, setVerticalConstraint] = createSignal<VerticalConstraint>("top");
  const [stepMenuOpen, setStepMenuOpen] = createSignal(false);
  let stepMenuRoot: HTMLDivElement | undefined;
  createEffect(() => {
    if (!stepMenuOpen()) return;
    const close = (event: PointerEvent) => {
      if (!stepMenuRoot?.contains(event.target as Node)) setStepMenuOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    onCleanup(() => window.removeEventListener("pointerdown", close, true));
  });
  const constraintPoint = createMemo(() => {
    const current = step();
    if (!current || !isTapAction(current)) return undefined;
    const bounds =
      current.evidence?.deviceBounds ??
      current.target.point?.referenceBounds ??
      server.snapshot()?.bounds ??
      FALLBACK_DEVICE_BOUNDS;
    if (current.target.point) {
      return {
        ...current.target.point,
        ...(!current.target.point.referenceBounds ? { referenceBounds: { ...bounds } } : {}),
      };
    }
    const fallback = current.evidence?.pointer ??
      (previewNode() ? pointForAnchor(previewNode()!, "center") : undefined) ?? {
        x: Math.round(bounds.width / 2),
        y: Math.round(bounds.height / 2),
      };
    return {
      ...fallback,
      anchor: { horizontal: horizontalConstraint(), vertical: verticalConstraint() },
      referenceBounds: { ...bounds },
    };
  });
  const coordinateBounds = createMemo(
    () =>
      tapEvidence()?.deviceBounds ??
      constraintPoint()?.referenceBounds ??
      server.snapshot()?.bounds ??
      FALLBACK_DEVICE_BOUNDS,
  );
  createEffect(() => {
    const current = step();
    const point = current && isTapAction(current) ? current.target.point : undefined;
    const anchor = coordinateAnchor(point);
    setHorizontalConstraint(anchor.horizontal);
    setVerticalConstraint(anchor.vertical);
  });
  const sentence = createMemo(() => {
    const current = step();
    return current ? sentenceForStep(current, server.recipes()) : "No state selected";
  });
  const capturedFrame = createMemo(() => {
    const shot = evidenceForStep(draft.steps()[index()])?.screenshot;
    return shot ? server.recordingEvidenceUrl(shot.recipeId, shot.id) : "";
  });
  const canPreview = createMemo(() => Boolean(capturedFrame()));
  const annotation = createMemo(() => workbench.rowAnno(index()));
  const recentRuns = createMemo(() => {
    const recipe = server.selectedRecipe();
    if (!recipe) return [];
    const live = server
      .jobs()
      .filter((job) => job.action === recipe.id)
      .map((job) => ({
        id: job.id,
        status: job.status,
        at: job.finishedAt ?? job.startedAt ?? job.queuedAt,
        duration: job.startedAt ? fmtDur(job) : "—",
      }));
    const liveIds = new Set(live.map((run) => run.id));
    const disk = server
      .persistedRuns()
      .filter((run) => run.action === recipe.id && !liveIds.has(run.id))
      .map((run) => ({
        id: run.id,
        status: run.status,
        at: run.finishedAt ?? run.startedAt ?? run.writtenAt,
        duration: run.durationMs
          ? run.durationMs < 1_000
            ? `${Math.round(run.durationMs)}ms`
            : `${(run.durationMs / 1_000).toFixed(1)}s`
          : "—",
      }));
    return [...live, ...disk].sort((a, b) => b.at - a.at).slice(0, 3);
  });
  const runBlockedReason = () => {
    const current = step();
    if (workbench.running()) return "Another step is already running";
    return testRunBlocker({
      health: server.health(),
      selectedDevice: server.selectedDevice(),
      devices: server.devices(),
      stepCount: current ? 1 : 0,
      invalidCount: current && stepValid(current) ? 0 : 1,
    });
  };
  const runSelected = () => {
    const blocker = runBlockedReason();
    if (blocker) {
      toast(blocker, "warning");
      if (!server.selectedDevice() || server.isEmptyDevices()) props.onOpenTargets();
      return;
    }
    void workbench.runFrom(index(), { continue: false });
  };

  function updateTarget(value: string): void {
    const current = step();
    if (!current || !hasEditableTarget(current)) return;
    draft.updateStep(index(), {
      ...current,
      target: patchReadableTarget(current.target, value),
    } as RecipeStep);
  }

  function chooseTarget(target: StepTarget): void {
    const current = step();
    if (!current || !hasEditableTarget(current)) return;
    draft.updateStep(index(), { ...current, target } as RecipeStep);
  }

  function chooseConstraints(
    horizontal = horizontalConstraint(),
    vertical = verticalConstraint(),
  ): void {
    const point = constraintPoint();
    if (!point) return;
    chooseTarget({
      point: anchoredPoint(point, horizontal, vertical, coordinateBounds()),
    });
  }

  function updateCoordinatePoint(value: { x: number; y: number }): void {
    const point = constraintPoint();
    if (!point) return;
    chooseTarget({
      point: anchoredPoint(
        { ...point, ...value },
        horizontalConstraint(),
        verticalConstraint(),
        coordinateBounds(),
      ),
    });
  }

  function selectElementDepth(nextDepth: number): void {
    const current = step();
    const nodes = hierarchy();
    if (!current || !isTapAction(current) || nodes.length === 0) return;
    const depth = Math.max(0, Math.min(nextDepth, nodes.length - 1));
    const node = nodes[depth];
    if (!node) return;
    setTargetDepth(depth);
    if (defaultStrategy(current.target) === "point") {
      return;
    }
    const currentStrategy = defaultStrategy(current.target);
    const choices = choicesForTargetStep(current, node);
    const next = choices.find((choice) => choice.strategy === currentStrategy) ?? choices[0];
    if (next) chooseTarget(next.target);
  }

  const targetChoices = createMemo(() => {
    const current = step();
    return current && hasEditableTarget(current)
      ? choicesForTargetStep(current, previewNode())
      : [];
  });

  function updateSimpleValue(value: string): void {
    const current = step();
    if (!current) return;
    if (current.kind === "type") draft.updateStep(index(), { ...current, text: value });
    else if (current.kind === "screenshot")
      draft.updateStep(index(), { ...current, caption: value || undefined });
    else if (current.kind === "sleep")
      draft.updateStep(index(), { ...current, ms: Math.max(0, Number(value) * 1_000) });
    else if (current.kind === "pause") draft.updateStep(index(), { ...current, message: value });
    else if (current.kind === "assert-content")
      draft.updateStep(index(), { ...current, expected: value });
    else draft.updateStep(index(), { ...current, note: value || undefined } as RecipeStep);
  }

  function changeAction(kind: EditableActionKind): void {
    const current = step();
    if (!current) return;
    draft.updateStep(index(), convertStepAction(current, kind));
  }

  function duplicateSelectedStep(): void {
    const currentIndex = index();
    draft.duplicateStep(currentIndex);
    workbench.focusStep(currentIndex + 1);
    setStepMenuOpen(false);
  }

  function deleteSelectedStep(): void {
    const currentIndex = index();
    const remaining = draft.steps().length - 1;
    draft.removeStep(currentIndex);
    workbench.focusStep(remaining > 0 ? Math.min(currentIndex, remaining - 1) : null);
    setStepMenuOpen(false);
  }

  function changeTapGesture(gesture: TapGesture): void {
    const current = step();
    if (!current || !isTapAction(current)) return;
    draft.updateStep(index(), convertTapGesture(current, gesture));
  }

  function updateHoldDuration(value: string): void {
    const current = step();
    if (!current || !isTapAction(current) || tapGesture(current) !== "hold") return;
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return;
    const held = convertTapGesture(current, "hold");
    draft.updateStep(index(), {
      ...held,
      durationMs: Math.min(10_000, Math.max(100, Math.round(seconds * 1_000))),
    });
  }

  function updateMultiTapCount(value: string): void {
    const current = step();
    if (!current || !isTapAction(current) || tapGesture(current) !== "multi") return;
    const count = Number(value);
    if (!Number.isFinite(count)) return;
    draft.updateStep(index(), {
      ...convertTapGesture(current, "multi"),
      tapCount: Math.min(10, Math.max(2, Math.round(count))),
    });
  }

  function updateMultiTapInterval(value: string): void {
    const current = step();
    if (!current || !isTapAction(current) || tapGesture(current) !== "multi") return;
    const intervalMs = Number(value);
    if (!Number.isFinite(intervalMs)) return;
    draft.updateStep(index(), {
      ...convertTapGesture(current, "multi"),
      intervalMs: Math.min(2_000, Math.max(20, Math.round(intervalMs))),
    });
  }

  const navBtn =
    "grid size-8 place-items-center rounded-lg border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] text-[var(--text-base)] hover:enabled:bg-[var(--v2-background-bg-layer-02)] hover:enabled:text-[var(--text-strong)] disabled:opacity-35";

  return (
    <aside
      class={cn(
        chromePanel,
        "border-l border-[var(--v2-border-border-muted)] max-[900px]:absolute max-[900px]:right-0 max-[900px]:bottom-0 max-[900px]:z-[6] max-[900px]:flex max-[900px]:h-[calc(100%-104px)] max-[900px]:w-[min(340px,calc(100vw-64px))] max-[900px]:shadow-[-20px_0_50px_rgb(0_0_0/35%)]",
      )}
      aria-label="Selected journey action"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        const editingText = target.matches("input, textarea, select, [contenteditable='true']");
        if (event.key !== "Backspace" && event.key !== "Delete") return;
        if (editingText) return;
        event.preventDefault();
        deleteSelectedStep();
      }}
    >
      <header class="flex min-h-12 shrink-0 items-center justify-between gap-2.5 border-b border-[var(--v2-border-border-muted)] px-[15px]">
        <span class="font-mono text-[10.5px] font-medium tracking-[0.04em] text-[var(--text-weak)] uppercase">
          Action {String(index() + 1).padStart(2, "0")}
        </span>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10.5px] font-medium text-[var(--text-base)] transition-[background-color,color,transform] duration-150 ease-out hover:enabled:bg-[var(--v2-background-bg-layer-02)] hover:enabled:text-[var(--text-strong)] active:enabled:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35"
            aria-label={`Preview action ${index() + 1} on its recorded screen`}
            data-tip={
              canPreview()
                ? "Preview on the recorded screen — does not touch the device"
                : "Record or run this step to add a screen preview"
            }
            disabled={!canPreview()}
            onClick={() => workbench.previewStep(index())}
          >
            <Icon name="play" size={11} /> Preview
          </button>
          <button
            type="button"
            class={cn(productPrimary, "h-7 !min-h-7 shrink-0 px-2.5 text-[10.5px]")}
            aria-label={`Run action ${index() + 1}`}
            disabled={workbench.running()}
            onClick={runSelected}
          >
            <Icon name="play" size={11} />
            {annotation().status === "running" ? "Running" : "Run"}
          </button>
          <div
            ref={(element) => (stepMenuRoot = element)}
            class="relative"
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !stepMenuOpen()) return;
              event.preventDefault();
              event.stopPropagation();
              setStepMenuOpen(false);
            }}
          >
            <button
              type="button"
              class="grid size-7 place-items-center rounded-md text-[var(--text-weak)] transition-[background-color,color,transform] duration-150 ease-out hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] active:scale-[0.96]"
              aria-label="Action options"
              aria-haspopup="menu"
              aria-expanded={stepMenuOpen()}
              onClick={() => setStepMenuOpen((open) => !open)}
            >
              <Icon name="more" size={14} />
            </button>
            <Show when={stepMenuOpen()}>
              <div
                class="ui-pop absolute top-[calc(100%+4px)] right-0 z-30 grid min-w-[174px] gap-0.5 rounded-lg border border-[var(--v2-border-border-strong)] bg-surface-raised-stronger-non-alpha p-1 shadow-[var(--v2-elevation-overlay)]"
                role="menu"
                aria-label="Action options"
              >
                <button
                  type="button"
                  role="menuitem"
                  class="grid h-8 grid-cols-[20px_minmax(0,1fr)] items-center gap-2 rounded-md px-2 text-left text-[10.5px] font-medium text-[var(--text-base)] transition-colors duration-100 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                  onClick={duplicateSelectedStep}
                >
                  <Icon name="copy" size={12} />
                  Duplicate action
                </button>
                <div class="mx-2 h-px bg-[var(--v2-border-border-muted)]" />
                <button
                  type="button"
                  role="menuitem"
                  class="grid h-8 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-left text-[10.5px] font-medium text-[var(--icon-critical-base)] transition-colors duration-100 hover:bg-[color-mix(in_srgb,var(--icon-critical-base)_10%,transparent)]"
                  onClick={deleteSelectedStep}
                >
                  <Icon name="trash" size={12} />
                  <span>Delete action</span>
                  <kbd class="font-mono text-[9px] font-normal opacity-65">⌫</kbd>
                </button>
              </div>
            </Show>
          </div>
        </div>
      </header>
      <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <Show when={!props.compact}>
          <Show
            when={capturedFrame()}
            fallback={
              <section class="grid grid-cols-[42px_minmax(0,1fr)] gap-3 border-b border-[var(--v2-border-border-muted)] bg-[radial-gradient(circle_at_20%_20%,rgb(126_101_255/9%),transparent_38%),var(--v2-background-bg-deep)] px-[15px] py-[18px]">
                <Show when={step()}>
                  {(current) => (
                    <span
                      class="grid size-[42px] place-items-center rounded-[11px] border border-[color-mix(in_srgb,var(--journey-node-accent)_32%,var(--v2-border-border-muted))] bg-[color-mix(in_srgb,var(--journey-node-accent)_12%,var(--v2-background-bg-layer-01))] text-[color-mix(in_srgb,var(--journey-node-accent)_80%,white)]"
                      style={{ "--journey-node-accent": accentForStep(current()) }}
                    >
                      <Icon name={iconForStep(current())} size={22} />
                    </span>
                  )}
                </Show>
                <div class="min-w-0">
                  <small class="block text-[10.5px] tracking-[0.08em] text-[var(--text-weak)] uppercase">
                    {step() ? actionForStep(step()!) : "Planned action"}
                  </small>
                  <strong class="mt-1 block text-[15px]/[1.35] font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
                    {sentence()}
                  </strong>
                  <p class="mt-1.5 text-[12px]/[1.55] text-[var(--text-weak)]">
                    Run once to add the device screenshot and result.
                  </p>
                </div>
              </section>
            }
          >
            {(src) => (
              <div class="grid h-80 min-h-80 place-items-center overflow-hidden bg-[radial-gradient(circle_at_50%_35%,rgb(126_101_255/12%),transparent_48%),radial-gradient(circle_at_1px_1px,rgb(255_255_255/5%)_1px,transparent_0)] bg-size-[auto,18px_18px] px-7 py-[22px] max-[1380px]:min-[901px]:p-[18px]">
                <img
                  src={src()}
                  alt={`Captured step ${index() + 1}`}
                  class="block h-auto max-h-full w-auto max-w-full rounded-[26px] border-[5px] border-[var(--v2-background-bg-layer-02)] object-contain shadow-[0_24px_70px_rgb(0_0_0/38%),0_0_0_1px_rgb(255_255_255/5%)]"
                />
              </div>
            )}
          </Show>
        </Show>
        <Show when={step()}>
          {(current) => (
            <section
              class={cn(
                "px-[15px] py-3",
                !props.compact && "border-t border-[var(--v2-border-border-muted)]",
              )}
            >
              <header class="mb-1.5 grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
                <span class="text-[11px] text-[var(--text-base)]">Action</span>
                <div class="flex h-8 min-w-0 items-center rounded-md border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)]">
                  <ActionPicker
                    step={current()}
                    onSelect={changeAction}
                    onOpen={() => setStepMenuOpen(false)}
                  />
                </div>
              </header>
              <Show when={isTapAction(current())}>
                <div class="mb-2.5 grid grid-cols-[64px_minmax(0,1fr)] items-start gap-2">
                  <span class="pt-2 text-[11px] text-[var(--text-base)]">Gesture</span>
                  <div class="grid gap-1.5">
                    <div class={propertySeg} role="radiogroup" aria-label="Tap gesture">
                      <For
                        each={
                          [
                            ["single", "Single"],
                            ["multi", "Multi"],
                            ["hold", "Hold"],
                          ] as const
                        }
                      >
                        {([value, label]) => {
                          const selected = () => tapGesture(current()) === value;
                          return (
                            <button
                              type="button"
                              role="radio"
                              aria-checked={selected()}
                              class={selected() ? propertySegBtnOn : propertySegBtn}
                              onClick={() => changeTapGesture(value)}
                            >
                              {label}
                            </button>
                          );
                        }}
                      </For>
                    </div>
                    <Show when={multiTapStep()}>
                      {(_) => (
                        <div class="grid h-8 grid-cols-2 divide-x divide-[var(--v2-border-border-muted)] rounded-lg ring-1 ring-inset ring-[var(--v2-border-border-muted)]">
                          <label class="flex min-w-0 items-center justify-between gap-2 px-2.5">
                            <span class="text-[10.5px] text-[var(--text-base)]">Taps</span>
                            <input
                              type="number"
                              min="2"
                              max="10"
                              step="1"
                              class="w-7 bg-transparent text-right font-mono text-[10.5px] text-[var(--text-strong)] outline-none"
                              value={multiTapCount()}
                              onInput={(event) => updateMultiTapCount(event.currentTarget.value)}
                            />
                          </label>
                          <label class="flex min-w-0 items-center justify-between gap-1 px-2.5">
                            <span class="text-[10.5px] text-[var(--text-base)]">Interval</span>
                            <span class="flex items-center gap-1 font-mono text-[10.5px] text-[var(--text-weak)]">
                              <input
                                type="number"
                                min="20"
                                max="2000"
                                step="10"
                                class="w-9 bg-transparent text-right text-[var(--text-strong)] outline-none"
                                value={multiTapInterval()}
                                onInput={(event) =>
                                  updateMultiTapInterval(event.currentTarget.value)
                                }
                              />
                              ms
                            </span>
                          </label>
                        </div>
                      )}
                    </Show>
                    <Show when={holdStep()}>
                      {(held) => (
                        <label class="flex h-8 items-center justify-between gap-3 rounded-lg px-2.5 ring-1 ring-inset ring-[var(--v2-border-border-muted)]">
                          <span class="text-[10.5px] text-[var(--text-base)]">Hold duration</span>
                          <span class="flex items-center gap-1 font-mono text-[10.5px] text-[var(--text-weak)]">
                            <input
                              type="number"
                              min="0.1"
                              max="10"
                              step="0.1"
                              class="w-10 bg-transparent text-right text-[var(--text-strong)] outline-none"
                              value={(held().durationMs ?? 700) / 1_000}
                              onInput={(event) => updateHoldDuration(event.currentTarget.value)}
                            />
                            s
                          </span>
                        </label>
                      )}
                    </Show>
                  </div>
                </div>
              </Show>
              <Show
                when={usesCompactInspector(current())}
                fallback={
                  <div>
                    <StepEditor
                      step={() => step()!}
                      index={index()}
                      autofocus={() => false}
                      onAutofocused={() => undefined}
                      onChange={(next) => draft.updateStep(index(), next)}
                      showEvidence={false}
                      embedded
                    />
                  </div>
                }
              >
                <Show
                  when={editableTarget(current())}
                  fallback={
                    <label class="grid gap-1.5">
                      <span class="text-[10.5px] text-[var(--text-weak)]">
                        {simpleField(current()).label}
                      </span>
                      <input
                        class="h-9 w-full rounded-lg border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[12px] text-[var(--text-strong)] outline-none transition-colors focus:border-[var(--text-interactive-base)]"
                        type={simpleField(current()).number ? "number" : "text"}
                        min={simpleField(current()).number ? 0 : undefined}
                        step={simpleField(current()).number ? 0.5 : undefined}
                        value={simpleField(current()).value}
                        placeholder="Optional"
                        onInput={(event) => updateSimpleValue(event.currentTarget.value)}
                      />
                    </label>
                  }
                >
                  {(target) => (
                    <Show
                      when={
                        isTapAction(current()) &&
                        (targetChoices().length > 0 || Boolean(constraintPoint()))
                      }
                      fallback={
                        <label class="grid gap-1.5">
                          <span class="text-[10.5px] text-[var(--text-weak)]">Target</span>
                          <input
                            class="h-9 w-full rounded-lg border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] px-3 text-[12px] text-[var(--text-strong)] outline-none transition-colors focus:border-[var(--text-interactive-base)]"
                            value={targetText(target())}
                            placeholder="What should Relay find?"
                            onInput={(event) => updateTarget(event.currentTarget.value)}
                          />
                          <small class="text-[10px]/[1.45] text-[var(--text-weak)]">
                            Use the words someone can see on the screen.
                          </small>
                        </label>
                      }
                    >
                      <div class="grid gap-2">
                        <Show when={defaultStrategy(target()) !== "point" && previewNode()}>
                          <section class="grid gap-1 border-b border-[var(--v2-border-border-muted)] px-0.5 pb-2">
                            <header class="grid min-h-8 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                              <span class="text-[10px] font-semibold tracking-[0.08em] text-[var(--text-weak)] uppercase">
                                Target scope
                              </span>
                              <span class="flex min-w-0 items-baseline gap-1.5">
                                <strong
                                  class="truncate text-[11px] font-medium text-[var(--text-strong)]"
                                  title={previewNode()?.role ?? previewNode()?.type ?? undefined}
                                >
                                  {elementName(previewNode())}
                                </strong>
                                <code class="shrink-0 font-mono text-[9px] text-[var(--text-weak)]">
                                  {previewNode()?.ref ?? "No reference"}
                                </code>
                              </span>
                              <span class="font-mono text-[9px] tabular-nums text-[var(--text-base)]">
                                {targetDepth() === 0 ? "This element" : `Parent ${targetDepth()}`}
                              </span>
                            </header>
                            <Show when={hierarchy().length > 1}>
                              <div class="grid gap-1 pt-0.5">
                                <MaterialDiscreteSlider
                                  value={targetDepth()}
                                  count={hierarchy().length}
                                  label="Element scope"
                                  valueText={
                                    targetDepth() === 0 ? "This element" : `Parent ${targetDepth()}`
                                  }
                                  onInput={selectElementDepth}
                                />
                                <div class="flex items-center justify-between text-[8.5px] text-[var(--text-weak)]">
                                  <span>Element</span>
                                  <span>Parent</span>
                                </div>
                              </div>
                            </Show>
                          </section>
                        </Show>
                        <div class="grid gap-1" role="radiogroup" aria-label="Tap target method">
                          <For each={targetChoices()}>
                            {(choice) => {
                              const selected = () =>
                                targetMatches(choice.strategy, target(), choice.target);
                              return (
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={selected()}
                                  class={cn(
                                    "group grid min-h-10 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.985]",
                                    selected()
                                      ? "border-[color-mix(in_srgb,var(--v2-background-bg-accent)_58%,transparent)] bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_11%,var(--v2-background-bg-layer-01))]"
                                      : "border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] hover:border-[var(--v2-border-border-strong)] hover:bg-[var(--v2-background-bg-layer-02)]",
                                  )}
                                  onClick={() => chooseTarget(choice.target)}
                                >
                                  <span
                                    class={cn(
                                      "grid size-3.5 place-items-center rounded-full border",
                                      selected()
                                        ? "border-[var(--v2-background-bg-accent)]"
                                        : "border-[var(--v2-border-border-strong)]",
                                    )}
                                    aria-hidden="true"
                                  >
                                    <i
                                      class={cn(
                                        "size-1.5 rounded-full",
                                        selected() && "bg-[var(--v2-background-bg-accent)]",
                                      )}
                                    />
                                  </span>
                                  <strong class="truncate text-[11px] font-medium text-[var(--text-strong)]">
                                    {choice.title}
                                  </strong>
                                  <code class="max-w-[92px] truncate font-mono text-[9.5px] text-[var(--text-base)]">
                                    {choice.strategy === "ref"
                                      ? targetDepth() === 0
                                        ? "This element"
                                        : `Parent ${targetDepth()}`
                                      : choice.value}
                                  </code>
                                </button>
                              );
                            }}
                          </For>
                          <Show when={constraintPoint()}>
                            {(point) => (
                              <CoordinateConstraintPicker
                                horizontal={horizontalConstraint()}
                                vertical={verticalConstraint()}
                                point={
                                  defaultStrategy(target()) === "point" && target().point
                                    ? target().point!
                                    : point()
                                }
                                active={defaultStrategy(target()) === "point"}
                                onConstraint={({ horizontal, vertical }) => {
                                  setHorizontalConstraint(horizontal);
                                  setVerticalConstraint(vertical);
                                  chooseConstraints(horizontal, vertical);
                                }}
                                onPoint={updateCoordinatePoint}
                                onActivate={() => chooseConstraints()}
                              />
                            )}
                          </Show>
                        </div>
                      </div>
                    </Show>
                  )}
                </Show>
              </Show>
            </section>
          )}
        </Show>
        <Show
          when={
            annotation().error || annotation().log || (!props.compact && recentRuns().length > 0)
          }
        >
          <section class="border-t border-[var(--v2-border-border-muted)] px-[15px] pt-3.5 pb-[18px]">
            <header class="mb-2 flex items-center justify-between">
              <span class="text-[11px] font-semibold tracking-[0.08em] text-[var(--text-base)] uppercase">
                Activity
              </span>
              <small class="text-[10.5px] text-[var(--text-weak)]">Latest runs</small>
            </header>
            <Show when={annotation().error || annotation().log}>
              <div class="mb-2 grid gap-1 rounded-lg border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-deep)] px-2.5 py-2">
                <span class="text-[9.5px] tracking-[0.08em] text-[var(--text-weak)] uppercase">
                  {annotation().error ? "Error" : "Step log"}
                </span>
                <code
                  class={cn(
                    "line-clamp-3 font-mono text-[10.5px]/[1.5] text-[var(--text-base)]",
                    annotation().error && "text-[var(--icon-critical-base)]",
                  )}
                >
                  {annotation().error ?? annotation().log}
                </code>
              </div>
            </Show>
            <Show when={!props.compact}>
              <For each={recentRuns()}>
                {(job) => (
                  <div class="grid min-h-[48px] grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-[color-mix(in_srgb,var(--v2-border-border-muted)_75%,transparent)]">
                    <i class={statusDot(job.status)} />
                    <span class="min-w-0">
                      <strong class="block text-[12px] font-medium text-[var(--text-base)] capitalize">
                        {job.status === "ok" ? "Passed" : job.status}
                      </strong>
                      <small class="block font-mono text-[10px]/[1.4] text-[var(--text-weak)]">
                        {fmtAgo(job.at)}
                      </small>
                    </span>
                    <b class="font-mono text-[10.5px]/[1.4] font-medium tabular-nums text-[var(--text-weak)]">
                      {job.duration}
                    </b>
                  </div>
                )}
              </For>
            </Show>
          </section>
        </Show>
      </div>
      <footer class="flex min-h-14 shrink-0 items-center border-t border-[var(--v2-border-border-muted)] px-[15px]">
        <div class="flex items-center gap-1">
          <button
            type="button"
            class={navBtn}
            aria-label="Undo step edit"
            data-tip="Undo · ⌘Z"
            disabled={!draft.canUndo()}
            onClick={draft.undo}
          >
            <Icon name="undo" size={14} />
          </button>
          <button
            type="button"
            class={navBtn}
            aria-label="Redo step edit"
            data-tip="Redo · ⇧⌘Z"
            disabled={!draft.canRedo()}
            onClick={draft.redo}
          >
            <Icon name="redo" size={14} />
          </button>
        </div>
      </footer>
    </aside>
  );
}
