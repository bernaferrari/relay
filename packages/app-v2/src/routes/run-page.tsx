import { initialRunStep } from "../data/run-timeline-selection";
import { PageHeader, WorkbenchPage } from "../components/page-layout";
import { RawEvidenceDisclosure } from "./raw-evidence-disclosure";
/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@relay/ui-react/components/dropdown-menu";
import { Progress, ProgressLabel, ProgressValue } from "@relay/ui-react/components/progress";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Link,
  getRouteApi,
  useLocation,
  useNavigate,
  useRouteContext,
} from "@tanstack/react-router";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { ChevronRight, CircleAlert, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { EmptyState } from "../components/product-patterns";
import { IssueDraftButton } from "../components/issue-draft-button";
import {
  firstSentence,
  formatDuration,
  failureTitle,
  nextAction,
  outcomeSentence,
  resultHeading,
} from "../components/run-report-formatters";
import type { ProductRunState, RunProductService } from "../data/run-product-service";
import { runQueryKeys } from "../data/run-queries";
import { clearRunPointerIfCurrent, readRunPointer } from "../data/run-pointer";
import { RecordingProblem, targetLabel } from "./recording-shared";
import { RunReviewControls } from "./run-review-controls";
import { RunLoading } from "./run-loading";
import { RunWorkbench } from "./run-workbench";
import { EvidencePreview } from "./run-report-panels";
import { RunReplayAction, RunReplayStatus } from "./run-replay";
import { RunEvidenceExport } from "./run-evidence-export";
import { attachedRunLinkTestId, attachedRunOwnership } from "../data/attached-run-ownership";
import { EmbeddedRunResult } from "../components/embedded-run-result";

const routeApi = getRouteApi("/runs/$runId");

export function RunPage() {
  const { runId } = routeApi.useParams();
  return <RunInspection runId={runId} />;
}

export function RunInspection({
  runId,
  testId: testIdProp,
  embedded = false,
}: {
  runId: string;
  testId?: string;
  embedded?: boolean;
}) {
  const { runService, platform, queryClient } = useRouteContext({ from: "__root__" });
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
  const originTest = useRef<{ runId: string; testId?: string }>({ runId, testId: testIdProp });
  if (originTest.current.runId !== runId) originTest.current = { runId, testId: testIdProp };
  if (testIdProp) originTest.current.testId = testIdProp;
  if (activePointer?.testId) originTest.current.testId = activePointer.testId;
  const run = useQuery({
    queryKey: runQueryKeys.workflow(activePointer?.workflowId ?? "inactive"),
    queryFn: () => runService.inspect(activePointer!.workflowId),
    enabled: Boolean(activePointer),
    initialData: restoredState,
    staleTime: 0,
    retry: false,
    // Streaming is an optimization. A dropped terminal event or development
    // restart must not leave the saved run displaying Running indefinitely.
    refetchInterval: (query) => (isTerminal(query.state.data?.status) ? false : 3_000),
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
    queryFn: async () => {
      const saved = await runService.getReport(runId, state?.report);
      if (state?.recovery && !saved.outcome)
        throw new Error("The run has not saved a final result yet.");
      return saved;
    },
    enabled:
      !pointer.isPending &&
      restoreSettled &&
      (!activePointer || terminal || Boolean(state?.recovery)) &&
      (!executionEnabled ||
        (execution.isFetched && (!execution.data || isTerminal(execution.data.status)))),
    retry: false,
  });
  const shouldWatch = Boolean(activePointer && state?.snapshot && !state.recovery && !terminal);
  const cancel = useMutation({
    mutationFn: async () =>
      activePointer
        ? runService.cancel({ workflowId: activePointer.workflowId })
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
        workflowId: activeWorkflowId,
        signal: controller.signal,
        onState(next) {
          if (next.workflow?.workflowId !== activeWorkflowId) return;
          queryClient.setQueryData(runQueryKeys.workflow(activeWorkflowId), next);
        },
      })
      .then((next) => {
        if (next.workflow?.workflowId !== activeWorkflowId) return;
        queryClient.setQueryData(runQueryKeys.workflow(activeWorkflowId), next);
        if (isTerminal(next.status)) {
          void queryClient.invalidateQueries({ queryKey: runQueryKeys.report(runId) });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          void queryClient.invalidateQueries({ queryKey: runQueryKeys.workflow(activeWorkflowId) });
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
    const ownership = attachedRunOwnership({
      routeTestId: testIdProp ?? originTest.current.testId,
      runTestId: report.data.testId,
    });
    if (embedded && ownership.kind === "foreign") {
      return (
        <EmptyState
          title="This Run belongs to another Test"
          detail="The copied result is still available, but it is not an attached report for this Test."
          action={
            <Link
              className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
              to="/runs/$runId"
              params={{ runId }}
            >
              Open the original Run
            </Link>
          }
        />
      );
    }
    return (
      <RunReport
        report={report.data}
        testId={attachedRunLinkTestId(ownership, report.data.testId)}
        runService={runService}
        embedded={embedded}
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
    if (!activePointer || terminal || state?.recovery) void report.refetch();
  };

  const problemView = (
    <RecordingProblem
      className="relay-run-recovery"
      error={problem}
      recovery={recovery}
      onRetry={retry}
      retrying={retrying}
      layout="centered"
    />
  );

  if (problem || recovery) {
    if (embedded) return problemView;
    return (
      <WorkbenchPage className="flex min-h-full max-w-[1120px] flex-col">
        <PageHeader
          crumbs={[{ label: "Runs", to: "/runs" }, { label: "Run" }]}
          title={snapshot?.title ?? "Run unavailable"}
          titleHidden
        />
        {problemView}
      </WorkbenchPage>
    );
  }

  if (loading) {
    const loadingView = <RunLoading />;
    if (embedded) return loadingView;
    return (
      <WorkbenchPage className="max-w-[1120px]">
        <PageHeader
          crumbs={[{ label: "Runs", to: "/runs" }, { label: "Run" }]}
          title={snapshot?.title ?? "Run details"}
        />
        {loadingView}
      </WorkbenchPage>
    );
  }

  if (embedded) {
    return (
      <section
        className="flex h-full min-h-0 items-center justify-center p-6"
        aria-label="Attached run"
      >
        {snapshot ? (
          <section className="flex w-full items-center justify-center" aria-label="Run progress">
            <div className="flex w-full max-w-sm flex-col items-center text-center">
              <h2 className="mt-1 text-base font-semibold" role="status">
                {snapshot.progress.label}
              </h2>
              {snapshot.progress.total !== undefined ? (
                <Progress
                  className="mt-4 w-full text-left"
                  value={snapshot.progress.completed ?? 0}
                  max={snapshot.progress.total}
                >
                  <ProgressLabel>Completed steps</ProgressLabel>
                  <ProgressValue>
                    {() => `${snapshot.progress.completed ?? 0} of ${snapshot.progress.total}`}
                  </ProgressValue>
                </Progress>
              ) : null}
              {canCancel ? (
                <Button
                  className="mt-4"
                  variant="outline"
                  size="sm"
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending}
                >
                  {cancel.isPending ? "Cancelling…" : "Cancel run"}
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}
      </section>
    );
  }

  return (
    <WorkbenchPage className="max-w-[1120px]">
      <PageHeader
        crumbs={[
          { label: "Runs", to: "/runs" },
          ...(activePointer ? [{ label: snapshot?.title ?? "Test" }] : []),
          { label: "Run" },
        ]}
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
  embedded = false,
}: {
  report: Awaited<ReturnType<RunProductService["getReport"]>>;
  testId?: string;
  runService: RunProductService;
  embedded?: boolean;
}) {
  const target = report.targetName ?? "the selected device or browser";
  const failure = report.outcome && report.outcome !== "passed" ? report.cause : undefined;
  const firstEvidenceIsDistinct = Boolean(
    report.firstEvidence &&
    !report.timeline.some((step) => step.title === report.firstEvidence?.label) &&
    (!failure ||
      firstSentence(report.firstEvidence.label).toLocaleLowerCase() !==
        firstSentence(failure).toLocaleLowerCase()),
  );
  const search = useLocation({ select: (state) => state.search }) as {
    view?: unknown;
    step?: unknown;
    at?: unknown;
    attempt?: unknown;
    reportView?: unknown;
    capture?: unknown;
  };
  const navigate = useNavigate();
  const requestedStep = typeof search.step === "string" ? Number.parseInt(search.step, 10) : 0;
  const requestedAt = typeof search.at === "string" ? Number(search.at) : Number.NaN;
  const requestedAttempt = typeof search.attempt === "string" ? Number(search.attempt) : Number.NaN;
  const contextStepIndex = report.timeline.findIndex(
    (item) =>
      (Number.isFinite(requestedAt) && item.startedAt === requestedAt) ||
      (Number.isFinite(requestedAttempt) && item.attempt === requestedAttempt),
  );
  const urlStepIndex =
    Number.isFinite(requestedStep) && requestedStep > 0
      ? Math.min(requestedStep - 1, Math.max(0, report.timeline.length - 1))
      : contextStepIndex >= 0
        ? contextStepIndex
        : initialRunStep(report.timeline);
  const [stepByRun, setStepByRun] = useState({ runId: report.runId, index: urlStepIndex });
  if (stepByRun.runId !== report.runId) {
    setStepByRun({ runId: report.runId, index: urlStepIndex });
  }
  const selectedStepIndex = embedded ? stepByRun.index : urlStepIndex;
  const [rawEvidenceOpen, setRawEvidenceOpen] = useState(false);
  const [runDialog, setRunDialog] = useState<"review" | "configuration" | "export" | null>(null);
  const canInvestigate =
    report.outcome === "product-failure" ||
    report.outcome === "uncertain" ||
    report.outcome === "harness-failure";
  const heading = resultHeading(report.outcome);
  const actions = (
    <>
      <Dialog open={rawEvidenceOpen} onOpenChange={setRawEvidenceOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle>Audit details</DialogTitle>
          <DialogDescription>Saved technical evidence for this run.</DialogDescription>
          <RawEvidenceDisclosure
            runId={report.runId}
            runService={runService}
            open={rawEvidenceOpen}
            onOpenChange={setRawEvidenceOpen}
          />
        </DialogContent>
      </Dialog>{" "}
      <Dialog
        open={runDialog === "configuration"}
        onOpenChange={(open) => {
          if (!open) setRunDialog(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Recorded configuration</DialogTitle>
          <DialogDescription>Environment saved with this run.</DialogDescription>
          <dl className="grid gap-x-8 gap-y-4 px-1 py-3 sm:grid-cols-2">
            {[
              ["Device", report.targetName],
              ["Build", report.executionContext?.buildId],
              ["Profile", report.executionContext?.targetProfileId],
              ["Source revision", report.executionContext?.sourceRevision],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words text-sm">{value}</dd>
                </div>
              ))}
            {report.executionContext?.browser ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Browser</dt>
                <dd className="mt-1 break-words font-mono text-xs">
                  {report.executionContext.browser}
                </dd>
              </div>
            ) : null}
          </dl>
        </DialogContent>
      </Dialog>
      <RunReviewControls
        runId={report.runId}
        service={runService}
        open={runDialog === "review"}
        onOpenChange={(open) => {
          if (!open) setRunDialog(null);
        }}
      />
      <Dialog
        open={runDialog === "export"}
        onOpenChange={(open) => {
          if (!open) setRunDialog(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Export evidence</DialogTitle>
          <DialogDescription>Download the saved evidence for this run.</DialogDescription>
          {runService.exportEvidence ? (
            <RunEvidenceExport runId={report.runId} exportEvidence={runService.exportEvidence} />
          ) : null}
        </DialogContent>
      </Dialog>
      {embedded ? (
        <Button
          nativeButton={false}
          render={<Link to="/runs/$runId" params={{ runId: report.runId }} />}
          variant="ghost"
          size="sm"
        >
          Open full report
        </Button>
      ) : null}
      {canInvestigate ? (
        <Button
          nativeButton={false}
          render={<Link to="/debug" search={{ runId: report.runId }} />}
          variant="default"
        >
          Investigate this failure
        </Button>
      ) : null}
      {!embedded && report.outcome === "harness-failure" ? (
        <RunReplayAction
          report={report}
          runService={runService}
          variant={canInvestigate ? "ghost" : "default"}
          label="Run again"
        />
      ) : testId && !embedded ? (
        <Button
          nativeButton={false}
          render={<Link to="/tests/$testId" params={{ testId }} />}
          variant={canInvestigate ? "ghost" : "default"}
        >
          Set up another run
        </Button>
      ) : embedded ? null : (
        <RunReplayAction report={report} runService={runService} />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="sm" />}
          aria-label="More run actions"
        >
          <MoreHorizontal className="size-4" aria-hidden="true" /> More
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => setRawEvidenceOpen(true)}>Audit</DropdownMenuItem>
          {runService.review || runService.compareVisual ? (
            <DropdownMenuItem onClick={() => setRunDialog("review")}>Review run</DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setRunDialog("configuration")}>
            Configuration
          </DropdownMenuItem>
          {runService.exportEvidence ? (
            <DropdownMenuItem onClick={() => setRunDialog("export")}>
              Export evidence
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
  const failureNotice = failure ? (
    <Dialog>
      <DialogTrigger
        aria-label="Technical details"
        className="relay-interactive-row flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{heading}</span>
        <span className="text-xs">View details</span>
        <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogTitle>{failureTitle(failure, report.category)}</DialogTitle>
        <DialogDescription>{nextAction(report.outcome)}</DialogDescription>
        <ScrollArea className="max-h-[50vh] min-h-0">
          <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-4 text-xs leading-5 text-muted-foreground">
            {failure}
          </pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  ) : report.outcome && report.outcome !== "passed" ? (
    <p className="text-sm font-semibold" role="status">
      {heading}
    </p>
  ) : null;
  const hasFailedStep = report.timeline.some((step) => step.state === "failed");
  const body = (
    <>
      {!hasFailedStep ? failureNotice : null}

      <section className="mt-3 flex min-h-0 flex-1 flex-col gap-3" aria-label="Run evidence">
        {report.timeline.length || report.evidence.length ? (
          <RunWorkbench
            key={report.runId}
            report={report}
            view={typeof search.reportView === "string" ? search.reportView : undefined}
            captureIndex={typeof search.capture === "string" ? Number(search.capture) : undefined}
            onViewChange={(reportView) => {
              if (!embedded)
                void navigate({
                  to: "/runs/$runId",
                  params: { runId: report.runId },
                  replace: true,
                  resetScroll: false,
                  search: (previous) => ({ ...previous, reportView }),
                });
            }}
            onCaptureChange={(capture) => {
              if (!embedded)
                void navigate({
                  to: "/runs/$runId",
                  params: { runId: report.runId },
                  replace: true,
                  resetScroll: false,
                  search: (previous) => ({ ...previous, capture: String(capture) }),
                });
            }}
            selectedStepIndex={selectedStepIndex}
            failureNotice={failureNotice}
            footer={canInvestigate ? <IssueDraftButton source={{ kind: "run", report }} /> : null}
            renderEvidence={(section) => <EvidencePreview section={section} />}
            onSelectStep={(index) => {
              const selected = report.timeline[index];
              if (embedded) {
                setStepByRun({ runId: report.runId, index });
                return;
              }
              void navigate({
                to: "/runs/$runId",
                params: { runId: report.runId },
                replace: true,
                resetScroll: false,
                search: (previous) => ({
                  ...previous,
                  view: undefined,
                  step: String(index + 1),
                  at: selected?.startedAt === undefined ? undefined : String(selected.startedAt),
                  attempt: selected?.attempt === undefined ? undefined : String(selected.attempt),
                }),
              });
            }}
          />
        ) : null}

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
    </>
  );

  if (embedded) return <EmbeddedRunResult report={report} />;

  return (
    <WorkbenchPage className="flex h-full min-h-0 flex-col !pt-3 !pb-3">
      <PageHeader
        crumbs={[
          { label: "Runs", to: "/runs" },
          ...(testId
            ? [{ label: "View test", to: "/tests/$testId" as const, params: { testId } }]
            : []),
          { label: report.title },
        ]}
        title={report.title}
        description={
          <>
            {outcomeSentence(report.outcome, target)}
            {report.durationMs !== undefined ? (
              <span className="whitespace-nowrap tabular-nums">
                <span aria-hidden="true" className="mx-2">
                  ·
                </span>
                <span className="sr-only">Duration: </span>
                {formatDuration(report.durationMs)}
              </span>
            ) : null}
          </>
        }
        actions={actions}
      />
      <RunReplayStatus runService={runService} />
      {body}
    </WorkbenchPage>
  );
}
