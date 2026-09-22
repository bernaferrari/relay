import { TestRunHistory } from "./test-run-history";
import { TestStepsOutline } from "./test-steps-outline";
import { flattenSteps } from "./saved-test-steps";
import { runSetupContinuation } from "../data/setup-continuation";
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@relay/ui-react/components/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@relay/ui-react/components/tabs";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Camera, ChevronLeft, MoreHorizontal, SlidersHorizontal } from "lucide-react";
import { type MouseEvent, useEffect, useRef, useState } from "react";
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
import { productLinkClassName } from "../lib/class-names";

const routeApi = getRouteApi("/tests/$testId");

export function TestPage() {
  const { runService, platform, queryClient } = useRouteContext({
    from: "__root__",
  });
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
  const [setupAnchor, setSetupAnchor] = useState<HTMLElement | null>(null);
  const configurationTriggerRef = useRef<HTMLButtonElement>(null);

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
    if (search.setup === "run") setSetupAnchor(configurationTriggerRef.current);
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
    targetOptions: targets.data?.map((target) => ({
      id: target.targetId,
      label: target.name,
    })),
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
  // The resolved configuration determines the meaning of everything a Run
  // produces, so it stays visible beside Run — not folded into a hidden
  // settings popover (product direction: one configuration contract).
  const selectedProfile = profiles.data?.find(
    (profile) => profile.id === configuration.selection.savedProfileId,
  );
  const configurationLabel = usePairs
    ? `${paired.workspace.rows.length} paired configurations`
    : selectedProfile
      ? selectedProfile.account
        ? `${selectedProfile.name} · ${selectedProfile.account.name}`
        : selectedProfile.name
      : (targets.data?.find((target) => target.targetId === targetId)?.name ??
        "Choose device or browser");
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
          queryClient.setQueryData(runQueryKeys.pointer, {
            workflowId,
            runId,
            testId,
          });
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
        void navigate({
          to: "/batches/$batchId",
          params: { batchId: state.batchId },
        });
        return;
      }
      const runId = state.run?.runId;
      if (runId && startedForTestId.current === testIdRef.current) {
        setSettingsOpen(false);

        setPinnedRunId(runId);
        void navigate({
          search: (previous) => ({
            ...previous,
            setup: undefined,
            run: runId,
            view: "run",
          }),
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
    configuration.setSelection({
      ...selectionRef.current,
      targetId: decision.targetId,
    });
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

  function focusRunSetup(event: MouseEvent<HTMLButtonElement>) {
    setSetupAnchor(event.currentTarget);
    selectSource("definition");
    setSettingsOpen(true);
  }

  function runOrFocusSetup(event: MouseEvent<HTMLButtonElement>) {
    if (!canStart) {
      focusRunSetup(event);
      return;
    }
    start.mutate();
  }

  return (
    <WorkbenchPage className="flex h-full min-h-0 flex-col overflow-auto !p-0">
      <header className="shrink-0 px-5 pt-3 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button nativeButton={false} render={<Link to="/tests" />} variant="ghost" size="sm">
            <ChevronLeft aria-hidden="true" />
            Tests
          </Button>
          <div className="contents sm:flex sm:shrink-0 sm:items-center sm:gap-2">
            {!activeRun ? (
              <Button
                variant="outline"
                size="sm"
                onClick={focusRunSetup}
                ref={configurationTriggerRef}
                aria-label="Run configuration — opens run setup"
                className="order-3 w-full max-w-full justify-start sm:order-none sm:w-auto sm:max-w-64"
              >
                <SlidersHorizontal className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{configurationLabel}</span>
              </Button>
            ) : null}
            {activeRun && attachedRunId ? (
              <Button
                nativeButton={false}
                render={<Link to="/runs/$runId" params={{ runId: attachedRunId }} />}
                size="sm"
              >
                View live run
              </Button>
            ) : (
              <Button size="sm" onClick={runOrFocusSetup} disabled={start.isPending}>
                {start.isPending
                  ? "Starting…"
                  : canStart
                    ? "Run now"
                    : profileBlocker
                      ? "Fix setup"
                      : "Set up run"}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="sm" />}
                aria-label="More Test actions"
              >
                <MoreHorizontal aria-hidden="true" /> More
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem render={<Link to="/tests/$testId/edit" params={{ testId }} />}>
                  Edit Test
                </DropdownMenuItem>
                {!activeRun && test.data ? (
                  <DropdownMenuItem
                    render={<Link to="/tests/$testId/run-across" params={{ testId }} />}
                  >
                    Run across…
                  </DropdownMenuItem>
                ) : null}
                {attachedRunId ? (
                  <DropdownMenuItem
                    render={<Link to="/runs/$runId" params={{ runId: attachedRunId }} />}
                  >
                    Open full report
                  </DropdownMenuItem>
                ) : null}
                {recentRuns.data?.length ? (
                  <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
                    Run history
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="mt-4 min-w-0 space-y-1">
          <h1 className="text-xl leading-snug font-semibold tracking-tight break-words sm:text-2xl">
            {test.data?.name ?? "Test"}
          </h1>
          {test.data?.appName ? (
            <p className="text-sm text-muted-foreground">{test.data.appName}</p>
          ) : null}
        </div>
      </header>

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
            <Link className={productLinkClassName} to="/tests">
              Browse saved Tests
            </Link>
          }
        />
      ) : null}

      {!test.isPending && test.data ? (
        <Tabs
          value={showRecording ? "definition" : "run"}
          onValueChange={(value) => selectSource(value === "run" ? "run" : "definition")}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="shrink-0 border-b border-border px-4">
            <TabsList variant="line" aria-label="Test views" className="h-11">
              <TabsTrigger value="definition" className="px-4">
                Test
              </TabsTrigger>
              <TabsTrigger value="run" disabled={!attachedRunId} className="px-4">
                Result
              </TabsTrigger>
            </TabsList>
          </div>
          {!showRecording && attachedRunId ? (
            <TabsContent value="run" className="min-h-0 overflow-auto p-3">
              <RunInspection key={attachedRunId} runId={attachedRunId} testId={testId} embedded />
            </TabsContent>
          ) : (
            <TabsContent value="definition" className="flex min-h-0 flex-col">
              <SavedTestWorkspace
                settingsAnchor={setupAnchor}
                onSettingsAnchorChange={setSetupAnchor}
                settingsOpen={settingsOpen}
                onSettingsOpenChange={setSettingsOpen}
                deviceName={configurationLabel}
                outline={
                  <TestStepsOutline
                    title={outlineCopy.title}
                    {...(outlineCopy.hint ? { hint: outlineCopy.hint } : {})}
                    steps={test.data.steps ?? []}
                    selectedId={selectedEvidenceStep?.id}
                    onSelect={setEvidenceStepId}
                  />
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
                              {canStart ? "Run and capture" : "Choose device or browser"}
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
                        selection={{
                          ...configuration.selection,
                          targetProfileId: targetId,
                        }}
                        onSelectionChange={(selection) => {
                          const { targetProfileId: selectedTargetId, ...rest } = selection;
                          configuration.setSelection({
                            ...rest,
                            targetId: selectedTargetId,
                          });
                        }}
                        loading={configuration.loading || targets.isPending}
                        error={scope.error ?? configuration.error}
                        onRetry={scope.error ? scope.retry : configuration.retry}
                      >
                        {profiles.data?.length ? (
                          <SelectField
                            label="Saved setup"
                            value={configuration.selection.savedProfileId ?? "automatic"}
                            options={[
                              { value: "automatic", label: "Use device defaults" },
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
                        {profiles.data?.length ? (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            A saved setup applies its account and run settings to this Test.
                          </p>
                        ) : null}
                        {selectedProfile?.account ? (
                          <p className="grid gap-1 text-xs leading-4 text-muted-foreground">
                            Runs as {selectedProfile.account.name} using its saved browser sign-in.
                            <Link
                              className={productLinkClassName}
                              to="/environments"
                              search={{ returnTo: runSetupContinuation(testId) }}
                            >
                              Refresh sign-in
                            </Link>
                          </p>
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
                              <Link className={productLinkClassName} to="/devices">
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
            </TabsContent>
          )}
        </Tabs>
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
