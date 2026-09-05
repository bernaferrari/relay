import { RawEvidenceDisclosure } from "./raw-evidence-disclosure";
/** @jsxImportSource react */
import { Badge } from "@relay/ui-react/components/badge";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@relay/ui-react/components/alert";
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
import { ArrowLeft, ChevronRight, CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Breadcrumbs, OutcomeMark } from "../components/product-patterns";
import { IssueDraftButton } from "../components/issue-draft-button";
import { RunConfigurationComposer } from "../components/run-configuration-composer";
import {
  firstSentence,
  failureTitle,
  formatDuration,
  nextAction,
  outcomeSentence,
} from "../components/run-report-formatters";
import type { ProductRunState, RunProductService } from "../data/run-product-service";
import { runQueryKeys } from "../data/run-queries";
import { clearRunPointerIfCurrent, readRunPointer } from "../data/run-pointer";
import { PageLoading, RecordingProblem, targetLabel } from "./recording-shared";
import { RunReviewControls } from "./run-review-controls";
import { RunWorkbench, RunContextFacts } from "./run-workbench";
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
  const activePointer = pointer.data?.runId === runId ? pointer.data : undefined;
  const originTestId = useRef<string | undefined>(undefined);
  if (activePointer?.testId) originTestId.current = activePointer.testId;
  const run = useQuery({
    queryKey: runQueryKeys.workflow(activePointer?.workflowId ?? "inactive"),
    queryFn: () => runService.inspect(activePointer!.workflowId),
    enabled: Boolean(activePointer),
    staleTime: 0,
    retry: false,
  });
  const terminal = isTerminal(run.data?.status);
  const target = run.data?.snapshot?.target;
  const targetPresentation = useQuery({
    queryKey: runQueryKeys.targetPresentation(target?.targetId ?? "unselected"),
    queryFn: () => runService.presentTargets([target!]),
    enabled: Boolean(target),
    staleTime: 30_000,
  });
  const report = useQuery({
    queryKey: runQueryKeys.report(runId),
    queryFn: () => runService.getReport(runId, run.data?.report),
    enabled: !pointer.isPending && (!activePointer || terminal),
    retry: false,
  });
  const shouldWatch = Boolean(
    activePointer && run.data?.snapshot && !run.data.recovery && !terminal,
  );
  const cancel = useMutation({
    mutationFn: () => runService.cancel(),
    onSuccess: async (state) => {
      if (state.recovery || !activePointer) return;
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
    if (!activePointer || !shouldWatch) return;
    const controller = new AbortController();
    void runService
      .watch({
        signal: controller.signal,
        onState(next) {
          queryClient.setQueryData(runQueryKeys.workflow(activePointer.workflowId), next);
        },
      })
      .then((next) => {
        queryClient.setQueryData(runQueryKeys.workflow(activePointer.workflowId), next);
        if (isTerminal(next.status)) {
          void queryClient.invalidateQueries({ queryKey: runQueryKeys.report(runId) });
        }
      });
    return () => controller.abort();
  }, [activePointer, queryClient, runId, runService, shouldWatch]);

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
        testId={originTestId.current ?? report.data.testId}
        runService={runService}
      />
    );
  }

  const state = run.data;
  const snapshot = state?.snapshot;
  const canCancel = Boolean(
    snapshot?.allowedNextActions.includes("cancel") && !state?.recovery && !cancel.data?.recovery,
  );
  const loading = pointer.isPending || run.isPending || (terminal && report.isPending);
  const problem = pointer.error ?? run.error ?? report.error ?? cancel.error;
  const recovery = cancel.data?.recovery ?? state?.recovery;
  const retrying = pointer.isFetching || run.isFetching || report.isFetching;
  const retry = () => {
    void pointer.refetch();
    if (activePointer) void run.refetch();
    if (!activePointer || terminal) void report.refetch();
  };

  if (problem || recovery) {
    return (
      <section className="relay-page mx-auto w-full px-[clamp(20px,3vw,40px)] pt-7 pb-10 max-w-[1120px]">
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
      </section>
    );
  }

  if (loading) {
    return (
      <section className="relay-page mx-auto w-full px-[clamp(20px,3vw,40px)] pt-7 pb-10 max-w-[1120px]">
        <Breadcrumbs items={[{ label: "Runs", to: "/runs" }, { label: "In progress" }]} />
        <header className="rounded-lg border border-border bg-muted/40 p-4">
          <p className="relay-eyebrow mb-2 text-[11px] font-semibold tracking-[0.02em] text-[var(--text-weak)]">
            Run
          </p>
          <h1 className="text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance] text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance]">
            {snapshot?.title ?? "Loading Run"}
          </h1>
        </header>
        <PageLoading label="Loading the Run…" />
      </section>
    );
  }

  return (
    <section className="relay-page mx-auto w-full px-[clamp(20px,3vw,40px)] pt-7 pb-10 max-w-[1120px]">
      <Breadcrumbs
        items={[
          { label: "Runs", to: "/runs" },
          ...(activePointer ? [{ label: snapshot?.title ?? "Test" }] : []),
          { label: "In progress" },
        ]}
      />
      <header className="relay-page-header flex min-w-0 flex-wrap items-start justify-between gap-5">
        <div>
          <p className="relay-eyebrow mb-2 text-[11px] font-semibold tracking-[0.02em] text-[var(--text-weak)]">
            Run
          </p>
          <h1 className="text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance] text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance]">
            {snapshot?.title ?? "Running Test"}
          </h1>
          <p className="relay-page-description mt-2.5 max-w-[62ch] text-[15px] leading-[1.55] text-[var(--text-weak)]">
            {snapshot?.progress.label ?? "Restoring progress…"}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-5">
          {activePointer ? (
            <Link
              className="relay-text-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 mt-[18px] inline-flex min-h-11 items-center font-semibold text-[var(--text-interactive-base)] relay-header-link inline-flex min-h-11 items-center gap-2"
              to="/tests/$testId"
              params={{ testId: activePointer.testId }}
            >
              View test
            </Link>
          ) : null}
          {canCancel ? (
            <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              {cancel.isPending ? "Cancelling…" : "Cancel Run"}
            </Button>
          ) : null}
        </div>
      </header>

      {snapshot ? (
        <div className="rounded-xl border border-border bg-card p-5" role="status">
          <div className="rounded-xl border border-border bg-card p-5">
            <div>
              <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                Progress
              </p>
              <h2>{snapshot.progress.label}</h2>
            </div>
            {snapshot.target ? (
              <span>{targetLabel(targetPresentation.data?.[0] ?? snapshot.target).title}</span>
            ) : null}
          </div>
          {snapshot.progress.total !== undefined ? (
            <Progress
              className="rounded-xl border border-border bg-card p-5"
              value={snapshot.progress.completed ?? 0}
              max={snapshot.progress.total}
            >
              <ProgressLabel>{snapshot.progress.label}</ProgressLabel>
              <ProgressValue>
                {() => `${snapshot.progress.completed ?? 0} of ${snapshot.progress.total}`}
              </ProgressValue>
            </Progress>
          ) : null}
        </div>
      ) : null}
    </section>
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
    <section className="relay-page mx-auto w-full px-[clamp(20px,3vw,40px)] pt-7 pb-10 max-w-[1120px]">
      {testId ? (
        <Link
          className="relay-back-link mb-3 mt-[-10px] inline-flex min-h-11 items-center gap-2 text-[13px] font-semibold text-[var(--text-weak)] focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2"
          to="/tests/$testId"
          params={{ testId }}
        >
          <ArrowLeft aria-hidden="true" /> View test
        </Link>
      ) : (
        <Breadcrumbs items={[{ label: "Runs", to: "/runs" }, { label: "Report" }]} />
      )}
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-5">
        <div className="min-w-0 flex-[1_1_340px]">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <OutcomeMark outcome={report.outcome} />
            <span>Run Report</span>
          </div>
          <h1 className="text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance] text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance]">
            {report.title}
          </h1>
          <p className="mt-5 rounded-xl border border-border bg-card p-5">
            {outcomeSentence(report.outcome, target)}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <RunReplayAction report={report} runService={runService} />
          {report.outcome === "product-failure" ||
          report.outcome === "harness-failure" ||
          report.outcome === "uncertain" ? (
            <>
              <Button
                nativeButton={false}
                render={<Link to="/debug" search={{ runId: report.runId }} />}
                variant="outline"
              >
                Investigate
              </Button>
              <IssueDraftButton source={{ kind: "run", report }} />
            </>
          ) : null}
          {testId ? (
            <Button
              nativeButton={false}
              render={<Link to="/tests/$testId" params={{ testId }} />}
              variant={report.outcome === "passed" ? "default" : "outline"}
            >
              Set up another run
            </Button>
          ) : null}
          {!testId ? (
            <Link
              className="relay-text-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 mt-[18px] inline-flex min-h-11 items-center font-semibold text-[var(--text-interactive-base)] relay-header-link inline-flex min-h-11 items-center gap-2"
              to="/runs"
            >
              All Runs
            </Link>
          ) : null}
        </div>
      </header>
      <RunReplayStatus runService={runService} />

      {views.length > 1 ? (
        <Tabs value={view} onValueChange={(next) => selectView(next as ReportView)}>
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
          className="rounded-xl border border-border bg-card p-5 grid gap-5"
          role={views.length > 1 ? "tabpanel" : undefined}
          aria-labelledby={views.length > 1 ? "report-tab-overview" : undefined}
        >
          <RunContextFacts
            report={report}
            duration={
              report.durationMs === undefined ? "Not recorded" : formatDuration(report.durationMs)
            }
          />
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

          <RunReviewControls runId={report.runId} service={runService} />

          {failure ? (
            <Alert
              className="mt-7 grid max-w-[760px] grid-cols-[20px_minmax(0,1fr)_auto]"
              variant="destructive"
              aria-labelledby="causal-failure-title"
            >
              <CircleAlert />
              <AlertTitle id="causal-failure-title">
                {failureTitle(failure, report.category)}
              </AlertTitle>
              <AlertDescription>{nextAction(report.outcome)}</AlertDescription>
              {report.category || testId ? (
                <AlertAction>
                  {report.category ? <Badge variant="destructive">{report.category}</Badge> : null}
                  {testId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      nativeButton={false}
                      render={<Link to="/tests/$testId" params={{ testId }} />}
                    >
                      Open Test to run again
                    </Button>
                  ) : null}
                </AlertAction>
              ) : null}
              <Collapsible className="col-start-2 col-end-[-1]">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                  Technical details
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t pt-3">
                  <ScrollArea className="col-start-2 col-end-[-1] max-h-[180px] overflow-auto">
                    <pre>{failure}</pre>
                  </ScrollArea>
                </CollapsibleContent>
              </Collapsible>
            </Alert>
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
      ) : null}

      {view === "timeline" ? (
        <ReportTimeline items={report.timeline} tabbed={views.length > 1} />
      ) : null}

      {view === "evidence" && selectedEvidence ? (
        <section
          id="report-panel-evidence"
          className="rounded-xl border border-border bg-card p-5 mt-5 rounded-xl border border-border bg-card p-5"
          role="tabpanel"
          aria-labelledby="report-tab-evidence"
        >
          <header className="flex items-center justify-between gap-3">
            <div>
              <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                Evidence
              </p>
              <h2>Captured during this Run</h2>
            </div>
            <p>Only evidence Relay actually saved is shown here.</p>
          </header>
          <div className="grid gap-4">
            <Tabs
              value={selectedEvidence.id}
              onValueChange={(next) => setSelectedEvidenceId(next)}
              orientation="vertical"
            >
              <TabsList className="flex flex-wrap gap-2" aria-label="Evidence type">
                {report.evidence.map((section) => (
                  <TabsTrigger key={section.id} value={section.id}>
                    <span>
                      <strong>{section.label}</strong>
                      <small>{section.detail}</small>
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <EvidencePreview section={selectedEvidence} />
          </div>
          <RawEvidenceDisclosure
            runId={report.runId}
            runService={runService}
            open={rawEvidenceOpen}
            onOpenChange={setRawEvidenceOpen}
          />
        </section>
      ) : null}
    </section>
  );
}

type ReportView = "overview" | "timeline" | "evidence";

function reportView(value: unknown): ReportView {
  return value === "timeline" || value === "evidence" ? value : "overview";
}

function ReportTimeline({
  items,
  tabbed,
}: {
  items: Awaited<ReturnType<RunProductService["getReport"]>>["timeline"];
  tabbed: boolean;
}) {
  return (
    <section
      id="report-panel-timeline"
      className="rounded-xl border border-border bg-card p-5 mt-5"
      role={tabbed ? "tabpanel" : undefined}
      aria-labelledby={tabbed ? "report-tab-timeline" : undefined}
    >
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
            Timeline
          </p>
          <h2>What happened</h2>
        </div>
        <p>{items.length === 1 ? "1 recorded step" : `${items.length} recorded steps`}</p>
      </header>
      <ol className="mt-5 list-none space-y-2 p-0">
        {items.map((item, index) => (
          <li
            key={item.id}
            className={`grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3 rounded-md border border-border p-3`}
          >
            <span
              className="grid size-7 place-items-center rounded-full bg-muted text-xs font-medium"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <span className="grid min-w-0 gap-1">
              <strong>{item.title}</strong>
              <small>
                {timelineStateLabel(item.state)}
                {item.evidenceCount
                  ? ` · ${item.evidenceCount} ${item.evidenceCount === 1 ? "screenshot" : "screenshots"}`
                  : ""}
              </small>
            </span>
            {item.durationMs !== undefined ? (
              <span className="text-xs text-muted-foreground">
                {formatDuration(item.durationMs)}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function timelineStateLabel(
  state: Awaited<ReturnType<RunProductService["getReport"]>>["timeline"][number]["state"],
): string {
  if (state === "passed") return "Passed";
  if (state === "failed") return "Failed";
  if (state === "recovered") return "Recovered";
  if (state === "running") return "In progress";
  return "Not reached";
}

function EvidencePreview({
  section,
}: {
  section: Awaited<ReturnType<RunProductService["getReport"]>>["evidence"][number];
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-live="polite">
      <header>
        <div>
          <h3>{section.label}</h3>
          <p>{section.summary}</p>
        </div>
        <span>{section.detail}</span>
      </header>
      {section.items.length ? (
        <ScrollArea className="max-h-[420px] overflow-auto">
          <ol className={`list-none space-y-2 p-0`}>
            {section.items.map((item) => (
              <li
                key={item.id}
                className={`grid grid-cols-[96px_minmax(0,1fr)] gap-3 rounded-md border border-border p-2`}
              >
                {item.media ? (
                  <span
                    className="relay-evidence-image-frame overflow-hidden rounded-md bg-muted"
                    aria-hidden="true"
                  >
                    <img
                      src={item.media.src}
                      alt=""
                      width={item.media.width}
                      height={item.media.height}
                      loading="lazy"
                      decoding="async"
                    />
                  </span>
                ) : null}
                <span className="grid min-w-0 gap-1">
                  <strong>{item.title}</strong>
                  {item.detail ? <span>{item.detail}</span> : null}
                </span>
                {item.meta ? <small>{item.meta}</small> : null}
              </li>
            ))}
          </ol>
        </ScrollArea>
      ) : (
        <div className="grid min-h-[220px] place-items-center gap-2 rounded-xl border border-border bg-card p-4 text-center">
          <p>This evidence was saved, but it does not have a readable preview.</p>
          <span>Audit details remain available below.</span>
        </div>
      )}
    </section>
  );
}
