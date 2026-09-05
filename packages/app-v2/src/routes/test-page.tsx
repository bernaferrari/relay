/** @jsxImportSource react */
import { RunConfigurationComposer } from "../components/run-configuration-composer";
import {
  usePersistedRunConfiguration,
  useRunConfigurationKey,
} from "../data/use-persisted-run-configuration";
import { WorkbenchPage, PageHeader, WorkbenchPanes } from "../components/page-layout";
import { Badge } from "@relay/ui-react/components/badge";
import { Button } from "@relay/ui-react/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
  const runSetupRef = useRef<HTMLElement>(null);

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
  const builds = useQuery({
    queryKey: ["run-config", "builds"],
    queryFn: () => runService.listBuilds?.() ?? Promise.resolve([]),
    enabled: typeof runService.listBuilds === "function",
    staleTime: 15_000,
  });
  const profiles = useQuery({
    queryKey: ["run-config", "profiles", test.data?.appMapId],
    queryFn: () => runService.listProfiles?.(test.data!.appMapId) ?? Promise.resolve([]),
    enabled: Boolean(test.data?.appMapId && runService.listProfiles),
    staleTime: 15_000,
  });
  const scope = useRunConfigurationKey(platform, `test-run:${testId}`, test.data?.appMapId);
  const configuration = usePersistedRunConfiguration({
    storage: platform.storage,
    key: scope.key,
    targetOptions: targets.data?.map((target) => ({ id: target.targetId, label: target.name })),
  });
  useEffect(() => {
    if (configuration.pristine && targets.data?.length === 1)
      configuration.setSelection({ targetId: targets.data[0]!.targetId });
  }, [configuration.pristine, configuration.setSelection, targets.data]);
  const targetId = configuration.selection.targetId ?? "";
  const targetReady = Boolean(targets.data?.some((target) => target.targetId === targetId));
  useEffect(() => {
    // A saved profile is bound to one concrete runtime target. Clear a stale
    // persisted profile before start when the user changes targets; otherwise
    // the visible target and frozen targetProfileId would describe different
    // executions and the server would reject the request late.
    if (profiles.data === undefined || !configuration.selection.savedProfileId) return;
    const selectedProfile = profiles.data.find(
      (profile) => profile.id === configuration.selection.savedProfileId,
    );
    if (selectedProfile?.targetId === targetId) return;
    configuration.setSelection({
      ...configuration.selection,
      savedProfileId: undefined,
    });
  }, [configuration.selection, configuration.setSelection, profiles.data, targetId]);
  const selectedBuild = builds.data?.find(
    (build) => build.id === configuration.selection.buildId && build.status === "ready",
  );
  const start = useMutation({
    mutationFn: async () => {
      if (!test.data || !targetReady || configuration.loading) {
        throw new TypeError("Choose a ready device or browser for this Run.");
      }
      const started = await runService.start({
        testId,
        appMapId: test.data.appMapId,
        targetId,
        ...(configuration.selection.savedProfileId
          ? { targetProfileId: configuration.selection.savedProfileId }
          : {}),
        ...(selectedBuild?.sourceSha && /^[0-9a-f]{7,40}$/u.test(selectedBuild.sourceSha)
          ? {
              sourceRevision: {
                vcs: "git",
                sha: selectedBuild.sourceSha,
                buildId: selectedBuild.id,
              },
            }
          : {}),
        ...(configuration.selection.startupMode === "cold"
          ? { startup: { mode: "cold" as const } }
          : {}),
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

  function focusRunSetup() {
    runSetupRef.current?.scrollIntoView({ behavior: "auto", block: "center" });
    runSetupRef.current?.focus({ preventScroll: true });
  }

  function runOrFocusSetup() {
    if (!targetReady || configuration.loading) {
      focusRunSetup();
      return;
    }
    start.mutate();
  }

  return (
    <WorkbenchPage className="relay-test-page">
      <Breadcrumbs
        items={[{ label: "Tests", to: "/tests" }, { label: test.data?.name ?? "Test" }]}
      />
      <PageHeader
        title={test.data?.name ?? "Test"}
        context={
          <>
            <span>{test.data?.appName}</span>
            <span>Saved Test</span>
          </>
        }
        actions={
          <>
            {activeRun ? (
              <Button
                nativeButton={false}
                render={<Link to="/runs/$runId" params={{ runId: activeRun.runId }} />}
                variant="default"
                size="sm"
              >
                Resume Run
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={runOrFocusSetup}
                disabled={start.isPending}
              >
                {start.isPending
                  ? "Starting…"
                  : targetReady && !configuration.loading
                    ? "Run Test"
                    : "Set up Run"}
              </Button>
            )}
            <Button
              nativeButton={false}
              render={<Link to="/tests/$testId/edit" params={{ testId }} />}
              variant="ghost"
              size="sm"
            >
              Edit
            </Button>
          </>
        }
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
            <Link
              className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
              to="/tests"
            >
              Browse saved Tests
            </Link>
          }
        />
      ) : null}

      {activeRun ? (
        <div className="relay-resume-recording relay-resume-run mt-7 flex max-w-3xl flex-wrap items-center justify-between gap-5 rounded-lg border border-border bg-card px-4 py-3.5 [&_p]:mt-1 [&_p]:text-muted-foreground">
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
            <section
              className="relay-test-overview min-w-0 pt-1"
              aria-labelledby="test-overview-title"
            >
              <div className="flex items-end justify-between gap-5 max-[620px]:items-start max-[620px]:gap-3">
                <div>
                  <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                    Journey
                  </p>
                  <h2 id="test-overview-title">Saved steps</h2>
                </div>
                <span>{test.data.stepCount === 1 ? "1 step" : `${test.data.stepCount} steps`}</span>
              </div>
              {test.data.steps?.length ? (
                <ol className="relay-test-readable-steps mt-4 grid list-none gap-0 p-0">
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
                <p className="relay-test-no-steps mt-4 text-sm text-muted-foreground">
                  This Test has no reviewed steps yet.
                </p>
              )}
            </section>
          }
          stage={
            <>
              {selectedEvidenceStep ? (
                <TestStepEvidencePreview
                  step={selectedEvidenceStep}
                  report={latestReport.data}
                  hasRuns={Boolean(recentRuns.data?.length)}
                  loading={reportLoading}
                />
              ) : null}
            </>
          }
          inspector={
            !activeRun && !targets.isError ? (
              <section
                ref={runSetupRef}
                id="test-run-setup"
                tabIndex={-1}
                className="scroll-mt-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                aria-labelledby="test-run-setup-title"
              >
                <h2 id="test-run-setup-title" className="sr-only">
                  Run setup
                </h2>
                <RunConfigurationComposer
                  configuration={{
                    values: {
                      targetName: targets.data?.find((target) => target.targetId === targetId)
                        ?.name,
                    },
                    validated: targetReady && !configuration.loading,
                    blockers: configuration.targetUnavailable
                      ? [
                          {
                            id: "target",
                            label: "Saved target is unavailable",
                            detail: "Choose a ready device or browser to continue.",
                          },
                        ]
                      : [],
                  }}
                  targetOptions={targets.data?.map((target) => ({
                    id: target.targetId,
                    label: targetLabel(target).title,
                    detail: targetLabel(target).detail,
                  }))}
                  selection={{ ...configuration.selection, targetProfileId: targetId }}
                  onSelectionChange={(selection) => {
                    const { targetProfileId: selectedTargetId, ...rest } = selection;
                    configuration.setSelection({ ...rest, targetId: selectedTargetId });
                  }}
                  loading={configuration.loading}
                  error={scope.error ?? configuration.error}
                  onRetry={scope.error ? scope.retry : configuration.retry}
                >
                  {profiles.data?.filter((profile) => profile.targetId === targetId).length ? (
                    <label className="grid gap-1 text-sm">
                      <span className="text-xs text-muted-foreground">Saved profile</span>
                      <select
                        className="min-h-11 rounded-md border border-border bg-background px-3"
                        value={configuration.selection.savedProfileId ?? ""}
                        onChange={(event) =>
                          configuration.setSelection({
                            ...configuration.selection,
                            savedProfileId: event.target.value || undefined,
                          })
                        }
                      >
                        <option value="">Let Relay select the reviewed profile</option>
                        {profiles.data
                          ?.filter((profile) => profile.targetId === targetId)
                          .map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name}
                              {profile.account ? ` · ${profile.account.name}` : ""}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : null}
                  {builds.data?.length ? (
                    <label className="grid gap-1 text-sm">
                      <span className="text-xs text-muted-foreground">Build</span>
                      <select
                        className="min-h-11 rounded-md border border-border bg-background px-3"
                        value={configuration.selection.buildId ?? ""}
                        onChange={(event) =>
                          configuration.setSelection({
                            ...configuration.selection,
                            buildId: event.target.value || undefined,
                          })
                        }
                      >
                        <option value="">Use current target build</option>
                        {builds.data
                          .filter((build) => build.status === "ready" && build.sourceSha)
                          .map((build) => (
                            <option key={build.id} value={build.id}>
                              {build.name} · {build.sourceSha?.slice(0, 12)}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={configuration.selection.startupMode === "cold"}
                      onChange={(event) =>
                        configuration.setSelection({
                          ...configuration.selection,
                          startupMode: event.target.checked ? "cold" : undefined,
                        })
                      }
                    />
                    Start from a cold app launch
                  </label>
                  {!targets.data?.length ? (
                    <EmptyState
                      title="No device or browser is ready"
                      detail="Connect a target to continue with this Test."
                      action={
                        <Link
                          className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
                          to="/devices"
                        >
                          View devices
                        </Link>
                      }
                    />
                  ) : null}
                  {!targetReady || configuration.loading ? (
                    <div className="flex flex-wrap items-center gap-2">
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
                  ) : null}
                </RunConfigurationComposer>
              </section>
            ) : undefined
          }
        />
      ) : null}

      {!loading && test.data && recentRuns.data?.length ? (
        <Collapsible className="mt-8 border-t border-border pt-4">
          <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-4 rounded-md py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
            <span>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                History
              </span>
              <span className="block text-base font-semibold text-foreground">
                Reliability and recent Runs
              </span>
              <span className="sr-only">
                Recent stability ·{" "}
                {stabilityHistoryComplete ? "Complete history" : "Partial history"}
                {stability?.signals.length
                  ? stability.signals.map((signal) => signal.summary).join(" ")
                  : " Rates stay hidden until complete history is available."}
              </span>
            </span>
            <span className="flex items-center gap-2 text-xs">
              <Badge variant="secondary">
                {stabilityHistoryComplete ? "Complete history" : "Partial history"}
              </Badge>
              <span>Expand</span>
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <div className="grid gap-7 md:grid-cols-2">
              <section className="min-w-0" aria-labelledby="test-stability-title">
                <div className="flex items-end justify-between gap-5 max-[620px]:items-start max-[620px]:gap-3">
                  <div>
                    <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                      Reliability
                    </p>
                    <h2 id="test-stability-title">Recent stability</h2>
                  </div>
                  <Badge
                    variant="secondary"
                    className={
                      stability?.signals.length
                        ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                        : undefined
                    }
                  >
                    {stabilityHistoryComplete ? "Complete history" : "Partial history"}
                  </Badge>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2">
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
                  <ul className="mt-3 grid gap-1.5 pl-4 text-xs text-muted-foreground">
                    {stability.signals.map((signal) => (
                      <li key={`${signal.kind}:${signal.environmentId ?? "all"}`}>
                        {signal.summary}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    Relay has not found a repeated stability signal in the loaded Runs. Rates stay
                    hidden until complete history is available.
                  </p>
                )}
              </section>

              <section className="min-w-0" aria-labelledby="test-runs-title">
                <div className="flex items-end justify-between gap-5 max-[620px]:items-start max-[620px]:gap-3">
                  <div>
                    <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                      Reports
                    </p>
                    <h2 id="test-runs-title">Recent Runs</h2>
                  </div>
                  <Link
                    className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
                    to="/runs"
                    search={{ view: "all", test: testId }}
                  >
                    View all Runs
                  </Link>
                </div>
                <ul className="mt-4 grid list-none gap-0 p-0">
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
          </CollapsibleContent>
        </Collapsible>
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
    <li
      className="grid grid-cols-[44px_minmax(0,1fr)] border-t border-border data-[selected=true]:bg-muted/50 data-[selected=true]:shadow-[2px_0_0_var(--foreground)_inset]"
      data-selected={selectedId === step.id}
    >
      <span className="grid place-items-center text-[11px] tabular-nums text-muted-foreground">
        {number}
      </span>
      <button
        className="min-w-0 rounded-md px-0 py-3 text-left"
        type="button"
        aria-pressed={selectedId === step.id}
        onClick={() => onSelect(step.id)}
      >
        <strong className="block pt-0.5 text-[13px] font-semibold">{step.intent}</strong>
        <small className="mt-0.5 block text-[11px] text-muted-foreground">
          {step.kind === "validation" ? "Checkpoint" : "Action"}
          {step.capture ? " · Evidence captured" : ""}
          {step.status === "needs-review" ? " · Needs review" : ""}
        </small>
      </button>
      {step.children?.length ? (
        <ol className="col-span-2 ml-5 grid list-none gap-0 p-0">
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
