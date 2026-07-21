import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js";
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
  TARGET_ANCHORS,
  pointForAnchor,
  recordedNodeName,
  targetHierarchy,
  targetHighlight,
  targetNodeIndex,
  type TargetAnchor,
} from "../lib/target-inspector";
import { frameToSrc } from "../lib/frame-canvas-presentation";
import { fmtAgo, fmtDur } from "../lib/job";
import { testRunBlocker } from "../lib/test-run-readiness";
import { Icon } from "./icon";
import {
  accentForStep,
  actionForStep,
  evidenceForStep,
  iconForStep,
} from "./journey-step-presentation";
import { kindLabel } from "./step-list-metadata";
import { eyebrow, productPrimary, productSecondary } from "../lib/ui";

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
  { kind: "tap" | "long-press" | "wait-for" | "wait-response" | "expect" | "extract" }
>;

function hasEditableTarget(step: RecipeStep): step is TargetStep {
  return (
    step.kind === "tap" ||
    step.kind === "long-press" ||
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
  detail: string;
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
    ref: "Element reference",
  };
  const detail: Record<Exclude<Strategy, "point">, string> = {
    label: "Best across screen changes",
    text: "Matches text containing this value",
    ref: "Exact element from the captured screen",
  };
  const fallbackPoint = (node ? pointForAnchor(node, "center") : undefined) ?? step.target.point;
  const choices: TargetChoice[] = [];
  const push = (strategy: Exclude<Strategy, "point">, target: StepTarget) => {
    if (!targetValue(strategy, target)) return;
    choices.push({
      strategy,
      title: title[strategy],
      value: targetValue(strategy, target),
      detail: detail[strategy],
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

function anchorGridPosition(anchor: TargetAnchor): string {
  if (anchor === "top-left") return "top-0 left-0";
  if (anchor === "top-right") return "top-0 right-0";
  if (anchor === "center") return "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2";
  if (anchor === "bottom-left") return "bottom-0 left-0";
  return "right-0 bottom-0";
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

const QUICK_STEPS: {
  label: string;
  icon: "pointer" | "keyboard" | "check" | "clock" | "camera";
  make: () => RecipeStep;
}[] = [
  { label: "Tap something", icon: "pointer", make: () => ({ kind: "tap", target: {} }) },
  { label: "Type text", icon: "keyboard", make: () => ({ kind: "type", text: "" }) },
  {
    label: "Check something",
    icon: "check",
    make: () => ({ kind: "expect", target: {}, condition: "visible" }),
  },
  { label: "Wait", icon: "clock", make: () => ({ kind: "sleep", ms: 1_000 }) },
  { label: "Take screenshot", icon: "camera", make: () => ({ kind: "screenshot" }) },
];

export function JourneyOutline(props: { compact?: boolean; onAdvancedAdd?: () => void } = {}) {
  const server = useServer();
  const draft = useRecipeDraft();
  const workbench = useWorkbench();
  const active = () => workbench.focusedIndex() ?? 0;
  const [addOpen, setAddOpen] = createSignal(false);

  const appendStep = (step: RecipeStep) => {
    const index = draft.steps().length;
    draft.insertStep(index, step);
    workbench.focusStep(index);
    setAddOpen(false);
  };

  return (
    <aside
      class={cn(chromePanel, "border-r border-[var(--v2-border-border-muted)] max-[900px]:!hidden")}
      aria-label="Test steps"
    >
      <header class="border-b border-[var(--v2-border-border-muted)] px-[15px] pt-[17px] pb-[15px]">
        <Show
          when={props.compact}
          fallback={
            <>
              <span class={eyebrow}>Steps</span>
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
                aria-label={`Step ${active() + 1} of ${draft.steps().length}`}
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
                  aria-label="Previous step"
                  disabled={active() <= 0}
                  onClick={() => workbench.focusStep(Math.max(0, active() - 1))}
                >
                  <Icon name="chevron-left" size={12} />
                </button>
                <small class="block font-mono text-[10.5px]/[1.2] tabular-nums text-[var(--text-weak)]">
                  Step {Math.min(active() + 1, draft.steps().length)} of {draft.steps().length}
                </small>
                <button
                  type="button"
                  class={walkStepBtn}
                  aria-label="Next step"
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
          <div class="flex items-center justify-between gap-3">
            <span class={eyebrow}>Steps</span>
            <span class="font-mono text-[10.5px] tabular-nums text-[var(--text-weak)]">
              {draft.steps().length}
            </span>
          </div>
          <p class="mt-1.5 line-clamp-1 text-[12px] text-[var(--text-base)]">
            {draft.description() || "Actions Relay will perform in order"}
          </p>
        </Show>
      </header>
      <nav class="min-h-0 flex-1 overflow-y-auto p-2">
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
          <button
            type="button"
            class="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg text-[12px] font-medium text-[var(--text-base)] transition-[background-color,color,transform] duration-150 ease-out hover:bg-[var(--v2-background-bg-layer-01)] hover:text-[var(--text-strong)] active:scale-[0.98]"
            aria-expanded={addOpen()}
            onClick={() => setAddOpen((open) => !open)}
          >
            <Icon name="plus" size={14} /> Add step
          </button>
          <Show when={addOpen()}>
            <div
              class="ui-pop absolute right-2.5 bottom-[calc(100%+6px)] left-2.5 z-20 grid gap-0.5 rounded-[10px] border border-[var(--v2-border-border-strong)] bg-surface-raised-stronger-non-alpha p-1 shadow-[var(--v2-elevation-overlay)]"
              role="menu"
              aria-label="Add step"
            >
              <For each={QUICK_STEPS}>
                {(item) => (
                  <button
                    type="button"
                    role="menuitem"
                    class="flex min-h-9 items-center gap-2 rounded-md px-2.5 text-left text-[12px] text-[var(--text-base)] transition-[background-color,color,transform] duration-150 ease-out hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] active:scale-[0.98]"
                    onClick={() => appendStep(item.make())}
                  >
                    <Icon name={item.icon} size={14} /> {item.label}
                  </button>
                )}
              </For>
              <Show when={props.onAdvancedAdd}>
                <button
                  type="button"
                  role="menuitem"
                  class="mt-0.5 flex min-h-9 items-center gap-2 border-t border-[var(--v2-border-border-muted)] px-2.5 pt-1 text-left text-[11px] text-[var(--text-weak)] hover:text-[var(--text-strong)]"
                  onClick={() => {
                    setAddOpen(false);
                    props.onAdvancedAdd?.();
                  }}
                >
                  <Icon name="more" size={14} /> More actions…
                </button>
              </Show>
            </div>
          </Show>
        </footer>
      </Show>
    </aside>
  );
}

export function JourneyInspector(props: {
  onEdit: () => void;
  onOpenTargets: () => void;
  compact?: boolean;
}) {
  const server = useServer();
  const draft = useRecipeDraft();
  const workbench = useWorkbench();
  const index = createMemo(() =>
    Math.max(0, Math.min(workbench.focusedIndex() ?? 0, draft.steps().length - 1)),
  );
  const step = createMemo(() => draft.steps()[index()]);
  const tapEvidence = createMemo(() => {
    const current = step();
    return current?.kind === "tap" ? current.evidence : undefined;
  });
  const hierarchy = createMemo(() => targetHierarchy(tapEvidence()));
  const [targetDepth, setTargetDepth] = createSignal(0);
  createEffect(
    on(index, () => {
      const current = step();
      setTargetDepth(
        current?.kind === "tap" ? targetNodeIndex(current.evidence, current.target) : 0,
      );
    }),
  );
  const previewNode = createMemo(() => {
    const nodes = hierarchy();
    return nodes[Math.max(0, Math.min(targetDepth(), nodes.length - 1))];
  });
  const previewSrc = createMemo(() => {
    const shot = tapEvidence()?.screenshot;
    return shot ? server.recordingEvidenceUrl(shot.recipeId, shot.id) : "";
  });
  const previewHighlight = createMemo(() =>
    targetHighlight(previewNode(), tapEvidence()?.deviceBounds),
  );
  const anchorChoices = createMemo(() =>
    TARGET_ANCHORS.flatMap((anchor) => {
      const point = previewNode() ? pointForAnchor(previewNode()!, anchor.id) : undefined;
      return point ? [{ ...anchor, point }] : [];
    }),
  );
  const sentence = createMemo(() => {
    const current = step();
    return current ? sentenceForStep(current, server.recipes()) : "No state selected";
  });
  const capturedFrame = createMemo(() => {
    const frame = server.frames()[index()];
    if (frame) return frameToSrc(frame);
    const shot = evidenceForStep(draft.steps()[index()])?.screenshot;
    return shot ? server.recordingEvidenceUrl(shot.recipeId, shot.id) : "";
  });
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
  const move = (delta: number) =>
    workbench.focusStep(Math.max(0, Math.min(index() + delta, draft.steps().length - 1)));

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

  const navBtn =
    "grid size-8 place-items-center rounded-lg border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] text-[var(--text-base)] hover:enabled:bg-[var(--v2-background-bg-layer-02)] hover:enabled:text-[var(--text-strong)] disabled:opacity-35";

  return (
    <aside
      class={cn(
        chromePanel,
        "border-l border-[var(--v2-border-border-muted)] max-[900px]:absolute max-[900px]:right-0 max-[900px]:bottom-0 max-[900px]:z-[6] max-[900px]:flex max-[900px]:h-[calc(100%-104px)] max-[900px]:w-[min(340px,calc(100vw-64px))] max-[900px]:shadow-[-20px_0_50px_rgb(0_0_0/35%)]",
      )}
      aria-label="Selected journey step"
    >
      <header class="flex min-h-[67px] shrink-0 items-center justify-between gap-3 border-b border-[var(--v2-border-border-muted)] px-[15px]">
        <div class="min-w-0">
          <span class={eyebrow}>
            Step {index() + 1} of {draft.steps().length}
          </span>
          <strong class="mt-1 block truncate text-[13px] leading-[1.2] font-semibold text-[var(--text-strong)]">
            {sentence()}
          </strong>
        </div>
        <button
          type="button"
          class={cn(productPrimary, "h-8 shrink-0 px-3 text-[11px]")}
          aria-label={`Run step ${index() + 1}`}
          disabled={workbench.running()}
          onClick={runSelected}
        >
          <Icon name="play" size={11} />
          {annotation().status === "running" ? "Running" : "Run step"}
        </button>
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
          <Show when={capturedFrame()}>
            <section class="shrink-0 border-t border-[var(--v2-border-border-muted)] p-[15px]">
              <span class="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-[var(--text-interactive-base)] uppercase">
                <Show when={step()}>
                  {(current) => <Icon name={iconForStep(current())} size={14} />}
                </Show>
                Captured action
              </span>
              <h3 class="mt-2 mb-3.5 text-[15px] leading-[1.4] font-medium tracking-[-0.015em] text-[var(--text-strong)]">
                {sentence()}
              </h3>
              <dl class="m-0 grid grid-cols-2 gap-2">
                <div class="rounded-lg border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] px-2.5 py-2">
                  <dt class="m-0 text-[10.5px] text-[var(--text-weak)]">Evidence</dt>
                  <dd class="mt-1 text-[11px] font-semibold text-[var(--text-base)] capitalize">
                    Captured
                  </dd>
                </div>
                <div class="rounded-lg border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] px-2.5 py-2">
                  <dt class="m-0 text-[10.5px] text-[var(--text-weak)]">Status</dt>
                  <dd
                    class={cn(
                      "mt-1 text-[11px] font-semibold capitalize",
                      annotation().status === "pass" && "text-[var(--icon-success-base)]",
                      annotation().status === "fail" && "text-[var(--icon-critical-base)]",
                      annotation().status === "running" && "text-[var(--text-interactive-base)]",
                      annotation().status === "idle" && "text-[var(--text-base)]",
                    )}
                  >
                    {annotation().status === "idle" ? "Ready" : annotation().status}
                  </dd>
                </div>
              </dl>
            </section>
          </Show>
        </Show>
        <Show when={step()}>
          {(current) => (
            <section class="border-t border-[var(--v2-border-border-muted)] px-[15px] py-[16px]">
              <header class="mb-3 flex items-center justify-between">
                <span class="text-[10.5px] font-semibold tracking-[0.08em] text-[var(--text-base)] uppercase">
                  Properties
                </span>
                <span class="rounded-md bg-[var(--v2-background-bg-layer-01)] px-2 py-1 text-[9.5px] font-medium text-[var(--text-weak)] capitalize">
                  {kindLabel(current().kind)}
                </span>
              </header>
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
                      current().kind === "tap" &&
                      (targetChoices().length > 0 || anchorChoices().length > 0)
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
                      <Show when={previewSrc() && previewNode() && tapEvidence()?.deviceBounds}>
                        <section class="rounded-[10px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] p-2.5">
                          <header class="mb-2 flex items-center justify-between gap-2">
                            <div class="min-w-0">
                              <span class="block text-[10.5px] font-medium text-[var(--text-strong)]">
                                Target preview
                              </span>
                              <small class="mt-0.5 block truncate text-[9.5px] text-[var(--text-weak)]">
                                {targetDepth() === 0
                                  ? "Captured element"
                                  : `Parent ${targetDepth()}`}{" "}
                                · {targetDepth() + 1} of {hierarchy().length}
                              </small>
                            </div>
                            <div class="flex shrink-0 gap-1">
                              <button
                                type="button"
                                class={walkStepBtn}
                                aria-label="Preview child element"
                                data-tip="Child"
                                disabled={targetDepth() <= 0}
                                onClick={() => setTargetDepth((depth) => Math.max(0, depth - 1))}
                              >
                                <Icon name="chevron-down" size={12} />
                              </button>
                              <button
                                type="button"
                                class={walkStepBtn}
                                aria-label="Preview parent element"
                                data-tip="Parent"
                                disabled={targetDepth() >= hierarchy().length - 1}
                                onClick={() =>
                                  setTargetDepth((depth) =>
                                    Math.min(hierarchy().length - 1, depth + 1),
                                  )
                                }
                              >
                                <Icon name="chevron-up" size={12} />
                              </button>
                            </div>
                          </header>
                          <div class="grid grid-cols-[78px_minmax(0,1fr)] items-center gap-3">
                            <div
                              class="relative mx-auto h-[150px] max-w-full overflow-hidden rounded-[9px] bg-[var(--v2-background-bg-deep)] shadow-[inset_0_0_0_1px_var(--v2-border-border-strong)]"
                              style={{
                                "aspect-ratio": `${tapEvidence()!.deviceBounds!.width} / ${tapEvidence()!.deviceBounds!.height}`,
                              }}
                            >
                              <img
                                src={previewSrc()}
                                alt="Captured screen with target bounds"
                                class="absolute inset-0 size-full object-fill"
                              />
                              <Show when={previewHighlight()}>
                                {(highlight) => (
                                  <span
                                    class="pointer-events-none absolute z-[2] rounded-[2px] border-[1.5px] border-[var(--v2-background-bg-accent)] bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_20%,transparent)] shadow-[0_0_0_999px_rgb(4_7_14/48%)]"
                                    style={highlight()}
                                    aria-hidden="true"
                                  />
                                )}
                              </Show>
                              <Show
                                when={
                                  defaultStrategy(target()) === "point" &&
                                  target().point &&
                                  tapEvidence()?.deviceBounds
                                }
                              >
                                <span
                                  class="pointer-events-none absolute z-[3] size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-[var(--v2-background-bg-accent)] shadow-[0_0_0_2px_rgb(5_8_15/45%)]"
                                  style={{
                                    left: `${(target().point!.x / tapEvidence()!.deviceBounds!.width) * 100}%`,
                                    top: `${(target().point!.y / tapEvidence()!.deviceBounds!.height) * 100}%`,
                                  }}
                                  aria-hidden="true"
                                />
                              </Show>
                            </div>
                            <div class="min-w-0">
                              <strong class="block line-clamp-2 text-[11px]/[1.35] font-medium text-[var(--text-strong)]">
                                {recordedNodeName(previewNode())}
                              </strong>
                              <code class="mt-1 block truncate font-mono text-[9px] text-[var(--text-weak)]">
                                {previewNode()?.role ?? previewNode()?.type ?? "Element"}
                                {previewNode()?.ref ? ` · ${previewNode()!.ref}` : ""}
                              </code>
                              <p class="mt-2 text-[9.5px]/[1.45] text-[var(--text-weak)]">
                                Parent and child buttons only change this preview. Choose a method
                                below to update the step.
                              </p>
                            </div>
                          </div>
                        </section>
                      </Show>
                      <div>
                        <span class="block text-[10.5px] text-[var(--text-weak)]">Find by</span>
                        <small class="mt-0.5 block text-[10px]/[1.45] text-[var(--text-weak)]">
                          Choose how Relay should find this tap target.
                        </small>
                      </div>
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
                                  "group grid min-h-[54px] grid-cols-[16px_minmax(0,1fr)] items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.985]",
                                  selected()
                                    ? "border-[color-mix(in_srgb,var(--v2-background-bg-accent)_58%,transparent)] bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_11%,var(--v2-background-bg-layer-01))]"
                                    : "border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] hover:border-[var(--v2-border-border-strong)] hover:bg-[var(--v2-background-bg-layer-02)]",
                                )}
                                onClick={() => chooseTarget(choice.target)}
                              >
                                <span
                                  class={cn(
                                    "mt-0.5 grid size-3.5 place-items-center rounded-full border",
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
                                <span class="min-w-0">
                                  <span class="flex min-w-0 items-baseline justify-between gap-2">
                                    <strong class="text-[11px] font-medium text-[var(--text-strong)]">
                                      {choice.title}
                                    </strong>
                                    <code class="max-w-[54%] truncate font-mono text-[9.5px] text-[var(--text-base)]">
                                      {choice.value}
                                    </code>
                                  </span>
                                  <small class="mt-1 block text-[9.5px]/[1.35] text-[var(--text-weak)]">
                                    {choice.detail}
                                  </small>
                                </span>
                              </button>
                            );
                          }}
                        </For>
                        <Show when={anchorChoices().length > 0}>
                          <section class="grid min-h-[64px] grid-cols-[minmax(0,1fr)_48px] items-center gap-3 rounded-lg border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] px-2.5 py-2">
                            <div class="min-w-0">
                              <strong class="text-[11px] font-medium text-[var(--text-strong)]">
                                Coordinates
                              </strong>
                              <small class="mt-1 block truncate text-[9.5px]/[1.35] text-[var(--text-weak)]">
                                {activeAnchor()?.label ?? "Choose anchor"}
                                <Show when={activeAnchor()}>
                                  {(anchor) => ` · ${fmtPoint(anchor().point)}`}
                                </Show>
                              </small>
                            </div>
                            <div class="relative size-11" aria-label="Coordinate anchor">
                              <span
                                class="pointer-events-none absolute inset-[7px] rounded-[3px] border border-[var(--v2-border-border-strong)] bg-[var(--v2-background-bg-deep)]"
                                aria-hidden="true"
                              />
                              <For each={anchorChoices()}>
                                {(anchor) => {
                                  const anchorTarget = () => ({ point: anchor.point });
                                  const selected = () =>
                                    targetMatches("point", target(), anchorTarget());
                                  return (
                                    <button
                                      type="button"
                                      role="radio"
                                      aria-label={`${anchor.label}: ${fmtPoint(anchor.point)}`}
                                      aria-checked={selected()}
                                      data-tip={anchor.label}
                                      class={cn(
                                        "absolute z-[1] grid size-4 place-items-center rounded-sm outline-none transition-transform duration-150 ease-out focus-visible:ring-2 focus-visible:ring-[var(--v2-background-bg-accent)] active:scale-[0.85]",
                                        anchorGridPosition(anchor.id),
                                      )}
                                      onClick={() => chooseTarget(anchorTarget())}
                                    >
                                      <i
                                        class={cn(
                                          "rounded-[1px] transition-[background-color,box-shadow] duration-150 ease-out",
                                          selected()
                                            ? "size-2 bg-[var(--v2-background-bg-accent)] shadow-[0_0_0_2px_var(--v2-background-bg-layer-01)]"
                                            : "size-1.5 bg-[var(--text-weak)] hover:bg-[var(--text-base)]",
                                        )}
                                      />
                                    </button>
                                  );
                                }}
                              </For>
                            </div>
                          </section>
                        </Show>
                      </div>
                    </div>
                  </Show>
                )}
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
      <footer class="flex min-h-14 shrink-0 items-center justify-between border-t border-[var(--v2-border-border-muted)] px-[15px]">
        <div class="flex gap-1">
          <button
            type="button"
            class={navBtn}
            aria-label="Previous state"
            disabled={index() === 0}
            onClick={() => move(-1)}
          >
            <Icon name="chevron-left" size={14} />
          </button>
          <button
            type="button"
            class={navBtn}
            aria-label="Next state"
            disabled={index() === draft.steps().length - 1}
            onClick={() => move(1)}
          >
            <Icon name="chevron-right" size={14} />
          </button>
        </div>
        <button
          type="button"
          class={productSecondary}
          onClick={() => {
            const selected = index();
            props.onEdit();
            queueMicrotask(() => draft.setExpandedStep(selected));
          }}
        >
          <Icon name="sliders" size={13} /> Advanced editor
        </button>
      </footer>
    </aside>
  );
}
