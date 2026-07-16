import { For, Show, createMemo, createSignal } from "solid-js";
import { useRecipeDraft } from "../context/recipe-draft";
import { useServer, type RecipeStep, type StepTarget } from "../context/server";
import { toast } from "../context/toast";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { sentenceForStep } from "../lib/step-sentence";
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
              <small class="mt-2 block font-mono text-[10.5px]/[1.2] tabular-nums text-[var(--text-weak)]">
                Step {Math.min(active() + 1, draft.steps().length)} of {draft.steps().length}
              </small>
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
  const runBlockedReason = () =>
    testRunBlocker({
      health: server.health(),
      selectedDevice: server.selectedDevice(),
      devices: server.devices(),
      stepCount: draft.steps().length,
      invalidCount: draft.invalidCount(),
    });
  const run = () => {
    const blocker = runBlockedReason();
    if (blocker) {
      toast(blocker, "warning");
      if (!server.selectedDevice() || server.isEmptyDevices()) props.onOpenTargets();
      return;
    }
    const recipe = server.selectedRecipe();
    if (recipe) void server.runRecipeRemote(recipe.id);
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
          <span class={eyebrow}>Step</span>
          <strong class="mt-1 block truncate text-[13px] leading-[1.2] font-semibold text-[var(--text-strong)]">
            {props.compact ? sentence() : `${index() + 1} of ${draft.steps().length}`}
          </strong>
        </div>
        <Show when={!props.compact}>
          <button
            type="button"
            class={cn(productPrimary, "min-h-8 px-3 text-[12px]")}
            onClick={run}
            data-tip={runBlockedReason() || "Run this test"}
          >
            <Icon name="play" size={13} /> Run
          </button>
        </Show>
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
          <Icon name="sliders" size={13} /> {props.compact ? "More fields" : "Advanced"}
        </button>
      </footer>
    </aside>
  );
}
