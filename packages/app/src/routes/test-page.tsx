import { WorkspaceToolbar } from "../components/test-workspace";
import { TestPlanNavigation } from "./test-plan-navigation";
import { TestRunHistory } from "./test-run-history";
import { TestStepsOutline } from "./test-steps-outline";
import { flattenSteps } from "./saved-test-steps";
import { TestEditor, recentAccountIds } from "./edit-test-page";
import type { PreparedBrowserRecording } from "./test-editor-browser-pane";
import { rememberRecordingInto } from "../data/record-into-test";
import { writeWorkflowPointer } from "../data/workflow-pointer";
import { recordingQueryKeys } from "../data/recording-queries";
/** @jsxImportSource react */
import { useTestRunSetup } from "../data/use-test-run-setup";
import { runSetupProfile } from "../data/run-setup-profile";
import { catalogQueryKeys } from "../data/catalog-queries";
import { WorkbenchPage } from "../components/page-layout";
import { Button } from "@relay/ui-react/components/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@relay/ui-react/components/tabs";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "../components/product-patterns";
import { runQueryKeys } from "../data/run-queries";
import { AmbiguousTestError } from "../data/run-product-service";
import { ChooseTestApp } from "./choose-test-app";
import { TestLastRunLine, latestRunOf } from "./test-last-run";
import { readRunPointer, writeRunPointer } from "../data/run-pointer";
import {
  stabilitySamplesFromRuns,
  summarizeProductStability,
} from "../data/stability-product-service";
import { useLatestTestReport } from "../hooks/use-latest-test-report";
import { PageLoading, RecordingProblem } from "./recording-shared";
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
import { TestRunSettings } from "./test-run-settings";
import { TestWorkspaceActions } from "./test-workspace-actions";
import { TestWorkspaceStage } from "./test-stage";
import { productLinkClassName } from "../lib/class-names";
import { testRunDestinationCopy } from "../data/test-run-targets";
import { useTestTextInputs } from "../data/use-test-text-inputs";
import { isDeviceTest } from "./test-editor-route-helpers";

const routeApi = getRouteApi("/tests/$testId");
const staleTestMessage = "The saved test changed.";

export function TestPage() {
  const { runService, platform, queryClient, productService, testEditorService } = useRouteContext({
    from: "__root__",
  });
  const { testId } = routeApi.useParams();
  const search = routeApi.useSearch() as {
    run?: unknown;
    step?: unknown;
    view?: unknown;
    setup?: unknown;
    target?: unknown;
    plan?: unknown;
    planApp?: unknown;
    app?: unknown;
  };
  const appScope = typeof search.app === "string" && search.app ? search.app : undefined;
  const reviewRecordingId = useTestDocumentReview(platform, search.view);
  const navigate = useNavigate({ from: "/tests/$testId" });
  const [setupAnchor, setSetupAnchor] = useState<HTMLElement | null>(null);
  const [devicePreviewBusy, setDevicePreviewBusy] = useState(false);
  const [preparedBrowserState, setPreparedBrowserState] = useState<
    (PreparedBrowserRecording & { testId: string }) | undefined
  >();
  const preparedBrowser =
    preparedBrowserState?.testId === testId ? preparedBrowserState : undefined;
  const setPreparedBrowser = useCallback(
    (browser: PreparedBrowserRecording | undefined) =>
      setPreparedBrowserState(browser ? { ...browser, testId } : undefined),
    [testId],
  );
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
  const [detailsRequest, setDetailsRequest] = useState(0);
  useEffect(() => {
    setSettingsOpen(search.setup === "run");
    if (search.setup === "run") setSetupAnchor(configurationTriggerRef.current);
  }, [search.setup, testId]);
  const [evidenceStepId, setEvidenceStepId] = useState("");
  const editorScopeKey = `${appScope ?? "unscoped"}:${testId}`;
  const [editing, setEditing] = useState<{
    key: string;
    state: "loading" | "dirty" | "saving" | "saved" | "failed";
  }>({ key: editorScopeKey, state: "loading" });
  const editorState = editing.key === editorScopeKey ? editing.state : "loading";
  const onEditorStateChange = useCallback(
    (state: typeof editing.state) =>
      setEditing((current) =>
        current.key === editorScopeKey && current.state === state
          ? current
          : { key: editorScopeKey, state },
      ),
    [editorScopeKey],
  );
  const searchRunId = typeof search.run === "string" ? search.run : undefined;
  const [pinnedRunId, setPinnedRunId] = useState<string | undefined>(searchRunId);
  const [startingRun, setStartingRun] = useState<{ testId: string; runId: string }>();
  const startedForTestId = useRef<string | undefined>(undefined);
  const testIdRef = useRef(testId);
  testIdRef.current = testId;
  const test = useQuery({
    queryKey: runQueryKeys.test(testId, appScope),
    queryFn: () => runService.getTest(testId, appScope),
    retry: (count, error) => !(error instanceof AmbiguousTestError) && count < 2,
  });
  const { recentRuns } = useLatestTestReport(runService, testId, appScope);
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
  const builds = useQuery({
    queryKey: ["run-config", "builds"],
    queryFn: () => runService.listBuilds?.() ?? Promise.resolve([]),
    enabled: typeof runService.listBuilds === "function",
    staleTime: 15_000,
  });
  const recordingTargetId = typeof search.target === "string" ? search.target : undefined;
  // A Test usually runs where it ran last time; start there instead of asking.
  const lastRunTargetId = [...(recentRuns.data ?? [])]
    .sort((left, right) => right.queuedAt - left.queuedAt)
    .find((run) => run.executionIdentity?.deviceId)?.executionIdentity?.deviceId;
  const { targets, profiles, editorDocument, recordedPlatforms, scope, configuration } =
    useTestRunSetup({
      platform,
      testId,
      appMapId: test.data?.appMapId,
      recordedProfileId: test.data?.recordedProfileId,
      requestedTargetId: recordingTargetId,
      lastRunTargetId,
      lastRunTargetPending: recentRuns.isEnabled && recentRuns.isPending,
      discoverAlternatives: settingsOpen,
      runService,
      testEditorService,
    });
  const targetId = configuration.selection.targetId ?? "";
  const textInputs = useTestTextInputs(editorDocument.data, testEditorService);
  const targetReady = Boolean(targets.data?.some((target) => target.targetId === targetId));
  const selectedProfile = runSetupProfile(
    profiles.data,
    targetId,
    configuration.selection.savedProfileId,
  );
  const admission = startConfigurationAdmission({
    savedProfileId:
      configuration.selection.savedProfileId ??
      (selectedProfile?.account ? selectedProfile.id : undefined),
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
  const pairedPlatformReady = !recordedPlatforms || recordedPlatforms.includes("browser");
  const selectedTarget = targets.data?.find((target) => target.targetId === targetId);
  const selectedBuild = builds.data?.find((build) => build.id === configuration.selection.buildId);
  const configurationLabel = usePairs
    ? `${paired.workspace.rows.length} paired configurations`
    : selectedTarget
      ? [
          selectedTarget.name,
          selectedProfile?.account?.name ??
            (configuration.selection.savedProfileId ? selectedProfile?.name : undefined),
          configuration.selection.buildId
            ? (selectedBuild?.name ?? "Selected build unavailable")
            : "Current build",
          configuration.selection.startupMode === "cold" ? "Restart app" : undefined,
        ]
          .filter(Boolean)
          .join(" · ")
      : testRunDestinationCopy(recordedPlatforms).placeholder;
  const canStart =
    (usePairs ? pairedPlatformReady && paired.workspace.rows.length > 0 : targetReady) &&
    !configuration.loading &&
    admission.status === "ready" &&
    textInputs.ready &&
    !(usePairs && Object.keys(textInputs.variables).length) &&
    editorState === "saved";
  const start = useMutation({
    mutationFn: async () => {
      if (!test.data || !canStart) {
        throw new TypeError(
          admission.blockers[0]?.detail ?? "Choose a ready device or browser for this run.",
        );
      }
      const acknowledged = queryClient.getQueryData<{ revision: number }>([
        "test-editor",
        testId,
        test.data.appMapId,
      ]);
      const current = await testEditorService.get(testId, test.data.appMapId);
      if (!acknowledged || !current || current.revision !== acknowledged.revision) {
        throw new TypeError(staleTestMessage);
      }
      return startOwnedTestRun({
        requests: testStartRequests({
          usePairedWorkspace: usePairs,
          workspace: paired.workspace,
          testId,
          appMapId: test.data.appMapId,
          documentRevision: acknowledged.revision,
          targetId,
          targetProfileId: admission.start.targetProfileId,
          profiles: profiles.data,
          variables: textInputs.variables,
          sourceRevision: admission.start.sourceRevision,
          startup:
            configuration.selection.startupMode === "cold" ? { mode: "cold" as const } : undefined,
        }),
        start: (request) => runService.start(request),
        inspect: (workflowId) => runService.inspect(workflowId),
        remember: async (durable, workflowId, runId) => {
          setStartingRun({ testId, runId });
          setSettingsOpen(false);
          void queryClient.invalidateQueries({ queryKey: catalogQueryKeys.runs });
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
      setStartingRun(undefined);
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
  const deviceTest = isDeviceTest(selectedTarget?.kind, [
    profiles.data?.find((profile) => profile.id === test.data?.recordedProfileId)?.platform,
    ...(editorDocument.data?.recordedPlatforms ?? []),
  ]);
  // Record more steps into this Test, after the selected step, as its login.
  const record = useMutation({
    mutationFn: async () => {
      if (!test.data || (!preparedBrowser && !targetReady))
        throw new TypeError("Choose a ready device or browser first.");
      if (preparedBrowser && !preparedBrowser.sessionId)
        throw new TypeError("Wait for the live browser to connect before recording.");
      if (preparedBrowser?.busy)
        throw new TypeError("Wait for the current browser action to finish before recording.");
      if (devicePreviewBusy)
        throw new TypeError("Wait for the current device action to finish before recording.");
      const afterStepId = test.data.steps?.some((step) => step.id === evidenceStepId)
        ? evidenceStepId
        : undefined;
      const state = await productService.begin({
        title: `${test.data.name} · added steps`,
        appMapId: test.data.appMapId,
        targetId: preparedBrowser?.targetId ?? targetId,
        ...(preparedBrowser?.sessionId ? { liveSessionId: preparedBrowser.sessionId } : {}),
        ...(preparedBrowser
          ? preparedBrowser.authenticationFixtureId
            ? { authenticationFixtureId: preparedBrowser.authenticationFixtureId }
            : {}
          : selectedProfile?.account
            ? { authenticationFixtureId: selectedProfile.account.id }
            : {}),
      });
      const workflowId = state.snapshot?.workflow?.workflowId;
      if (!workflowId)
        throw new TypeError(state.recovery?.detail ?? "Relay could not start recording.");
      await rememberRecordingInto(platform, workflowId, {
        testId,
        testName: test.data.name,
        appMapId: test.data.appMapId,
        ...(afterStepId ? { afterStepId } : {}),
      });
      await writeWorkflowPointer(platform, workflowId);
      queryClient.setQueryData<string | null>(recordingQueryKeys.pointer, workflowId);
      queryClient.setQueryData<string | null>(recordingQueryKeys.reconciledPointer, workflowId);
      return workflowId;
    },
    onSuccess: (workflowId) =>
      void navigate({ to: "/recordings/$recordingId", params: { recordingId: workflowId } }),
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
  const liveRunId =
    activeRun?.runId ?? (startingRun?.testId === testId ? startingRun.runId : undefined);
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

  const runSettings = (
    <TestRunSettings
      testId={testId}
      textInputs={textInputs}
      activeRun={Boolean(activeRun)}
      targets={targets}
      recordedPlatforms={recordedPlatforms}
      profiles={profiles}
      builds={builds}
      configuration={configuration}
      pairedCount={paired.workspace.rows.length}
      targetId={targetId}
      lastRunTargetId={lastRunTargetId}
      canStart={canStart}
      editorState={editorState}
      profileBlocker={profileBlocker}
      scopeError={scope.error}
      onRetryScope={scope.retry}
      startPending={start.isPending}
      onStart={() => start.mutate()}
    />
  );

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
      {typeof search.plan === "string" && typeof search.planApp === "string" ? (
        <TestPlanNavigation testId={testId} planId={search.plan} appId={search.planApp} />
      ) : null}
      <TestWorkspaceActions
        testId={testId}
        appMapId={test.data?.appMapId}
        testName={test.data?.name}
        testPresent={Boolean(test.data)}
        inPlan={typeof search.plan === "string"}
        activeRun={Boolean(activeRun || liveRunId)}
        attachedRunId={attachedRunId}
        liveRunId={liveRunId}
        onOpenDetails={() => setDetailsRequest((count) => count + 1)}
        startPending={start.isPending}
        configurationLabel={configurationLabel}
        configurationName={
          usePairs
            ? `${paired.workspace.rows.length} configuration${paired.workspace.rows.length === 1 ? "" : "s"}`
            : [
                selectedProfile?.account?.name ??
                  (configuration.selection.savedProfileId ? selectedProfile?.name : undefined),
                selectedTarget?.name,
                configuration.selection.buildId
                  ? (selectedBuild?.name ?? "Build unavailable")
                  : undefined,
                configuration.selection.startupMode === "cold" ? "Restart app" : undefined,
              ]
                .filter(Boolean)
                .join(" · ") || "Run settings"
        }
        profileBlocked={Boolean(profileBlocker)}
        onRun={runOrFocusSetup}
        settingsOpen={settingsOpen}
        onSettingsOpen={setSettingsOpen}
        configurationTriggerRef={configurationTriggerRef}
        runSettings={runSettings}
        hasRecentRuns={Boolean(recentRuns.data?.length)}
        onHistoryOpen={() => setHistoryOpen(true)}
      />

      {loading ? <PageLoading label="Loading the test and available devices…" /> : null}
      {test.error instanceof AmbiguousTestError ? (
        <ChooseTestApp testId={testId} owners={test.error.owners} />
      ) : null}
      <RecordingProblem
        className="mx-4 my-3 !mt-3 !max-w-none"
        operation="run"
        error={(test.error instanceof AmbiguousTestError ? null : test.error) ?? targets.error}
        onRetry={() => {
          if (test.isError) void test.refetch();
          if (targets.isError) void targets.refetch();
        }}
        retrying={test.isFetching || targets.isFetching}
      />
      <RecordingProblem
        className="mx-4 my-3 !mt-3 !max-w-none"
        error={record.error}
        action={
          <Button size="sm" variant="outline" onClick={() => record.reset()}>
            Dismiss
          </Button>
        }
      />
      <RecordingProblem
        className="mx-4 my-3 !mt-3 !max-w-none"
        operation="run"
        error={start.error}
        testContext={{ testId, appMapId: test.data?.appMapId }}
        recovery={
          start.error instanceof TypeError && start.error.message === staleTestMessage
            ? {
                code: "test-document-changed",
                title: "Saved test changed",
                detail: staleTestMessage,
                recovery: "Reload to review its latest steps.",
                retryable: false,
              }
            : start.data?.recovery
        }
        action={
          start.error instanceof TypeError && start.error.message === staleTestMessage ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                start.reset();
                setSettingsOpen(false);
                selectSource("definition");
                void queryClient.invalidateQueries({
                  queryKey: ["test-editor", testId, test.data?.appMapId],
                });
              }}
            >
              Reload test
            </Button>
          ) : start.data?.recovery?.sourceCode === "raw-evidence-variant-recapture-required" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                start.reset();
                setSettingsOpen(false);
                selectSource("definition");
              }}
            >
              Review steps
            </Button>
          ) : start.error || start.data?.recovery?.code === "mutation-outcome-unknown" ? (
            <Button nativeButton={false} variant="outline" size="sm" render={<Link to="/runs" />}>
              Check run status
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={(event) => {
                start.reset();
                focusRunSetup(event);
              }}
            >
              Review run setup
            </Button>
          )
        }
      />

      {!loading && !test.data && !test.isError ? (
        <EmptyState
          title="This test is not available"
          detail="It may have been removed or may belong to another app. Choose a saved test to continue."
          action={
            <Link className={productLinkClassName} to="/tests">
              Browse saved tests
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
          {/* A never-run test has no tab row: nothing to switch to or report. */}
          {attachedRunId || activeRun || liveRunId || !recentRuns.isSuccess ? (
            <WorkspaceToolbar
              leading={
                attachedRunId ? (
                  <TabsList variant="line" aria-label="Test views" className="h-11">
                    <TabsTrigger value="definition" className="px-4">
                      Test
                    </TabsTrigger>
                    <TabsTrigger value="run" className="px-4">
                      Result
                    </TabsTrigger>
                  </TabsList>
                ) : null
              }
              trailing={
                showRecording ? (
                  <TestLastRunLine history={recentRuns} running={Boolean(activeRun || liveRunId)} />
                ) : undefined
              }
            />
          ) : null}
          {attachedRunId ? (
            <TabsContent
              value="run"
              className="flex min-h-0 flex-1 flex-col overflow-hidden [&[hidden]]:hidden"
            >
              <RunInspection key={attachedRunId} runId={attachedRunId} testId={testId} embedded />
            </TabsContent>
          ) : null}
          <TabsContent
            value="definition"
            keepMounted
            className="flex min-h-0 flex-1 flex-col [&[hidden]]:hidden"
          >
            <TestEditor
              testId={testId}
              appMapId={test.data.appMapId}
              onEditingStateChange={onEditorStateChange}
              stepId={typeof search.step === "string" ? search.step : undefined}
              onStepChange={(step) =>
                void navigate({ search: (previous) => ({ ...previous, step }), replace: true })
              }
              onSelectedStepChange={(step) => setEvidenceStepId(step ?? "")}
              detailsRequest={detailsRequest}
              recordSteps={{
                onRecord: () => record.mutate(),
                pending: record.isPending,
                disabled:
                  record.isPending ||
                  devicePreviewBusy ||
                  Boolean(preparedBrowser?.busy) ||
                  (!preparedBrowser && !targetReady),
              }}
              stage={
                <TestWorkspaceStage
                  key={testId}
                  step={selectedEvidenceStep}
                  lastRun={latestRunOf(recentRuns.data)}
                  deviceTest={deviceTest}
                  target={selectedTarget}
                  onDeviceBusyChange={setDevicePreviewBusy}
                  browser={
                    editorDocument.data
                      ? {
                          appMapId: editorDocument.data.appMapId,
                          startUrl: editorDocument.data.test.originApplication,
                          browserTargetIds: editorDocument.data.browserTargetIds,
                          recentAccountIds: recentAccountIds(recentRuns.data),
                          onPreparedBrowserChange: setPreparedBrowser,
                        }
                      : undefined
                  }
                />
              }
            />
          </TabsContent>
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
