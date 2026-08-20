import { For, Show, createMemo } from "solid-js";
import type {
  AppMapCompiledTest,
  AppMapScenarioTest,
  AppMapTestExecutionScheduleReason,
} from "@relay/protocol";
import {
  failureForTestRun,
  outcomeForTestStep,
  type AppMapTestRun,
  type AppMapTestStepRunState,
} from "../lib/app-map-test-evidence";
import { cn } from "../lib/cn";
import { findScenarioStep } from "../lib/app-map-test-editor-tree";
import type { PersistedRun } from "../lib/api-types";
import { runTargetLabel } from "../lib/run-presentation";
import { StatusChip, type StatusChipTone } from "./status-chip";
import {
  TestContextEmpty,
  TestContextMetric,
  formatTestContextDate,
  formatTestContextDuration,
} from "./app-map-test-context-primitives";

type EvidenceCounts = { frames: number; events: number; artifacts: number };

/** Keep the persisted scheduler codes terse and stable while making the
 * read-only compile summary useful to a person reviewing a proposed route. */
const scheduleReasonLabel: Record<AppMapTestExecutionScheduleReason, string> = {
  "reviewed-return-equivalence": "Reviewed return",
  "authored-order": "Authored order",
  "cleanup-boundary": "Cleanup boundary",
  "external-handoff": "External handoff",
  "cold-reset-branch": "Review-only recovery",
  "unknown-cursor": "Needs source proof",
  "prerequisite-boundary": "Prerequisite boundary",
  "unknown-document-position": "No semantic position",
  "conflicting-document-order": "Conflicting semantic positions",
  "missing-reviewed-return": "Needs reviewed return",
};

/** One disclosure grammar for the two low-frequency detail cards in this rail. */
const evidenceSummary = cn(
  "flex min-h-9 cursor-pointer list-none items-center px-2.5 text-caption font-medium text-text-base",
  "hover:text-text-strong",
  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-border-strong-focus",
);

export function AppMapTestEvidencePanel(props: {
  test: AppMapScenarioTest;
  plan?: AppMapCompiledTest;
  selectedStepId?: string;
  run?: AppMapTestRun;
  counts: EvidenceCounts;
  provenance: AppMapCompiledTest["stepProvenance"];
  detailError: string;
  devices: Parameters<typeof runTargetLabel>[1];
  frameUrl: (run: PersistedRun, frame: PersistedRun["frames"][number]) => string;
  onOpenRun?: (runId: string) => void;
  onSelectStep?: (stepId: string) => void;
}) {
  const selectedStep = createMemo(() => findScenarioStep(props.test.steps, props.selectedStepId));
  const selectedOutcome = createMemo(() =>
    outcomeForTestStep(props.plan, props.run, props.selectedStepId),
  );
  const failure = createMemo(() => failureForTestRun(props.plan, props.run));
  const runAsPersisted = createMemo(() => {
    const run = props.run;
    return run && ("writtenAt" in run || ("persisted" in run && run.persisted))
      ? (run as PersistedRun)
      : undefined;
  });
  const selectedFrame = createMemo(() => selectedOutcome()?.latestFrame);

  return (
    <div class="grid gap-2.5">
      <Show
        when={props.plan}
        fallback={
          <TestContextEmpty
            icon="command"
            title="No results yet"
            detail="Run this Test on a target to create its first result and step-by-step evidence."
          />
        }
      >
        {(plan) => (
          <>
            <Show
              when={props.run}
              fallback={
                <TestContextEmpty
                  icon="clock"
                  title="Ready for a first run"
                  detail="No result exists for this compiled revision yet. Older and similarly named runs stay separate."
                />
              }
            >
              {(run) => (
                <>
                  {/* The selected step comes first: evidence is per step, and the
                      old order buried it under two run-level cards. */}
                  <Show when={props.selectedStepId}>
                    <SelectedStepResult
                      stepIntent={selectedStep()?.intent ?? "Selected step"}
                      outcome={selectedOutcome()}
                      persistedRun={runAsPersisted()}
                      frame={selectedFrame()}
                      frameUrl={props.frameUrl}
                    />
                  </Show>
                  <Show when={failure()}>
                    {(localized) => (
                      <FailureCard
                        failure={localized()}
                        test={props.test}
                        onSelectStep={props.onSelectStep}
                      />
                    )}
                  </Show>
                  <RunResultCard
                    run={run()}
                    counts={props.counts}
                    devices={props.devices}
                    onOpenRun={props.onOpenRun}
                  />
                </>
              )}
            </Show>
            <ProvenanceCard selectedStepId={props.selectedStepId} provenance={props.provenance} />
            <CompiledTestSummary plan={plan()} />
          </>
        )}
      </Show>
      <Show when={props.detailError}>
        <p
          class="m-0 rounded-md border border-border-critical-base bg-surface-critical-weak p-2.5 text-caption/[1.45] text-text-critical-base"
          role="alert"
        >
          Some evidence details could not be loaded. This summary uses only the data Relay has.{" "}
          {props.detailError}
        </p>
      </Show>
    </div>
  );
}

function CompiledTestSummary(props: { plan: AppMapCompiledTest }) {
  return (
    <details class="rounded-md border border-border-weak-base">
      <summary class={evidenceSummary}>What ran · map revision {props.plan.appMapRevision}</summary>
      <div class="border-t border-border-weak-base p-2.5">
        <p class="m-0 text-caption/[1.4] text-text-weak">
          {Object.keys(props.plan.recipes).length}{" "}
          {Object.keys(props.plan.recipes).length === 1 ? "recipe" : "recipes"} compiled from this
          revision.
        </p>
        <code class="mt-1.5 block overflow-x-auto rounded bg-background-deep p-1.5 font-mono text-micro/[1.45] text-text-weak">
          {props.plan.rootRecipeId}
        </code>
        <Show when={props.plan.executionSchedule}>
          {(schedule) => {
            const checks = () => schedule().checks;
            const deferredCheckCount = () =>
              checks().filter((check) => check.disposition === "deferred").length;
            const coldBranchCount = () => schedule().deferredBranches.length;
            const coldBranchLabel = () => {
              const count = coldBranchCount();
              return count === 1 ? "1 review-only recovery" : `${count} review-only recoveries`;
            };
            return (
              <section
                class="mt-2.5 border-t border-border-weak-base pt-2.5"
                aria-label="Execution proposal"
              >
                <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                  <strong class="text-caption font-medium text-text-base">
                    Execution proposal
                  </strong>
                  <span class="text-micro font-medium text-text-weak">
                    {schedule().mode === "review-required" ? "Review required" : "Authored order"}
                  </span>
                </div>
                <p class="mt-1 text-caption/[1.4] text-text-weak">
                  {checks().length} {checks().length === 1 ? "check" : "checks"} ·{" "}
                  {deferredCheckCount()} deferred
                  {coldBranchCount() ? ` · ${coldBranchLabel()}` : ""}. Saved Test order stays
                  unchanged.
                </p>
                <ol class="mt-2 grid gap-1" aria-label="Proposed check order">
                  <For each={checks()}>
                    {(check) => (
                      <li
                        data-app-map-schedule-check={check.checkId}
                        class="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-baseline gap-x-1.5 rounded bg-surface-base px-1.5 py-1 text-micro/[1.35]"
                      >
                        <span class="tabular-nums text-text-weak">{check.proposedIndex + 1}</span>
                        <span class="truncate text-text-base">{check.checkId}</span>
                        <span class="text-right text-text-weak">
                          {scheduleReasonLabel[check.reason]}
                        </span>
                      </li>
                    )}
                  </For>
                </ol>
              </section>
            );
          }}
        </Show>
      </div>
    </details>
  );
}

function RunResultCard(props: {
  run: AppMapTestRun;
  counts: EvidenceCounts;
  devices: Parameters<typeof runTargetLabel>[1];
  onOpenRun?: (runId: string) => void;
}) {
  const status = () => runStatus(props.run);
  const duration = () =>
    props.run.finishedAt !== undefined && props.run.startedAt !== undefined
      ? Math.max(0, props.run.finishedAt - props.run.startedAt)
      : undefined;
  const observedAt = () => props.run.finishedAt ?? props.run.startedAt ?? props.run.queuedAt;
  return (
    <section
      class="overflow-hidden rounded-md border border-border-weak-base"
      aria-label="Latest Test result"
    >
      <Show
        when={props.onOpenRun}
        fallback={
          <RunResultHeader
            status={status()}
            target={runTargetLabel(props.run, props.devices)}
            observedAt={observedAt()}
          />
        }
      >
        <button
          type="button"
          data-test-result-row={props.run.id}
          class="flex min-h-16 w-full items-center justify-between gap-3 border-b border-border-weak-base px-3 py-2 text-left transition-[background-color,transform] hover:bg-surface-base-hover active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-border-strong-focus"
          aria-label={`Open latest Test result: ${status().label}`}
          onClick={() => props.onOpenRun?.(props.run.id)}
        >
          <RunResultHeaderContent
            status={status()}
            target={runTargetLabel(props.run, props.devices)}
            observedAt={observedAt()}
          />
          <span class="shrink-0 text-caption font-semibold text-text-interactive-base">
            Open <span aria-hidden="true">→</span>
          </span>
        </button>
      </Show>
      <div class="grid grid-cols-2 gap-px bg-border-weak-base sm:grid-cols-4">
        <TestContextMetric label="Duration" value={formatTestContextDuration(duration())} />
        <TestContextMetric label="Frames" value={String(props.counts.frames)} />
        <TestContextMetric label="Events" value={String(props.counts.events)} />
        <TestContextMetric label="Artifacts" value={String(props.counts.artifacts)} />
      </div>
    </section>
  );
}

function RunResultHeader(props: {
  status: { tone: StatusChipTone; label: string };
  target: string;
  observedAt?: number;
}) {
  return (
    <header class="flex min-h-16 items-center border-b border-border-weak-base px-3 py-2">
      <RunResultHeaderContent {...props} />
    </header>
  );
}

function RunResultHeaderContent(props: {
  status: { tone: StatusChipTone; label: string };
  target: string;
  observedAt?: number;
}) {
  return (
    <span class="min-w-0">
      <span class="flex flex-wrap items-center gap-2">
        <strong class="truncate text-caption font-semibold text-text-strong">Latest result</strong>
        <StatusChip tone={props.status.tone} label={props.status.label} />
      </span>
      <span class="mt-1 block truncate text-micro text-text-weak">
        {props.target} ·{" "}
        {props.observedAt === undefined
          ? "Time not recorded"
          : formatTestContextDate(props.observedAt)}
      </span>
    </span>
  );
}

function FailureCard(props: {
  failure: NonNullable<ReturnType<typeof failureForTestRun>>;
  test: AppMapScenarioTest;
  onSelectStep?: (stepId: string) => void;
}) {
  const step = () => findScenarioStep(props.test.steps, props.failure.testStepId);
  return (
    <section
      class="rounded-md border border-border-critical-base bg-surface-critical-weak p-2.5 text-text-critical-base"
      role="alert"
    >
      <strong class="block text-caption font-medium">
        Failed at {step()?.intent ?? (props.failure.testStepId ? "an authored step" : "run level")}
      </strong>
      <p class="mt-1 break-words text-caption/[1.45]">
        {props.failure.message ?? "The run failed without a recorded error message."}
      </p>
      <div class="mt-2 flex flex-wrap items-center gap-2 text-micro">
        <Show when={props.failure.category}>
          <span class="rounded-md bg-background-base/60 px-2 py-1">{props.failure.category}</span>
        </Show>
        <Show when={props.failure.testStepId && props.onSelectStep}>
          <button
            type="button"
            class="min-h-11 rounded-lg px-2.5 font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={() =>
              props.failure.testStepId && props.onSelectStep?.(props.failure.testStepId)
            }
          >
            Inspect this step
          </button>
        </Show>
      </div>
    </section>
  );
}

function SelectedStepResult(props: {
  stepIntent: string;
  outcome?: ReturnType<typeof outcomeForTestStep>;
  persistedRun?: PersistedRun;
  frame?: PersistedRun["frames"][number];
  frameUrl: (run: PersistedRun, frame: PersistedRun["frames"][number]) => string;
}) {
  const presentation = () => stepState(props.outcome?.state ?? "unobserved");
  return (
    <section
      class="overflow-hidden rounded-md border border-border-weak-base"
      aria-label="Selected step result"
    >
      <header class="flex items-start justify-between gap-2 p-2.5">
        <strong class="min-w-0 text-caption font-medium text-text-strong">
          {props.stepIntent}
        </strong>
        <StatusChip tone={presentation().tone} label={presentation().label} />
      </header>
      <Show when={props.outcome?.totalRecipeSteps === 0}>
        <p class="mx-3 mt-0 mb-3 rounded-lg bg-background-base p-2.5 text-micro/[1.5] text-text-weak">
          This step compiled into a nested recipe, but this run has no nested trace join. Relay will
          not infer an outcome.
        </p>
      </Show>
      <Show when={props.frame && props.persistedRun}>
        <img
          src={props.frameUrl(props.persistedRun!, props.frame!)}
          alt={`Immutable evidence for ${props.stepIntent}`}
          class="aspect-video w-full border-y border-border-weak-base bg-background-deep object-contain"
        />
      </Show>
      <div class="grid grid-cols-2 gap-px bg-border-weak-base sm:grid-cols-4">
        <TestContextMetric
          label="Observed"
          value={`${props.outcome?.observedRecipeSteps ?? 0}/${props.outcome?.totalRecipeSteps ?? 0}`}
        />
        <TestContextMetric
          label="Duration"
          value={formatTestContextDuration(props.outcome?.durationMs)}
        />
        <TestContextMetric label="Frames" value={String(props.outcome?.frames ?? 0)} />
        <TestContextMetric
          label="Events + artifacts"
          value={String((props.outcome?.events ?? 0) + (props.outcome?.artifacts ?? 0))}
        />
      </div>
    </section>
  );
}

function ProvenanceCard(props: {
  selectedStepId?: string;
  provenance: AppMapCompiledTest["stepProvenance"];
}) {
  return (
    <details class="rounded-md border border-border-weak-base">
      <summary class={evidenceSummary}>
        {props.selectedStepId ? "How this step compiled" : "How this test compiled"} ·{" "}
        {props.provenance.length}
      </summary>
      <div class="border-t border-border-weak-base px-2.5">
        <For
          each={props.provenance}
          fallback={
            <p class="my-3 text-caption text-text-weak">This selection emitted no recipe step.</p>
          }
        >
          {(item) => (
            <article class="grid gap-1 border-t border-border-weak-base py-2.5 first:border-0">
              <div class="flex items-center justify-between gap-2">
                <strong class="truncate font-mono text-micro font-medium text-text-strong">
                  {item.recipeStepId}
                </strong>
                <span class="shrink-0 text-micro tabular-nums text-text-weaker">
                  Step {item.stepIndex + 1}
                </span>
              </div>
              <span class="truncate text-micro text-text-weak">
                {item.bindingKind}
                {item.referencedEntityIds.length
                  ? ` · ${item.referencedEntityIds.join(", ")}`
                  : " · no map reference"}
              </span>
            </article>
          )}
        </For>
      </div>
    </details>
  );
}

function runStatus(run: AppMapTestRun): { tone: StatusChipTone; label: string } {
  if (run.status === "ok") return { tone: "pass", label: "Passed" };
  if (run.status === "healed") return { tone: "pass", label: "Passed with recovery" };
  if (run.status === "error") return { tone: "fail", label: "Failed" };
  if (run.status === "cancelled") return { tone: "fail", label: "Cancelled" };
  if (run.status === "paused") return { tone: "attention", label: "Needs input" };
  if (run.status === "running") return { tone: "run", label: "Running" };
  if (run.status === "queued") return { tone: "run", label: "Queued" };
  return { tone: "idle", label: "Status unavailable" };
}

function stepState(state: AppMapTestStepRunState): { tone: StatusChipTone; label: string } {
  if (state === "passed") return { tone: "pass", label: "Passed" };
  if (state === "healed") return { tone: "pass", label: "Recovered" };
  if (state === "failed") return { tone: "fail", label: "Failed" };
  if (state === "paused") return { tone: "attention", label: "Needs input" };
  if (state === "partial") return { tone: "attention", label: "Partially observed" };
  if (state === "running") return { tone: "run", label: "Running" };
  if (state === "queued") return { tone: "run", label: "Queued" };
  return { tone: "idle", label: "Not observed" };
}
