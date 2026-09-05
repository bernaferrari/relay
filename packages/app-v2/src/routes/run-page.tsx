import { ReportVideoInspector } from "../components/report-video-inspector";
import { PageHeader, WorkbenchPage } from "../components/page-layout";
import { RawEvidenceDisclosure } from "./raw-evidence-disclosure";
/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
import { Progress, ProgressLabel, ProgressValue } from "@relay/ui-react/components/progress";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Breadcrumbs, OutcomeMark } from "../components/product-patterns";
import { IssueDraftButton } from "../components/issue-draft-button";
import { RunConfigurationComposer } from "../components/run-configuration-composer";
import {
  firstSentence,
  formatDuration,
  failureTitle,
  nextAction,
  outcomeSentence,
} from "../components/run-report-formatters";
import type { ProductRunState, RunProductService } from "../data/run-product-service";
import { runQueryKeys } from "../data/run-queries";
import { clearRunPointerIfCurrent, readRunPointer } from "../data/run-pointer";
import { PageLoading, RecordingProblem, targetLabel } from "./recording-shared";
import { RunReviewControls } from "./run-review-controls";
import { RunWorkbench, RunContextFacts } from "./run-workbench";
import { ReportTimeline, EvidencePreview } from "./run-report-panels";
import { RunReplayAction, RunReplayStatus } from "./run-replay";

const routeApi = getRouteApi("/runs/$runId");

export function RunPage() {
  const { runService, platform, queryClient } = useRouteContext({ from: "__root__" });
  const { runId } = routeApi.useParams();
  const pointer = useQuery({
    queryKey: runQueryKeys.pointer,
    queryFn: async () => (await readRunPointer(platform)) ?? null,
    staleTime: Infinity,
  });
  const restoreEnabled =
    !pointer.isPending && pointer.data?.runId !== runId && typeof runService.restore === "function";
  const restore = useQuery({
    queryKey: runQueryKeys.restore(runId),
    queryFn: async () => (await runService.restore?.(runId)) ?? null,
    enabled: restoreEnabled,
    staleTime: 0,
    retry: false,
  });
  const restoredState = restore.data ?? undefined;
  const restoreSettled = !restoreEnabled || restore.isFetched;
  const executionEnabled =
    !pointer.isPending &&
    restoreSettled &&
    pointer.data?.runId !== runId &&
    !restoredState &&
    typeof runService.inspectExecution === "function";
  const execution = useQuery({
    queryKey: ["run", "execution", runId],
    queryFn: () => runService.inspectExecution?.(runId) ?? Promise.resolve(null),
    enabled: executionEnabled,
    staleTime: 0,
    retry: false,
    refetchInterval: (query) => (isTerminal(query.state.data?.status) ? false : 3_000),
  });
  const activePointer =
    pointer.data?.runId === runId
      ? pointer.data
      : restoredState?.workflow
        ? { workflowId: restoredState.workflow.workflowId, runId, testId: "" }
        : undefined;
  const activeWorkflowId = activePointer?.workflowId;
  const originTest = useRef<{ runId: string; testId?: string }>({ runId });
  if (originTest.current.runId !== runId) originTest.current = { runId };
  if (activePointer?.testId) originTest.current.testId = activePointer.testId;
  const run = useQuery({
    queryKey: runQueryKeys.workflow(activePointer?.workflowId ?? "inactive"),
    queryFn: () => runService.inspect(activePointer!.workflowId),
    enabled: Boolean(activePointer),
    initialData: restoredState,
    staleTime: 0,
    retry: false,
  });
  const state = run.data ?? restoredState ?? execution.data;
  const restorePending = restoreEnabled && !restore.isFetched;
  const terminal = isTerminal(state?.status);
  const target = state?.snapshot?.target;
  const targetPresentation = useQuery({
    queryKey: runQueryKeys.targetPresentation(target?.targetId ?? "unselected"),
    queryFn: () => runService.presentTargets([target!]),
    enabled: Boolean(target),
    staleTime: 30_000,
  });
  const report = useQuery({
    queryKey: runQueryKeys.report(runId),
    queryFn: () => runService.getReport(runId, state?.report),
    enabled:
      !pointer.isPending &&
      restoreSettled &&
      (!activePointer || terminal) &&
      (!executionEnabled ||
        (execution.isFetched && (!execution.data || isTerminal(execution.data.status)))),
    retry: false,
  });
  const shouldWatch = Boolean(activePointer && state?.snapshot && !state.recovery && !terminal);
  const cancel = useMutation({
    mutationFn: async () =>
      activePointer
        ? runService.cancel()
        : ((await runService.cancelExecution?.(runId)) ?? undefined),
    onSuccess: async (state) => {
      if (!state) return;
      if (state.recovery || !activePointer) {
        await execution.refetch();
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: runQueryKeys.workflow(activePointer.workflowId),
      });
      await queryClient.fetchQuery({
        queryKey: runQueryKeys.workflow(activePointer.workflowId),
        queryFn: () => runService.inspect(activePointer.workflowId),
        staleTime: 0,
      });
    },
  });

  useEffect(() => {
    if (!activeWorkflowId || !shouldWatch) return;
    const controller = new AbortController();
    void runService
      .watch({
        signal: controller.signal,
        onState(next) {
          queryClient.setQueryData(runQueryKeys.workflow(activeWorkflowId), next);
        },
      })
      .then((next) => {
        queryClient.setQueryData(runQueryKeys.workflow(activeWorkflowId), next);
        if (isTerminal(next.status)) {
          void queryClient.invalidateQueries({ queryKey: runQueryKeys.report(runId) });
        }
      });
    return () => controller.abort();
  }, [activeWorkflowId, queryClient, runId, runService, shouldWatch]);

  useEffect(() => {
    if (!report.data) return;
    void clearRunPointerIfCurrent(platform, runId).then((cleared) => {
      if (cleared) queryClient.setQueryData(runQueryKeys.pointer, null);
    });
  }, [platform, queryClient, report.data, runId]);

  if (report.data) {
    return (
      <RunReport
        report={report.data}
        testId={originTest.current.testId ?? report.data.testId}
        runService={runService}
      />
    );
  }

  const snapshot = state?.snapshot;
  const canCancel = Boolean(
    snapshot?.allowedNextActions.includes("cancel") && !state?.recovery && !cancel.data?.recovery,
  );
  const loading =
    pointer.isPending ||
    restorePending ||
    (Boolean(activePointer) && run.isPending) ||
    (executionEnabled && execution.isPending) ||
    (terminal && report.isPending);
  const problem = pointer.error ?? restore.error ?? run.error ?? report.error ?? cancel.error;
  const recovery = cancel.data?.recovery ?? state?.recovery;
  const retrying =
    pointer.isFetching ||
    restore.isFetching ||
    execution.isFetching ||
    run.isFetching ||
    report.isFetching;
  const retry = () => {
    void pointer.refetch();
    if (typeof runService.restore === "function") void restore.refetch();
    if (!activePointer && typeof runService.inspectExecution === "function")
      void execution.refetch();
    if (activePointer) void run.refetch();
    if (!activePointer || terminal) void report.refetch();
  };

  if (problem || recovery) {
    return (
      <WorkbenchPage className="max-w-[1120px]">
        <Breadcrumbs items={[{ label: "Runs", to: "/runs" }, { label: "Run" }]} />
        <h1 className="relay-visually-hidden sr-only text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance]">
          {snapshot?.title ?? "Run unavailable"}
        </h1>
        <RecordingProblem
          className="relay-run-recovery mt-4"
          error={problem}
          recovery={recovery}
          onRetry={retry}
          retrying={retrying}
          layout="centered"
        />
      </WorkbenchPage>
    );
  }

  if (loading) {
    return (
      <WorkbenchPage className="max-w-[1120px]">
        <Breadcrumbs items={[{ label: "Runs", to: "/runs" }, { label: "In progress" }]} />
        <PageHeader context="Run" title={snapshot?.title ?? "Loading Run"} />
        <PageLoading label="Loading the Run…" />
      </WorkbenchPage>
    );
  }

  return (
    <WorkbenchPage className="max-w-[1120px]">
      <Breadcrumbs
        items={[
          { label: "Runs", to: "/runs" },
          ...(activePointer ? [{ label: snapshot?.title ?? "Test" }] : []),
          { label: "In progress" },
        ]}
      />
      <PageHeader
        context="Run in progress"
        title={snapshot?.title ?? "Running Test"}
        description={
          snapshot?.target
            ? targetLabel(targetPresentation.data?.[0] ?? snapshot.target).title
            : undefined
        }
        actions={
          <>
            {activePointer?.testId ? (
              <Button
                nativeButton={false}
                render={<Link to="/tests/$testId" params={{ testId: activePointer.testId }} />}
                variant="ghost"
              >
                View test
              </Button>
            ) : null}
            {canCancel ? (
              <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                {cancel.isPending ? "Cancelling…" : "Cancel Run"}
              </Button>
            ) : null}
          </>
        }
      />

      {snapshot ? (
        <section className="rounded-xl border border-border bg-card p-5" aria-label="Run progress">
          <h2 className="text-base font-semibold" role="status">
            {snapshot.progress.label}
          </h2>
          {snapshot.progress.total !== undefined ? (
            <Progress
              className="mt-4"
              value={snapshot.progress.completed ?? 0}
              max={snapshot.progress.total}
            >
              <ProgressLabel>Completed steps</ProgressLabel>
              <ProgressValue>
                {() => `${snapshot.progress.completed ?? 0} of ${snapshot.progress.total}`}
              </ProgressValue>
            </Progress>
          ) : null}
        </section>
      ) : null}
    </WorkbenchPage>
  );
}

function isTerminal(status: ProductRunState["status"] | undefined): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function RunReport({
  report,
  testId,
  runService,
}: {
  report: Awaited<ReturnType<RunProductService["getReport"]>>;
  testId?: string;
  runService: RunProductService;
}) {
  const target = report.targetName ?? "the selected device or browser";
  const failure = report.outcome && report.outcome !== "passed" ? report.cause : undefined;
  const firstEvidenceIsDistinct = Boolean(
    report.firstEvidence &&
    (!failure ||
      firstSentence(report.firstEvidence.label).toLocaleLowerCase() !==
        firstSentence(failure).toLocaleLowerCase()),
  );
  const search = routeApi.useSearch() as {
    view?: unknown;
    step?: unknown;
    at?: unknown;
    attempt?: unknown;
  };
  const navigate = useNavigate({ from: "/runs/$runId" });
  const requestedView = reportView(search.view);
  const requestedStep = typeof search.step === "string" ? Number.parseInt(search.step, 10) : 0;
  const requestedAt = typeof search.at === "string" ? Number(search.at) : Number.NaN;
  const requestedAttempt = typeof search.attempt === "string" ? Number(search.attempt) : Number.NaN;
  const views = [
    { id: "overview" as const, label: "Overview", available: true },
    { id: "timeline" as const, label: "Timeline", available: report.timeline.length > 0 },
    { id: "evidence" as const, label: "Evidence", available: report.evidence.length > 0 },
  ].filter((view) => view.available);
  const view = views.some((item) => item.id === requestedView) ? requestedView : "overview";
  const [selectedEvidenceId, setSelectedEvidenceId] = useState(report.evidence[0]?.id);
  const contextStepIndex = report.timeline.findIndex(
    (item) =>
      (Number.isFinite(requestedAt) && item.startedAt === requestedAt) ||
      (Number.isFinite(requestedAttempt) && item.attempt === requestedAttempt),
  );
  const selectedStepIndex =
    Number.isFinite(requestedStep) && requestedStep > 0
      ? Math.min(requestedStep - 1, Math.max(0, report.timeline.length - 1))
      : contextStepIndex >= 0
        ? contextStepIndex
        : Math.max(
            0,
            report.timeline.findIndex((item) => item.state === "failed"),
          );
  const [rawEvidenceOpen, setRawEvidenceOpen] = useState(false);
  const selectedEvidence =
    report.evidence.find((section) => section.id === selectedEvidenceId) ?? report.evidence[0];
  function selectView(nextView: ReportView) {
    void navigate({
      search: (previous) => ({
        ...previous,
        view: nextView === "overview" ? undefined : nextView,
      }),
    });
  }
  return (
    <WorkbenchPage className="max-w-[1280px]">
      <Breadcrumbs items={[{ label: "Runs", to: "/runs" }, { label: report.title }]} />
      <PageHeader
        context={
          <>
            <span>Run Report</span>
            <OutcomeMark outcome={report.outcome} />
          </>
        }
        title={report.title}
        description={outcomeSentence(report.outcome, target)}
        actions={
          <>
            {report.video ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedEvidenceId("video");
                  selectView("evidence");
                }}
              >
                Watch recording
              </Button>
            ) : null}
            <RunReplayAction report={report} runService={runService} />
            {report.outcome === "product-failure" ||
            report.outcome === "harness-failure" ||
            report.outcome === "uncertain" ? (
              <Button
                nativeButton={false}
                render={<Link to="/debug" search={{ runId: report.runId }} />}
                variant="default"
              >
                Investigate
              </Button>
            ) : testId ? (
              <Button
                nativeButton={false}
                render={<Link to="/tests/$testId" params={{ testId }} />}
                variant="default"
              >
                Set up another run
              </Button>
            ) : null}
          </>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <RunContextFacts
            report={report}
            duration={
              report.durationMs === undefined ? "Not recorded" : formatDuration(report.durationMs)
            }
            compact
          />
          {testId ? (
            <Link
              className="inline-flex min-h-9 items-center gap-1 rounded-md px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              to="/tests/$testId"
              params={{ testId }}
            >
              View test
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </PageHeader>
      <RunReplayStatus runService={runService} />

      {failure ? (
        <section className="mt-2 max-w-[60ch]" aria-labelledby="causal-failure-title">
          <h2 id="causal-failure-title" className="text-[15px] font-medium text-foreground">
            {failureTitle(failure, report.category)}
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            {nextAction(report.outcome)}
          </p>
          <Collapsible className="mt-3">
            <CollapsibleTrigger className="text-[13px] text-muted-foreground hover:text-foreground">
              Technical details
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea className="mt-2 max-h-[180px] overflow-auto">
                <pre className="whitespace-pre-wrap break-words text-[12px] leading-5 text-muted-foreground">
                  {failure}
                </pre>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>
        </section>
      ) : null}

      {views.length > 1 ? (
        <Tabs
          className="mt-4"
          value={view}
          onValueChange={(next) => selectView(next as ReportView)}
        >
          <TabsList className="flex items-center gap-2" variant="line" aria-label="Report view">
            {views.map((item) => (
              <TabsTrigger
                key={item.id}
                id={`report-tab-${item.id}`}
                value={item.id}
                aria-controls={`report-panel-${item.id}`}
              >
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      {view === "overview" ? (
        <section
          id="report-panel-overview"
          className="mt-4 grid gap-6"
          role={views.length > 1 ? "tabpanel" : undefined}
          aria-labelledby={views.length > 1 ? "report-tab-overview" : undefined}
        >
          {report.timeline.length || report.evidence.length ? (
            <RunWorkbench
              report={report}
              selectedStepIndex={selectedStepIndex}
              renderEvidence={(section) => <EvidencePreview section={section} />}
              onSelectStep={(index) => {
                const selected = report.timeline[index];
                void navigate({
                  search: (previous) => ({
                    ...previous,
                    step: String(index + 1),
                    at: selected?.startedAt === undefined ? undefined : String(selected.startedAt),
                    attempt: selected?.attempt === undefined ? undefined : String(selected.attempt),
                  }),
                });
              }}
            />
          ) : null}

          <Collapsible className="grid gap-3">
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-left text-sm font-semibold text-foreground transition-colors hover:bg-muted/60">
              Recorded configuration
              <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 group-aria-expanded:rotate-90"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <RunConfigurationComposer
                configuration={{
                  frozen: true,
                  validated: true,
                  values: {
                    sourceRevision: report.executionContext?.sourceRevision,
                    buildId: report.executionContext?.buildId,
                    targetProfileId: report.executionContext?.targetProfileId,
                    targetName: report.targetName,
                    browserProfile: report.executionContext?.browser,
                  },
                }}
              />
            </CollapsibleContent>
          </Collapsible>

          <RunReviewControls runId={report.runId} service={runService} />

          {firstEvidenceIsDistinct && report.firstEvidence ? (
            <section
              className="mt-5 rounded-xl border border-border bg-card p-5"
              aria-labelledby="first-evidence-title"
            >
              <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                {report.outcome === "passed" ? "What Relay verified" : "Evidence at this point"}
              </p>
              <h2 id="first-evidence-title">{report.firstEvidence.label}</h2>
              {report.firstEvidence.detail ? <p>{report.firstEvidence.detail}</p> : null}
            </section>
          ) : null}

          {report.evidenceUnavailable ? (
            <p
              className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
              role="status"
            >
              Evidence details are temporarily unavailable. The saved outcome above is unchanged.
            </p>
          ) : null}
        </section>
      ) : null}

      {view === "timeline" ? (
        <ReportTimeline items={report.timeline} tabbed={views.length > 1} />
      ) : null}

      {view === "evidence" && selectedEvidence ? (
        <section
          id="report-panel-evidence"
          className="mt-5"
          role="tabpanel"
          aria-labelledby="report-tab-evidence"
        >
          <div className="grid gap-4">
            <Tabs value={selectedEvidence.id} onValueChange={(next) => setSelectedEvidenceId(next)}>
              <TabsList
                className="h-auto max-w-full flex-wrap justify-start gap-1"
                aria-label="Evidence type"
              >
                {report.evidence.map((section) => (
                  <TabsTrigger key={section.id} value={section.id}>
                    <span className="font-medium">{section.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{section.detail}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {selectedEvidence.id === "video" && report.video ? (
              <ReportVideoInspector video={report.video} diagnostics={report.diagnostics} />
            ) : (
              <EvidencePreview section={selectedEvidence} />
            )}
          </div>
          <RawEvidenceDisclosure
            runId={report.runId}
            runService={runService}
            open={rawEvidenceOpen}
            onOpenChange={setRawEvidenceOpen}
          />
        </section>
      ) : null}
      {report.outcome === "product-failure" ||
      report.outcome === "harness-failure" ||
      report.outcome === "uncertain" ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">Share the findings with your team.</p>
          <IssueDraftButton source={{ kind: "run", report }} />
        </div>
      ) : null}
    </WorkbenchPage>
  );
}

type ReportView = "overview" | "timeline" | "evidence";

function reportView(value: unknown): ReportView {
  return value === "timeline" || value === "evidence" ? value : "overview";
}
