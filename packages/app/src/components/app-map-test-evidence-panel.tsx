import { For, Show, createMemo } from "solid-js";
import type { AppMapCompiledTest, AppMapScenarioTest } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import {
  failureForTestRun,
  outcomeForTestStep,
  type AppMapTestRun,
  type AppMapTestStepRunState,
} from "../lib/app-map-test-evidence";
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
    <div class="grid gap-3">
      <Show
        when={props.plan}
        fallback={
          <TestContextEmpty
            icon="command"
            title="Compile to see results"
            detail="Compilation creates a deterministic recipe. Relay attaches outcomes only after that exact recipe runs."
          />
        }
      >
        {(plan) => (
          <>
            <CompiledTestSummary plan={plan()} />
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
                  <RunResultCard
                    run={run()}
                    counts={props.counts}
                    devices={props.devices}
                    onOpenRun={props.onOpenRun}
                  />
                  <Show when={failure()}>
                    {(localized) => (
                      <FailureCard
                        failure={localized()}
                        test={props.test}
                        onSelectStep={props.onSelectStep}
                      />
                    )}
                  </Show>
                  <Show when={props.selectedStepId}>
                    <SelectedStepResult
                      stepIntent={selectedStep()?.intent ?? "Selected step"}
                      outcome={selectedOutcome()}
                      persistedRun={runAsPersisted()}
                      frame={selectedFrame()}
                      frameUrl={props.frameUrl}
                    />
                  </Show>
                </>
              )}
            </Show>
            <ProvenanceCard selectedStepId={props.selectedStepId} provenance={props.provenance} />
          </>
        )}
      </Show>
      <Show when={props.detailError}>
        <p
          class="m-0 rounded-lg border border-border-critical-base bg-surface-critical-weak p-3 text-[11px]/[1.5] text-text-critical-base"
          role="alert"
        >
          Some evidence details could not be loaded. The summary above uses only the data Relay has.{" "}
          {props.detailError}
        </p>
      </Show>
    </div>
  );
}

function CompiledTestSummary(props: { plan: AppMapCompiledTest }) {
  return (
    <section class="rounded-xl border border-border-weak-base bg-surface-base p-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="m-0 text-[10px] font-semibold tracking-[0.08em] text-text-weaker uppercase">
            Compiled revision
          </p>
          <strong class="mt-1 block text-[12px] text-text-strong">
            Map revision {props.plan.appMapRevision}
          </strong>
        </div>
        <span class="text-[10.5px] tabular-nums text-text-weak">
          {Object.keys(props.plan.recipes).length} recipes
        </span>
      </div>
      <code class="mt-3 block overflow-x-auto rounded-lg bg-background-deep p-2 font-mono text-[9.5px]/[1.45] text-text-weak">
        {props.plan.rootRecipeId}
      </code>
    </section>
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
      class="overflow-hidden rounded-xl border border-border-weak-base bg-surface-base"
      aria-label="Latest Test result"
    >
      <header class="flex min-h-11 items-center justify-between gap-3 border-b border-border-weak-base px-3 py-2">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <strong class="truncate text-[12px] font-semibold text-text-strong">
              Latest result
            </strong>
            <StatusChip tone={status().tone} label={status().label} />
          </div>
          <span class="mt-1 block truncate text-[10.5px] text-text-weak">
            {runTargetLabel(props.run, props.devices)} ·{" "}
            {observedAt() === undefined
              ? "Time not recorded"
              : formatTestContextDate(observedAt()!)}
          </span>
        </div>
        <Show when={props.onOpenRun}>
          <Button
            variant="secondary"
            size="sm"
            class="min-h-11 shrink-0"
            onClick={() => props.onOpenRun?.(props.run.id)}
          >
            Open run
          </Button>
        </Show>
      </header>
      <div class="grid grid-cols-2 gap-px bg-border-weak-base sm:grid-cols-4">
        <TestContextMetric label="Duration" value={formatTestContextDuration(duration())} />
        <TestContextMetric label="Frames" value={String(props.counts.frames)} />
        <TestContextMetric label="Events" value={String(props.counts.events)} />
        <TestContextMetric label="Artifacts" value={String(props.counts.artifacts)} />
      </div>
    </section>
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
      class="rounded-xl border border-border-critical-base bg-surface-critical-weak p-3 text-text-critical-base"
      role="alert"
    >
      <p class="m-0 text-[10px] font-semibold tracking-[0.08em] uppercase">Failure location</p>
      <strong class="mt-1 block text-[12px]">
        {step()?.intent ?? (props.failure.testStepId ? "Authored step" : "Run-level failure")}
      </strong>
      <p class="mt-1 break-words text-[11px]/[1.5]">
        {props.failure.message ?? "The run failed without a recorded error message."}
      </p>
      <div class="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
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
      class="overflow-hidden rounded-xl border border-border-weak-base bg-surface-base"
      aria-label="Selected step result"
    >
      <header class="flex items-start justify-between gap-3 p-3">
        <div class="min-w-0">
          <p class="m-0 text-[10px] font-semibold tracking-[0.08em] text-text-weaker uppercase">
            Selected step
          </p>
          <strong class="mt-1 block text-[12px]/[1.4] text-text-strong">{props.stepIntent}</strong>
        </div>
        <StatusChip tone={presentation().tone} label={presentation().label} />
      </header>
      <Show when={props.outcome?.totalRecipeSteps === 0}>
        <p class="mx-3 mt-0 mb-3 rounded-lg bg-background-base p-2.5 text-[10.5px]/[1.5] text-text-weak">
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
    <details class="rounded-xl border border-border-weak-base bg-surface-base">
      <summary class="flex min-h-11 cursor-pointer items-center px-3 text-[11px] font-semibold text-text-strong focus-visible:outline-2 focus-visible:outline-offset-[-3px]">
        {props.selectedStepId ? "Selected step provenance" : "Test provenance"} ·{" "}
        {props.provenance.length}
      </summary>
      <div class="border-t border-border-weak-base px-3">
        <For
          each={props.provenance}
          fallback={
            <p class="my-3 text-[11px] text-text-weak">This selection emitted no recipe step.</p>
          }
        >
          {(item) => (
            <article class="grid gap-1 border-t border-border-weak-base py-2.5 first:border-0">
              <div class="flex items-center justify-between gap-2">
                <strong class="truncate font-mono text-[10px] font-medium text-text-strong">
                  {item.recipeStepId}
                </strong>
                <span class="shrink-0 text-[9.5px] tabular-nums text-text-weaker">
                  Step {item.stepIndex + 1}
                </span>
              </div>
              <span class="truncate text-[10px] text-text-weak">
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
