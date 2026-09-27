import { TestWorkspaceHeader, WorkspaceToolbar } from "../components/test-workspace";
import { TestPlanNavigation } from "./test-plan-navigation";
import { TestRunHistory } from "./test-run-history";
import { TestStepsOutline } from "./test-steps-outline";
import { flattenSteps } from "./saved-test-steps";
import { runSetupContinuation } from "../data/setup-continuation";
import { TestEditor, recentAccountIds } from "./edit-test-page";
import { TestEditorBrowserPane } from "./test-editor-browser-pane";
import { Popover, PopoverContent, PopoverTrigger } from "@relay/ui-react/components/popover";
import { rememberRecordingInto } from "../data/record-into-test";
import { writeWorkflowPointer } from "../data/workflow-pointer";
import { recordingQueryKeys } from "../data/recording-queries";
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
import { ChevronLeft, Circle, MoreHorizontal, Play, SlidersHorizontal } from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { EmptyState } from "../components/product-patterns";
import { TestStepEvidencePreview } from "../components/test-step-evidence-preview";
import { runQueryKeys } from "../data/run-queries";
import { AmbiguousTestError } from "../data/run-product-service";
import { ChooseTestApp } from "./choose-test-app";
import { TestLastRunLine, TestLastRunStage, latestRunOf } from "./test-last-run";
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
    queryKey: runQueryKeys.test(testId, appScope),
    queryFn: () => runService.getTest(testId, appScope),
    retry: (count, error) => !(error instanceof AmbiguousTestError) && count < 2,
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
  // A Test usually runs where it ran last time; start there instead of asking.
  const lastRunTargetId = [...(recentRuns.data ?? [])]
    .sort((left, right) => right.queuedAt - left.queuedAt)
    .find((run) => run.executionIdentity?.deviceId)?.executionIdentity?.deviceId;
  useEffect(() => {
    if (!configuration.pristine) return;
    if (profiles.isEnabled && profiles.isPending) return;
    const ready = (id?: string) =>
      Boolean(id && targets.data?.some((target) => target.targetId === id));
    // Run as the login the Test was recorded with, on the same browser.
    const recorded = profiles.data?.find((profile) => profile.id === test.data?.recordedProfileId);
    const recordedLogin = recorded?.account && ready(recorded.targetId) ? recorded : undefined;
    if (recordingTargetId)
      configuration.setSelection({
        targetId: recordingTargetId,
        ...(recordedLogin?.targetId === recordingTargetId
          ? { savedProfileId: recordedLogin.id }
          : {}),
      });
    else if (recordedLogin)
      configuration.setSelection({
        targetId: recordedLogin.targetId!,
        savedProfileId: recordedLogin.id,
      });
    else if (ready(lastRunTargetId)) configuration.setSelection({ targetId: lastRunTargetId! });
    else if (targets.data?.length === 1)
      configuration.setSelection({ targetId: targets.data[0]!.targetId });
  }, [
    configuration.pristine,
    configuration.setSelection,
    lastRunTargetId,
    recordingTargetId,
    targets.data,
    profiles.data,
    profiles.isEnabled,
    profiles.isPending,
    test.data?.recordedProfileId,
  ]);
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
  const selectedTarget = targets.data?.find((target) => target.targetId === targetId);
  const selectedBuild = builds.data?.find((build) => build.id === configuration.selection.buildId);
  const configurationLabel = usePairs
    ? `${paired.workspace.rows.length} paired configurations`
    : selectedTarget
      ? [
          selectedTarget.name,
          selectedProfile?.account?.name ?? selectedProfile?.name,
          configuration.selection.buildId
            ? (selectedBuild?.name ?? "Selected build unavailable")
            : "Current build",
          configuration.selection.startupMode === "cold" ? "Restart app" : undefined,
        ]
          .filter(Boolean)
          .join(" · ")
      : "Choose device or browser";
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
  const editorDocument = useQuery({
    queryKey: ["test-editor", testId],
    queryFn: () => testEditorService.get(testId),
    staleTime: 5_000,
  });
  // Record more steps into this Test, after the selected step, as its login.
  const record = useMutation({
    mutationFn: async () => {
      if (!test.data || !targetReady) throw new TypeError("Choose a ready browser first.");
      const afterStepId = test.data.steps?.some((step) => step.id === evidenceStepId)
        ? evidenceStepId
        : undefined;
      const state = await productService.begin({
        title: `${test.data.name} · added steps`,
        appMapId: test.data.appMapId,
        targetId,
        ...(selectedProfile?.account
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

  const runSettings =
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
              targetName: targets.data?.find((target) => target.targetId === targetId)?.name,
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
            label: `${targetLabel(target).title} · ${
              target.kind === "browser" ? "Browser" : target.platform === "ios" ? "iOS" : "Android"
            }${target.targetId === lastRunTargetId ? " · last used" : ""}`,
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
              label="Sign in as"
              value={configuration.selection.savedProfileId ?? "automatic"}
              options={[
                { value: "automatic", label: "No saved login (browser as it is)" },
                ...profiles.data.map((profile) => ({
                  value: profile.id,
                  // Name the login people recognize; the setup name only
                  // when there is no login to show.
                  label: `${profile.account?.name ?? profile.name}${profile.targetId && profile.targetId !== targetId ? " · other device" : ""}`,
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
          <details
            className="group border-t border-border/60 pt-3"
            open={
              configuration.selection.buildId || configuration.selection.startupMode === "cold"
                ? true
                : undefined
            }
          >
            <summary className="min-h-10 cursor-pointer text-sm font-medium">
              Advanced run options
            </summary>
            <div className="grid gap-3 pt-2">
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
            </div>
          </details>
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
              {start.isPending ? "Starting…" : "Run now"}
            </Button>
          </div>
        </RunConfigurationComposer>
      </section>
    ) : (
      <p className="p-4 text-sm text-muted-foreground">
        {activeRun ? "This Test is running." : "Devices are unavailable right now."}
      </p>
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
      <TestWorkspaceHeader
        title={test.data?.name ?? "Test"}
        context={
          typeof search.plan !== "string" ? (
            <Link to="/tests" className="inline-flex items-center gap-1 hover:text-foreground">
              <ChevronLeft className="size-4" aria-hidden="true" /> Tests
            </Link>
          ) : undefined
        }
        actions={
          <>
            {test.data && !activeRun ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => record.mutate()}
                disabled={record.isPending || !targetReady}
                title={
                  evidenceStepId
                    ? "Record new steps after the selected step"
                    : "Record new steps at the end"
                }
              >
                <Circle className="fill-destructive text-destructive" aria-hidden="true" />
                {record.isPending ? "Starting…" : "Record steps"}
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
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  onClick={runOrFocusSetup}
                  disabled={start.isPending}
                  title={configurationLabel}
                >
                  <Play aria-hidden="true" />
                  {start.isPending ? "Starting…" : profileBlocker ? "Fix setup" : "Run"}
                </Button>
                <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
                  <PopoverTrigger
                    ref={configurationTriggerRef}
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Run settings"
                        title={configurationLabel}
                      />
                    }
                  >
                    <SlidersHorizontal aria-hidden="true" />
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="max-h-[min(640px,80dvh)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
                    aria-label="Run settings"
                  >
                    {runSettings}
                  </PopoverContent>
                </Popover>
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="sm" />}
                aria-label="More Test actions"
              >
                <MoreHorizontal aria-hidden="true" /> More
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
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
                    Review result
                  </DropdownMenuItem>
                ) : null}
                {recentRuns.data?.length ? (
                  <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
                    Run history
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {loading ? <PageLoading label="Loading the Test and available devices…" /> : null}
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
        operation="run"
        error={start.error}
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
          <WorkspaceToolbar
            leading={
              <TabsList variant="line" aria-label="Test views" className="h-11">
                <TabsTrigger value="definition" className="px-4">
                  Test
                </TabsTrigger>
                <TabsTrigger value="run" disabled={!attachedRunId} className="px-4">
                  Result
                </TabsTrigger>
              </TabsList>
            }
            trailing={<TestLastRunLine run={latestRunOf(recentRuns.data)} />}
          />
          {!showRecording && attachedRunId ? (
            <TabsContent value="run" className="min-h-0 overflow-auto">
              <RunInspection key={attachedRunId} runId={attachedRunId} testId={testId} embedded />
            </TabsContent>
          ) : (
            <TabsContent value="definition" className="flex min-h-0 flex-1 flex-col">
              <TestEditor
                testId={testId}
                stepId={typeof search.step === "string" ? search.step : undefined}
                onStepChange={(step) =>
                  void navigate({ search: (previous) => ({ ...previous, step }), replace: true })
                }
                onSelectedStepChange={(step) => setEvidenceStepId(step ?? "")}
                stage={
                  <TestStage
                    key={testId}
                    recorded={
                      selectedEvidenceStep?.recordingFrames?.length ? (
                        <TestStepEvidencePreview
                          key={selectedEvidenceStep.id}
                          step={selectedEvidenceStep}
                          report={undefined}
                          hasRuns={false}
                          loading={false}
                        />
                      ) : (
                        <TestLastRunStage run={latestRunOf(recentRuns.data)} />
                      )
                    }
                    live={
                      editorDocument.data ? (
                        <TestEditorBrowserPane
                          appMapId={editorDocument.data.appMapId}
                          startUrl={editorDocument.data.test.originApplication}
                          browserTargetIds={editorDocument.data.browserTargetIds}
                          recentAccountIds={recentAccountIds(recentRuns.data)}
                        />
                      ) : null
                    }
                  />
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

/** The app beside the steps: the recorded screenshot, or the live browser. */
function TestStage({ recorded, live }: { recorded: ReactNode; live: ReactNode }) {
  const [mode, setMode] = useState<"recorded" | "live">("recorded");
  const [liveOpened, setLiveOpened] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col bg-stage">
      <div
        className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2"
        role="tablist"
        aria-label="App view"
      >
        {(
          [
            ["recorded", "Screenshot"],
            ["live", "Live browser"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            role="tab"
            size="sm"
            variant={mode === value ? "secondary" : "ghost"}
            aria-selected={mode === value}
            disabled={value === "live" && !live}
            onClick={() => {
              setMode(value);
              if (value === "live") setLiveOpened(true);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className={mode === "recorded" ? "min-h-0 flex-1 overflow-auto" : "hidden"}>
        {recorded}
      </div>
      {liveOpened ? (
        <div className={mode === "live" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>{live}</div>
      ) : null}
    </div>
  );
}
