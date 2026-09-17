import { TestRunHistory } from "./test-run-history";
import { ReadableStep, flattenSteps } from "./saved-test-steps";
import { AuthoringHeader } from "./authoring-header";
import { SavedTestWorkspace } from "./saved-test-workspace";
import { SelectField } from "../components/filter-select";
import { Checkbox } from "@relay/ui-react/components/checkbox";
/** @jsxImportSource react */
import { RunConfigurationComposer } from "../components/run-configuration-composer";
import {
  usePersistedRunConfiguration,
  useRunConfigurationKey,
} from "../data/use-persisted-run-configuration";
import { WorkbenchPage } from "../components/page-layout";
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Camera, ChevronLeft, History } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "../components/product-patterns";
import { TestStepEvidencePreview } from "../components/test-step-evidence-preview";
import { runQueryKeys } from "../data/run-queries";
import { readRunPointer, writeRunPointer } from "../data/run-pointer";
import {
  stabilitySamplesFromRuns,
  summarizeProductStability,
} from "../data/stability-product-service";
import { useLatestTestReport } from "../hooks/use-latest-test-report";
import { PageLoading, RecordingProblem, targetLabel } from "./recording-shared";
import { RunInspection } from "./run-page";
import {
  WORKSPACE_DESTINATION_KEY,
  parseWorkspaceDestination,
  startConfigurationAdmission,
  workspaceDestinationDecision,
  workspaceDestinationQueryKey,
} from "../layout/destination-summary";
import { usePairedConfigurationWorkspace } from "../data/use-paired-configuration-workspace";
import { startOwnedTestRun, testStartRequests } from "../data/start-owned-test-run";
import { useTestDocumentReview } from "../data/test-document-surface";
import { currentTestOutlineCopy } from "../data/workbench-step-selection";
import { ReviewRecordingPage } from "./review-recording-page";

const routeApi = getRouteApi("/tests/$testId");

export function TestPage() {
  const { runService, platform, queryClient } = useRouteContext({ from: "__root__" });
  const { testId } = routeApi.useParams();
  const search = routeApi.useSearch() as {
    run?: unknown;
    step?: unknown;
    view?: unknown;
    setup?: unknown;
    target?: unknown;
  };
  const reviewRecordingId = useTestDocumentReview(platform, search.view);
  const navigate = useNavigate({ from: "/tests/$testId" });
  const runSetupRef = useRef<HTMLElement>(null);

  function selectSource(view: "definition" | "run") {
    void navigate({
      search: (previous) => ({
        ...previous,
        view,
        ...(view === "run" && attachedRunId ? { run: attachedRunId } : {}),
      }),
      replace: true,
    });
  }
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(search.setup === "run");
  useEffect(() => {
    setSettingsOpen(search.setup === "run");
  }, [search.setup, testId]);
  const [evidenceStepId, setEvidenceStepId] = useState("");
  const searchRunId = typeof search.run === "string" ? search.run : undefined;
  const [pinnedRunId, setPinnedRunId] = useState<string | undefined>(searchRunId);
  const startedForTestId = useRef<string | undefined>(undefined);
  const testIdRef = useRef(testId);
  testIdRef.current = testId;
  const test = useQuery({
    queryKey: runQueryKeys.test(testId),
    queryFn: () => runService.getTest(testId),
  });
  const { recentRuns } = useLatestTestReport(runService, testId);
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
  const recordingTargetId = typeof search.target === "string" ? search.target : undefined;
  useEffect(() => {
    if (!configuration.pristine) return;
    if (recordingTargetId) configuration.setSelection({ targetId: recordingTargetId });
    else if (targets.data?.length === 1)
      configuration.setSelection({ targetId: targets.data[0]!.targetId });
  }, [configuration.pristine, configuration.setSelection, recordingTargetId, targets.data]);
  const targetId = configuration.selection.targetId ?? "";
  const targetReady = Boolean(targets.data?.some((target) => target.targetId === targetId));
  const admission = startConfigurationAdmission({
    savedProfileId: configuration.selection.savedProfileId,
    targetId,
    profiles: profiles.isEnabled ? profiles.data : undefined,
    profilesStatus: profiles.isEnabled && profiles.isPending ? "pending" : "success",
    selectedBuildId: configuration.selection.buildId,
    builds: builds.isEnabled ? builds.data : undefined,
    buildsStatus: builds.isEnabled && builds.isPending ? "pending" : "success",
  });
  const profileBlocker = admission.blockers.find((item) => item.id === "saved-profile");
  const paired = usePairedConfigurationWorkspace(platform);
  const usePairs = configuration.selection.usePairedWorkspace === true;
  const canStart =
    (usePairs ? paired.workspace.rows.length > 0 : targetReady) &&
    !configuration.loading &&
    admission.status === "ready";
  const start = useMutation({
    mutationFn: async () => {
      if (!test.data || !canStart) {
        throw new TypeError(
          admission.blockers[0]?.detail ?? "Choose a ready device or browser for this Run.",
        );
      }
      return startOwnedTestRun({
        requests: testStartRequests({
          usePairedWorkspace: usePairs,
          workspace: paired.workspace,
          testId,
          appMapId: test.data.appMapId,
          targetId,
          targetProfileId: admission.start.targetProfileId,
          profiles: profiles.data,
          sourceRevision: admission.start.sourceRevision,
          startup:
            configuration.selection.startupMode === "cold" ? { mode: "cold" as const } : undefined,
        }),
        start: (request) => runService.start(request),
        inspect: (workflowId) => runService.inspect(workflowId),
        remember: async (durable, workflowId, runId) => {
          await writeRunPointer(platform, { workflowId, runId, testId });
          queryClient.setQueryData(runQueryKeys.pointer, { workflowId, runId, testId });
          queryClient.setQueryData(runQueryKeys.workflow(workflowId), durable);
          startedForTestId.current = testId;
        },
        ...(runService.startBatch
          ? { startBatch: (requests) => runService.startBatch!(requests) }
          : {}),
      });
    },
    onSuccess: (state) => {
      if (state.batchId) {
        startedForTestId.current = testId;
        void navigate({ to: "/batches/$batchId", params: { batchId: state.batchId } });
        return;
      }
      const runId = state.run?.runId;
      if (runId && startedForTestId.current === testIdRef.current) {
        setSettingsOpen(false);

        setPinnedRunId(runId);
        void navigate({
          search: (previous) => ({ ...previous, setup: undefined, run: runId, view: "run" }),
          replace: true,
        });
      }
    },
  });
  const workspaceDestination = useQuery({
    queryKey: workspaceDestinationQueryKey,
    queryFn: async () =>
      parseWorkspaceDestination((await platform.storage.get(WORKSPACE_DESTINATION_KEY)) ?? null) ??
      null,
    staleTime: Infinity,
  });
  const appliedDestination = useRef<string | undefined>(undefined);
  const selectionRef = useRef(configuration.selection);
  selectionRef.current = configuration.selection;
  useEffect(() => {
    if (configuration.loading || !targets.data?.length) return;
    if (recordingTargetId && !configuration.restored && !configuration.edited) return;
    const decision = workspaceDestinationDecision({
      storedTargetId: workspaceDestination.data?.targetId,
      lastAppliedTargetId: appliedDestination.current,
      currentTargetId: selectionRef.current.targetId,
      availableTargetIds: targets.data.map((target) => target.targetId),
      origin: configuration.edited
        ? "explicit-user-selection"
        : configuration.restored
          ? "saved-test"
          : "workspace-default",
      protectedTargetId: selectionRef.current.targetId,
    });
    if (decision.kind === "skip") return;
    appliedDestination.current = workspaceDestination.data?.targetId;
    if (decision.kind === "remember") return;
    configuration.setSelection({ ...selectionRef.current, targetId: decision.targetId });
  }, [
    configuration.loading,
    configuration.edited,
    configuration.restored,
    configuration.setSelection,
    targets.data,
    workspaceDestination.data?.targetId,
    recordingTargetId,
  ]);

  useEffect(() => {
    setPinnedRunId(searchRunId);
  }, [testId, searchRunId]);
  useEffect(() => {
    if (searchRunId || pointer.data?.testId !== testId || !pointer.data?.runId) return;
    setPinnedRunId(pointer.data.runId);
    void navigate({
      search: (previous) => ({ ...previous, run: pointer.data!.runId }),
      replace: true,
    });
  }, [navigate, pointer.data?.runId, pointer.data?.testId, searchRunId, testId]);

  // The run pointer is workspace-wide. It should only interrupt the document
  // that owns the run; a run for another Test belongs in Activity, not here.
  const activeRun = pointer.data?.testId === testId ? pointer.data : undefined;
  const attachedRunId =
    pinnedRunId ?? [...(recentRuns.data ?? [])].sort((a, b) => b.queuedAt - a.queuedAt)[0]?.id;
  const showRecording =
    !attachedRunId ||
    search.view === "definition" ||
    (search.view !== "run" && typeof search.run !== "string");
  const outlineCopy = currentTestOutlineCopy({
    stepCount: test.data?.stepCount ?? 0,
    viewingHistoricalRun: false,
  });
  const loading = test.isPending;
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

  if (reviewRecordingId) return <ReviewRecordingPage recordingId={reviewRecordingId} />;

  function focusRunSetup() {
    selectSource("definition");
    setSettingsOpen(true);
    runSetupRef.current?.scrollIntoView({ behavior: "auto", block: "center" });
    runSetupRef.current?.focus({ preventScroll: true });
  }

  function runOrFocusSetup() {
    if (!canStart) {
      focusRunSetup();
      return;
    }
    start.mutate();
  }

  return (
    <WorkbenchPage className="relay-test-page flex h-full min-h-0 flex-col overflow-auto !p-0">
      <AuthoringHeader
        back={
          <Button nativeButton={false} render={<Link to="/tests" />} variant="ghost" size="sm">
            <ChevronLeft aria-hidden="true" />
            Back
          </Button>
        }
        title={test.data?.name ?? "Test"}
        description={test.data?.appName}
        actions={
          <>
            {activeRun ? null : (
              <Button
                variant="default"
                size="sm"
                onClick={runOrFocusSetup}
                disabled={start.isPending}
              >
                {start.isPending
                  ? "Starting…"
                  : canStart
                    ? "Run now"
                    : profileBlocker
                      ? "Fix setup"
                      : "Set up run"}
              </Button>
            )}
            {!activeRun && test.data ? (
              <Button
                nativeButton={false}
                render={<Link to="/tests/$testId/run-across" params={{ testId }} />}
                variant="outline"
                size="sm"
              >
                Run across…
              </Button>
            ) : null}
            {attachedRunId ? (
              <Button
                nativeButton={false}
                render={<Link to="/runs/$runId" params={{ runId: attachedRunId }} />}
                variant={activeRun ? "default" : "ghost"}
                size="sm"
              >
                Open full report
              </Button>
            ) : null}
            {recentRuns.data?.length ? (
              <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
                <History /> History
              </Button>
            ) : null}
            <Button
              nativeButton={false}
              render={<Link to="/tests/$testId/edit" params={{ testId }} />}
              variant="ghost"
              size="sm"
            >
              Edit current Test
            </Button>
          </>
        }
      />

      {loading ? <PageLoading label="Loading the Test and available devices…" /> : null}
      <RecordingProblem
        className="mx-4 my-3 !mt-3 !max-w-none"
        operation="run"
        error={test.error ?? targets.error ?? start.error}
        recovery={start.data?.recovery}
        action={
          start.data?.recovery?.sourceCode === "raw-evidence-variant-recapture-required" ? (
            <Button
              nativeButton={false}
              variant="outline"
              size="sm"
              render={<Link to="/tests/$testId/edit" params={{ testId }} />}
            >
              Review steps
            </Button>
          ) : undefined
        }
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

      {!test.isPending && test.data ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2">
            <div
              className="flex gap-1 rounded-lg bg-muted p-1"
              role="group"
              aria-label="Evidence source"
            >
              <Button
                size="sm"
                aria-pressed={showRecording}
                variant={showRecording ? "secondary" : "ghost"}
                onClick={() => selectSource("definition")}
              >
                Test definition
              </Button>
              <Button
                size="sm"
                aria-pressed={!showRecording}
                disabled={!attachedRunId}
                variant={!showRecording ? "secondary" : "ghost"}
                onClick={() => selectSource("run")}
              >
                Run evidence
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {showRecording ? "Current saved steps" : "Historical execution · saved with this run"}
            </p>
          </div>
          {!showRecording && attachedRunId ? (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <RunInspection key={attachedRunId} runId={attachedRunId} testId={testId} embedded />
            </div>
          ) : (
            <SavedTestWorkspace
              settingsOpen={settingsOpen}
              onSettingsOpenChange={setSettingsOpen}
              deviceName={targets.data?.find((target) => target.targetId === targetId)?.name}
              outline={
                <section
                  className="relay-test-overview min-w-0 p-3"
                  aria-labelledby="test-overview-title"
                  onKeyDown={(event) => {
                    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                    const buttons = [
                      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                        "button[data-step-id]",
                      ),
                    ];
                    if (!buttons.length) return;
                    event.preventDefault();
                    const focused = buttons.findIndex(
                      (button) => button === document.activeElement,
                    );
                    const selected = buttons.findIndex(
                      (button) => button.dataset.stepId === selectedEvidenceStep?.id,
                    );
                    const current = focused >= 0 ? focused : selected;
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? buttons.length - 1
                          : Math.max(
                              0,
                              Math.min(
                                buttons.length - 1,
                                current + (event.key === "ArrowDown" ? 1 : -1),
                              ),
                            );
                    buttons[next]!.focus({ preventScroll: true });
                    buttons[next]!.click();
                    buttons[next]!.scrollIntoView({ block: "nearest" });
                  }}
                >
                  <h2
                    id="test-overview-title"
                    tabIndex={0}
                    className="mb-2 text-[13px] font-medium text-muted-foreground"
                  >
                    {outlineCopy.title}
                  </h2>
                  {outlineCopy.hint ? (
                    <p className="mb-2 text-xs text-muted-foreground">{outlineCopy.hint}</p>
                  ) : null}
                  {test.data.steps?.length ? (
                    <ol className="relay-test-readable-steps mt-3 grid list-none gap-1 p-0">
                      {test.data.steps.map((step, index) => (
                        <ReadableStep
                          key={step.id}
                          step={step}
                          number={String(index + 1)}
                          selectedId={selectedEvidenceStep?.id}
                          onSelect={(id) => {
                            setEvidenceStepId(id);
                          }}
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
                <div className="flex h-full min-h-0 flex-col">
                  <p className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
                    Recording preview
                  </p>
                  <div className="min-h-0 flex-1">
                    {selectedEvidenceStep?.recordingFrames?.length ? (
                      <TestStepEvidencePreview
                        key={selectedEvidenceStep.id}
                        step={selectedEvidenceStep}
                        report={undefined}
                        hasRuns={false}
                        loading={false}
                      />
                    ) : (
                      <div className="grid h-full min-h-0 place-items-center overflow-auto px-6 py-5">
                        <div className="grid max-w-sm justify-items-center gap-3 text-center">
                          <div className="grid size-12 place-items-center rounded-2xl bg-muted">
                            <Camera className="size-5 text-muted-foreground" aria-hidden="true" />
                          </div>
                          <div className="grid gap-1.5">
                            <h2 className="text-base font-semibold">Preview this Test</h2>
                            <p className="text-sm leading-relaxed text-muted-foreground">
                              No recording reference was saved for this step. Run the Test to
                              capture the app and review what happened.
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            onClick={runOrFocusSetup}
                            disabled={start.isPending}
                          >
                            {canStart ? "Run and capture" : "Choose a device"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              }
              inspector={
                !activeRun && !targets.isError ? (
                  <section
                    ref={runSetupRef}
                    id="test-run-setup"
                    tabIndex={-1}
                    className="min-w-0 scroll-mt-6 p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/40 [&_select]:w-full [&_select]:min-w-0"
                    aria-labelledby="test-run-setup-title"
                  >
                    <h2 id="test-run-setup-title" className="sr-only">
                      Run setup
                    </h2>
                    <RunConfigurationComposer
                      variant="plain"
                      pairedWorkspaceLabel={
                        paired.workspace.rows.length
                          ? `Use saved workspace · ${paired.workspace.rows.length} paired configurations`
                          : undefined
                      }
                      configuration={{
                        values: {
                          targetName: targets.data?.find((target) => target.targetId === targetId)
                            ?.name,
                        },
                        validated: canStart,
                        blockers: [
                          ...(configuration.targetUnavailable
                            ? [
                                {
                                  id: "target",
                                  label: "Saved target is unavailable",
                                  detail: "Choose a ready device or browser to continue.",
                                },
                              ]
                            : []),
                          ...(profileBlocker ? [profileBlocker] : []),
                        ],
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
                      loading={configuration.loading || targets.isPending}
                      error={scope.error ?? configuration.error}
                      onRetry={scope.error ? scope.retry : configuration.retry}
                    >
                      {profiles.data?.length ? (
                        <SelectField
                          label="Profile"
                          value={configuration.selection.savedProfileId ?? "automatic"}
                          options={[
                            { value: "automatic", label: "Automatic" },
                            ...profiles.data.map((profile) => ({
                              value: profile.id,
                              label: `${profile.name}${profile.account ? ` · ${profile.account.name}` : ""}${profile.targetId && profile.targetId !== targetId ? " · other device" : ""}`,
                            })),
                          ]}
                          onValueChange={(value) =>
                            configuration.setSelection({
                              ...configuration.selection,
                              savedProfileId: value === "automatic" ? undefined : value,
                            })
                          }
                        />
                      ) : null}
                      {builds.data?.length ? (
                        <SelectField
                          label="Build"
                          value={configuration.selection.buildId ?? "current"}
                          options={[
                            { value: "current", label: "Current build" },
                            ...builds.data
                              .filter((build) => build.status === "ready" && build.sourceSha)
                              .map((build) => ({
                                value: build.id,
                                label: `${build.name} · ${build.sourceSha?.slice(0, 12)}`,
                              })),
                          ]}
                          onValueChange={(value) =>
                            configuration.setSelection({
                              ...configuration.selection,
                              buildId: value === "current" ? undefined : value,
                            })
                          }
                        />
                      ) : null}
                      <label className="flex min-h-11 items-center gap-2 text-sm">
                        <Checkbox
                          checked={configuration.selection.startupMode === "cold"}
                          onCheckedChange={(checked) =>
                            configuration.setSelection({
                              ...configuration.selection,
                              startupMode: checked ? "cold" : undefined,
                            })
                          }
                        />
                        Restart app before running
                      </label>
                      {targets.isPending ? (
                        <PageLoading label="Finding devices…" />
                      ) : !targets.data?.length ? (
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
                      <div className="flex justify-end border-t border-border pt-3">
                        <Button
                          variant="default"
                          onClick={() => start.mutate()}
                          disabled={!canStart || start.isPending}
                        >
                          {start.isPending ? "Starting…" : "Run Test"}
                        </Button>
                      </div>
                    </RunConfigurationComposer>
                  </section>
                ) : undefined
              }
            />
          )}
        </>
      ) : null}

      <TestRunHistory
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        testId={testId}
        name={test.data?.name}
        runs={recentRuns.data ?? []}
        stability={stability}
        historyComplete={stabilityHistoryComplete}
      />
    </WorkbenchPage>
  );
}
