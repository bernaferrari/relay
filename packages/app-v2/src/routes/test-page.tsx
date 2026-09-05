/** @jsxImportSource react */
import { RunConfigurationComposer } from "../components/run-configuration-composer";
import { usePersistedRunConfiguration, useRunConfigurationKey } from "../data/use-persisted-run-configuration";
import { WorkbenchPage, PageHeader, WorkbenchPanes } from "../components/page-layout";
import { Badge } from "@relay/ui-react/components/badge";
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import type { ProductTestStep } from "@relay/product/catalog";
import { Breadcrumbs, EmptyState, OutcomeMark } from "../components/product-patterns";
import { TestStepEvidencePreview } from "../components/test-step-evidence-preview";
import { runQueryKeys } from "../data/run-queries";
import { readRunPointer, writeRunPointer } from "../data/run-pointer";
import {
  stabilitySamplesFromRuns,
  summarizeProductStability,
} from "../data/stability-product-service";
import { useLatestTestReport } from "../hooks/use-latest-test-report";
import { PageLoading, RecordingProblem, targetLabel } from "./recording-shared";

const routeApi = getRouteApi("/tests/$testId");

export function TestPage() {
  const { runService, platform, queryClient } = useRouteContext({ from: "__root__" });
  const { testId } = routeApi.useParams();
  const navigate = useNavigate();

  const [evidenceStepId, setEvidenceStepId] = useState("");
  const test = useQuery({
    queryKey: runQueryKeys.test(testId),
    queryFn: () => runService.getTest(testId),
  });
  const {
    recentRuns,
    latestReport,
    loading: reportLoading,
  } = useLatestTestReport(runService, testId);
  const completeStabilityRuns = useQuery({
    queryKey: runQueryKeys.testStability(testId),
    queryFn: () => runService.listTestRunsComplete!(testId),
    enabled: typeof runService.listTestRunsComplete === "function",
  });
  const pointer = useQuery({
    queryKey: runQueryKeys.pointer,
    queryFn: async () => (await readRunPointer(platform)) ?? null,
    staleTime: Infinity,
  });
  const targets = useQuery({
    queryKey: runQueryKeys.targets,
    queryFn: () => runService.listTargets(),
    staleTime: 5_000,
  });
  const scope = useRunConfigurationKey(platform, `test:${testId}`, test.data?.appMapId);
  const configuration = usePersistedRunConfiguration({ storage: platform.storage, key: scope.key, targetOptions: targets.data?.map((target) => ({ id: target.targetId, label: target.name })), initial: targets.data?.length === 1 ? { targetProfileId: targets.data[0]!.targetId } : {} });
  const targetId = configuration.selection.targetProfileId ?? "";
  const targetReady = Boolean(targets.data?.some((target) => target.targetId === targetId));
  const start = useMutation({
    mutationFn: async () => {
      if (!test.data || !targetReady || configuration.loading) {
        throw new TypeError("Choose a ready device or browser for this Run.");
      }
      const started = await runService.start({
        testId,
        appMapId: test.data.appMapId,
        targetId,
      });
      const workflowId = started.workflow?.workflowId;
      if (!workflowId) {
        if (started.recovery) return started;
        throw new TypeError("Relay could not start this Run.");
      }
      const canonical = await runService.inspect(workflowId);
      const runId = canonical.run?.runId ?? started.run?.runId;
      if (!runId) {
        if (canonical.recovery) return canonical;
        throw new TypeError("Relay could not open the new Run.");
      }
      const durable = canonical.run?.runId ? canonical : { ...canonical, run: started.run };
      await writeRunPointer(platform, { workflowId, runId, testId });
      queryClient.setQueryData(runQueryKeys.pointer, { workflowId, runId, testId });
      queryClient.setQueryData(runQueryKeys.workflow(workflowId), durable);
      return durable;
    },
    onSuccess: async (state) => {
      if (!state.run?.runId) return;
      await navigate({ to: "/runs/$runId", params: { runId: state.run.runId } });
    },
  });

  // The run pointer is workspace-wide. It should only interrupt the document
  // that owns the run; a run for another Test belongs in Activity, not here.
  const activeRun = pointer.data?.testId === testId ? pointer.data : undefined;
  const loading = test.isPending || targets.isPending || pointer.isPending;
  const evidenceSteps = flattenSteps(test.data?.steps ?? []);
  const selectedEvidenceStep =
    evidenceSteps.find((step) => step.id === evidenceStepId) ?? evidenceSteps.at(0);
  const stabilityRuns = completeStabilityRuns.data ?? recentRuns.data;
  const stabilityHistoryComplete = completeStabilityRuns.data !== undefined;
  const stability = stabilityRuns
    ? summarizeProductStability({
        samples: stabilitySamplesFromRuns(stabilityRuns),
        historyComplete: stabilityHistoryComplete,
        scope: { testId },
      })
    : undefined;

  return (
    <WorkbenchPage className="relay-test-page">
      <Breadcrumbs
        items={[{ label: "Tests", to: "/tests" }, { label: test.data?.name ?? "Test" }]}
      />
      <PageHeader
        title={test.data?.name ?? "Test"}
        context={<><span>{test.data?.appName}</span><span>Saved Test</span></>}
        actions={<>
          <Button
            nativeButton={false}
            render={<Link to="/tests/$testId/edit" params={{ testId }} />}
            variant="outline"
            size="sm"
          >
            Edit Test
          </Button>
          <Button
            nativeButton={false}
            render={<Link to="/tests/$testId/run-across" params={{ testId }} />}
            variant="ghost"
            size="sm"
          >
            Run with data
          </Button>
        </>}
      />

      {loading ? <PageLoading label="Loading the Test and available devices…" /> : null}
      <RecordingProblem
        error={test.error ?? targets.error ?? start.error}
        recovery={start.data?.recovery}
        onRetry={() => {
          void test.refetch();
          void targets.refetch();
        }}
        retrying={test.isFetching || targets.isFetching}
      />

      {!loading && !test.data && !test.isError ? (
        <EmptyState
          title="This Test is not available"
          detail="It may have been removed or may belong to another app. Choose a saved Test to continue."
          action={
            <Link className="relay-inline-link" to="/tests">
              Browse saved Tests
            </Link>
          }
        />
      ) : null}

      {activeRun ? (
        <div className="relay-resume-recording relay-resume-run">
          <div>
            <strong>A Run is already in progress</strong>
            <p>Resume it before starting this Test again.</p>
          </div>
          <Button
            variant="default"
            size="sm"
            nativeButton={false}
            render={<Link to="/runs/$runId" params={{ runId: activeRun.runId }} />}
          >
            Resume Run
          </Button>
        </div>
      ) : null}

      {!test.isPending && test.data ? (
        <WorkbenchPanes
          outline={
          <section className="relay-test-overview" aria-labelledby="test-overview-title">
            <div className="relay-section-heading">
              <div>
                <p className="relay-section-label">Journey</p>
                <h2 id="test-overview-title">Saved steps</h2>
              </div>
              <span>{test.data.stepCount === 1 ? "1 step" : `${test.data.stepCount} steps`}</span>
            </div>
            {test.data.steps?.length ? (
              <ol className="relay-test-readable-steps">
                {test.data.steps.map((step, index) => (
                  <ReadableStep
                    key={step.id}
                    step={step}
                    number={String(index + 1)}
                    selectedId={selectedEvidenceStep?.id}
                    onSelect={setEvidenceStepId}
                  />
                ))}
              </ol>
            ) : (
              <p className="relay-test-no-steps">This Test has no reviewed steps yet.</p>
            )}

          </section>
          }
          stage={<>
            {selectedEvidenceStep ? (
              <TestStepEvidencePreview
                step={selectedEvidenceStep}
                report={latestReport.data}
                hasRuns={Boolean(recentRuns.data?.length)}
                loading={reportLoading}
              />
            ) : null}
          </>}
          inspector={!activeRun && !targets.isError ? (
          <RunConfigurationComposer
            configuration={{ values: { targetName: targets.data?.find((target) => target.targetId === targetId)?.name }, validated: targetReady && !configuration.loading, blockers: configuration.targetUnavailable ? [{ id: "target", label: "Saved target is unavailable", detail: "Choose a ready device or browser to continue." }] : [] }}
            targetOptions={targets.data?.map((target) => ({ id: target.targetId, label: targetLabel(target).title, detail: targetLabel(target).detail }))}
            selection={configuration.selection}
            onSelectionChange={configuration.setSelection}
            loading={configuration.loading}
            error={scope.error ?? configuration.error}
            onRetry={configuration.retry}
          >
            {!targets.data?.length ? <EmptyState title="No device or browser is ready" detail="Connect a target to continue with this Test." action={<Link className="relay-inline-link" to="/devices">View devices</Link>} /> : null}
            <div className="relay-test-run-action">
              <Button
                variant="default"
                onClick={() => start.mutate()}
                disabled={!targetReady || configuration.loading || start.isPending}
              >
                {start.isPending ? "Starting…" : "Run Test"}
              </Button>
              {!targetId && targets.data?.length ? (
                <span className="text-xs text-text-weaker">Choose where to run</span>
              ) : null}
            </div>
          </RunConfigurationComposer>
          ) : undefined}
        />
      ) : null}

      {!loading && test.data && recentRuns.data?.length ? (
        <div className="relay-test-history-grid">
          <section className="relay-test-stability" aria-labelledby="test-stability-title">
            <div className="relay-section-heading">
              <div>
                <p className="relay-section-label">Reliability</p>
                <h2 id="test-stability-title">Recent stability</h2>
              </div>
              <Badge
                variant="secondary"
                className={
                  stability?.signals.length
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : undefined
                }
              >
                {stabilityHistoryComplete ? "Complete history" : "Partial history"}
              </Badge>
            </div>
            <dl>
              <div>
                <dt>Observed Runs</dt>
                <dd>{stability?.sampleCount ?? 0}</dd>
              </div>
              <div>
                <dt>Verified passes</dt>
                <dd>{stability?.passedCount ?? 0}</dd>
              </div>
              <div>
                <dt>Product failures</dt>
                <dd>{stability?.failedCount ?? 0}</dd>
              </div>
            </dl>
            {stability?.signals.length ? (
              <ul>
                {stability.signals.map((signal) => (
                  <li key={`${signal.kind}:${signal.environmentId ?? "all"}`}>{signal.summary}</li>
                ))}
              </ul>
            ) : (
              <p>
                Relay has not found a repeated stability signal in the loaded Runs. Rates stay
                hidden until complete history is available.
              </p>
            )}
          </section>

          <section className="relay-test-runs" aria-labelledby="test-runs-title">
            <div className="relay-section-heading">
              <div>
                <p className="relay-section-label">Reports</p>
                <h2 id="test-runs-title">Recent Runs</h2>
              </div>
              <Link className="relay-inline-link" to="/runs" search={{ view: "all", test: testId }}>
                View all Runs
              </Link>
            </div>
            <ul>
              {[...recentRuns.data]
                .sort(
                  (left, right) =>
                    (right.finishedAt ?? right.startedAt ?? right.queuedAt) -
                    (left.finishedAt ?? left.startedAt ?? left.queuedAt),
                )
                .slice(0, 4)
                .map((run) => (
                  <li key={run.id}>
                    <Link to="/runs/$runId" params={{ runId: run.id }}>
                      <OutcomeMark outcome={run.outcome ?? run.phase} />
                      <span>{run.targetName ?? "Saved target"}</span>
                      <small>
                        {formatRunDate(run.finishedAt ?? run.startedAt ?? run.queuedAt)}
                      </small>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        </div>
      ) : null}
    </WorkbenchPage>
  );
}

function ReadableStep({
  step,
  number,
  selectedId,
  onSelect,
}: {
  step: ProductTestStep;
  number: string;
  selectedId: string | undefined;
  onSelect(stepId: string): void;
}) {
  return (
    <li data-selected={selectedId === step.id}>
      <span>{number}</span>
      <button type="button" aria-pressed={selectedId === step.id} onClick={() => onSelect(step.id)}>
        <strong>{step.intent}</strong>
        <small>
          {step.kind === "validation" ? "Checkpoint" : "Action"}
          {step.capture ? " · Evidence captured" : ""}
          {step.status === "needs-review" ? " · Needs review" : ""}
        </small>
      </button>
      {step.children?.length ? (
        <ol>
          {step.children.map((child, index) => (
            <ReadableStep
              key={child.id}
              step={child}
              number={`${number}.${index + 1}`}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function flattenSteps(steps: readonly ProductTestStep[]): readonly ProductTestStep[] {
  return steps.flatMap((step) => [step, ...flattenSteps(step.children ?? [])]);
}

function formatRunDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}
