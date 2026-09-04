/** @jsxImportSource react */
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Button,
  Disclosure,
  Progress,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
  ScrollArea,
  Tabs,
  TabsIndicator,
  TabsList,
  TabsTrigger,
} from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Breadcrumbs, OutcomeMark } from "../components/product-patterns";
import {
  firstSentence,
  failureTitle,
  formatDuration,
  highlightJson,
  nextAction,
  outcomeSentence,
  readableJson,
} from "../components/run-report-formatters";
import type { ProductRunState, RunProductService } from "../data/run-product-service";
import { runQueryKeys } from "../data/run-queries";
import { clearRunPointerIfCurrent, readRunPointer } from "../data/run-pointer";
import { PageLoading, RecordingProblem, targetLabel } from "./recording-shared";

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
      <section className="relay-page relay-run-page">
        <Breadcrumbs items={[{ label: "Runs", to: "/runs" }, { label: "Run" }]} />
        <h1 className="relay-visually-hidden">{snapshot?.title ?? "Run unavailable"}</h1>
        <RecordingProblem
          className="relay-run-recovery"
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
      <section className="relay-page relay-run-page">
        <Breadcrumbs items={[{ label: "Runs", to: "/runs" }, { label: "In progress" }]} />
        <header className="relay-run-context-header">
          <p className="relay-eyebrow">Run</p>
          <h1>{snapshot?.title ?? "Loading Run"}</h1>
        </header>
        <PageLoading label="Loading the Run…" />
      </section>
    );
  }

  return (
    <section className="relay-page relay-run-page">
      <Breadcrumbs
        items={[
          { label: "Runs", to: "/runs" },
          ...(activePointer ? [{ label: snapshot?.title ?? "Test" }] : []),
          { label: "In progress" },
        ]}
      />
      <header className="relay-page-header relay-run-header">
        <div>
          <p className="relay-eyebrow">Run</p>
          <h1>{snapshot?.title ?? "Running Test"}</h1>
          <p className="relay-page-description">
            {snapshot?.progress.label ?? "Restoring progress…"}
          </p>
        </div>
        <div className="relay-run-header-actions">
          {activePointer ? (
            <Link
              className="relay-text-link relay-header-link"
              to="/tests/$testId"
              params={{ testId: activePointer.testId }}
            >
              Back to Test
            </Link>
          ) : null}
          {canCancel ? (
            <Button variant="secondary" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              {cancel.isPending ? "Cancelling…" : "Cancel Run"}
            </Button>
          ) : null}
        </div>
      </header>

      {snapshot ? (
        <div className="relay-run-progress" role="status">
          <div className="relay-run-progress-heading">
            <div>
              <p className="relay-section-label">Progress</p>
              <h2>{snapshot.progress.label}</h2>
            </div>
            {snapshot.target ? (
              <span>{targetLabel(targetPresentation.data?.[0] ?? snapshot.target).title}</span>
            ) : null}
          </div>
          {snapshot.progress.total !== undefined ? (
            <Progress
              className="relay-run-progress-meter"
              value={snapshot.progress.completed ?? 0}
              max={snapshot.progress.total}
            >
              <ProgressLabel>{snapshot.progress.label}</ProgressLabel>
              <ProgressValue>
                {() => `${snapshot.progress.completed ?? 0} of ${snapshot.progress.total}`}
              </ProgressValue>
              <ProgressTrack />
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
  const search = routeApi.useSearch() as { view?: unknown };
  const navigate = useNavigate({ from: "/runs/$runId" });
  const requestedView = reportView(search.view);
  const views = [
    { id: "overview" as const, label: "Overview", available: true },
    { id: "timeline" as const, label: "Timeline", available: report.timeline.length > 0 },
    { id: "evidence" as const, label: "Evidence", available: report.evidence.length > 0 },
  ].filter((view) => view.available);
  const view = views.some((item) => item.id === requestedView) ? requestedView : "overview";
  const [selectedEvidenceId, setSelectedEvidenceId] = useState(report.evidence[0]?.id);
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
    <section className="relay-page relay-report-page">
      {testId ? (
        <Link className="relay-back-link" to="/tests/$testId" params={{ testId }}>
          <ArrowLeft aria-hidden="true" /> Back to Test
        </Link>
      ) : (
        <Breadcrumbs items={[{ label: "Runs", to: "/runs" }, { label: "Report" }]} />
      )}
      <header className="relay-report-header">
        <div>
          <div className="relay-report-kicker">
            <OutcomeMark outcome={report.outcome} />
            <span>Run Report</span>
          </div>
          <h1>{report.title}</h1>
          <p className="relay-report-outcome">{outcomeSentence(report.outcome, target)}</p>
        </div>
        {!testId ? (
          <Link className="relay-text-link relay-header-link" to="/runs">
            All Runs
          </Link>
        ) : null}
      </header>

      {views.length > 1 ? (
        <Tabs value={view} onValueChange={(next) => selectView(next as ReportView)}>
          <TabsList className="relay-report-nav" variant="line" aria-label="Report view">
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
            <TabsIndicator />
          </TabsList>
        </Tabs>
      ) : null}

      {view === "overview" ? (
        <section
          id="report-panel-overview"
          className="relay-report-panel relay-report-overview"
          role={views.length > 1 ? "tabpanel" : undefined}
          aria-labelledby={views.length > 1 ? "report-tab-overview" : undefined}
        >
          <dl className="relay-report-facts">
            <div>
              <dt>Device or browser</dt>
              <dd>{report.targetName ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>
                {report.durationMs === undefined
                  ? "Not recorded"
                  : formatDuration(report.durationMs)}
              </dd>
            </div>
          </dl>

          {failure ? (
            <Alert
              className="relay-causal-failure"
              variant="danger"
              aria-labelledby="causal-failure-title"
            >
              <AlertIcon>
                <CircleAlert />
              </AlertIcon>
              <AlertTitle id="causal-failure-title">
                {failureTitle(failure, report.category)}
              </AlertTitle>
              <AlertDescription>{nextAction(report.outcome)}</AlertDescription>
              {report.category || testId ? (
                <AlertActions>
                  {report.category ? <Badge variant="danger">{report.category}</Badge> : null}
                  {testId ? (
                    <Button
                      size="small"
                      variant="secondary"
                      render={<Link to="/tests/$testId" params={{ testId }} />}
                    >
                      Open Test to run again
                    </Button>
                  ) : null}
                </AlertActions>
              ) : null}
              <Disclosure.Root className="relay-causal-technical">
                <Disclosure.Trigger>Technical details</Disclosure.Trigger>
                <Disclosure.Panel>
                  <ScrollArea className="relay-causal-technical-scroll">
                    <pre>{failure}</pre>
                  </ScrollArea>
                </Disclosure.Panel>
              </Disclosure.Root>
            </Alert>
          ) : null}

          {firstEvidenceIsDistinct && report.firstEvidence ? (
            <section className="relay-report-first-evidence" aria-labelledby="first-evidence-title">
              <p className="relay-section-label">
                {report.outcome === "passed" ? "What Relay verified" : "Evidence at this point"}
              </p>
              <h2 id="first-evidence-title">{report.firstEvidence.label}</h2>
              {report.firstEvidence.detail ? <p>{report.firstEvidence.detail}</p> : null}
            </section>
          ) : null}

          {report.evidenceUnavailable ? (
            <p className="relay-report-note" role="status">
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
          className="relay-report-panel relay-report-evidence"
          role="tabpanel"
          aria-labelledby="report-tab-evidence"
        >
          <header className="relay-report-section-header">
            <div>
              <p className="relay-section-label">Evidence</p>
              <h2>Captured during this Run</h2>
            </div>
            <p>Only evidence Relay actually saved is shown here.</p>
          </header>
          <div className="relay-evidence-workspace">
            <Tabs
              value={selectedEvidence.id}
              onValueChange={(next) => setSelectedEvidenceId(next)}
              orientation="vertical"
            >
              <TabsList className="relay-evidence-channels" aria-label="Evidence type">
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
      className="relay-report-panel relay-report-timeline"
      role={tabbed ? "tabpanel" : undefined}
      aria-labelledby={tabbed ? "report-tab-timeline" : undefined}
    >
      <header className="relay-report-section-header">
        <div>
          <p className="relay-section-label">Timeline</p>
          <h2>What happened</h2>
        </div>
        <p>{items.length === 1 ? "1 recorded step" : `${items.length} recorded steps`}</p>
      </header>
      <ol className="relay-report-timeline-list">
        {items.map((item, index) => (
          <li
            key={item.id}
            className={`relay-report-timeline-item relay-report-timeline-item--${item.state}`}
          >
            <span className="relay-report-timeline-index" aria-hidden="true">
              {index + 1}
            </span>
            <span className="relay-report-timeline-copy">
              <strong>{item.title}</strong>
              <small>
                {timelineStateLabel(item.state)}
                {item.evidenceCount
                  ? ` · ${item.evidenceCount} ${item.evidenceCount === 1 ? "screenshot" : "screenshots"}`
                  : ""}
              </small>
            </span>
            {item.durationMs !== undefined ? (
              <span className="relay-report-timeline-duration">
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
    <section className="relay-evidence-preview" aria-live="polite">
      <header>
        <div>
          <h3>{section.label}</h3>
          <p>{section.summary}</p>
        </div>
        <span>{section.detail}</span>
      </header>
      {section.items.length ? (
        <ScrollArea className="relay-evidence-items-scroll">
          <ol className={`relay-evidence-items relay-evidence-items--${section.id}`}>
            {section.items.map((item) => (
              <li
                key={item.id}
                className={`relay-evidence-item relay-evidence-item--${item.tone ?? "neutral"}${item.media ? " relay-evidence-item--media" : ""}`}
              >
                {item.media ? (
                  <span className="relay-evidence-image-frame" aria-hidden="true">
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
                <span className="relay-evidence-item-copy">
                  <strong>{item.title}</strong>
                  {item.detail ? <span>{item.detail}</span> : null}
                </span>
                {item.meta ? <small>{item.meta}</small> : null}
              </li>
            ))}
          </ol>
        </ScrollArea>
      ) : (
        <div className="relay-evidence-preview-empty">
          <p>This evidence was saved, but it does not have a readable preview.</p>
          <span>Audit details remain available below.</span>
        </div>
      )}
    </section>
  );
}

function RawEvidenceDisclosure({
  runId,
  runService,
  open,
  onOpenChange,
}: {
  runId: string;
  runService: RunProductService;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [copied, setCopied] = useState(false);
  const evidence = useQuery({
    queryKey: runQueryKeys.rawEvidence(runId),
    queryFn: () => runService.getRawEvidence(runId),
    enabled: open,
    staleTime: Infinity,
  });

  return (
    <Disclosure.Root
      id="raw-evidence"
      className="relay-raw-evidence"
      open={open}
      onOpenChange={onOpenChange}
    >
      <Disclosure.Trigger>Audit details</Disclosure.Trigger>
      <Disclosure.Panel>
        <div className="relay-raw-evidence-body">
          <div className="relay-raw-evidence-heading">
            <p>
              Technical evidence for forensic review. It may include internal identifiers and
              captured content.
            </p>
            {evidence.data !== undefined ? (
              <Button
                size="small"
                variant="secondary"
                onClick={async () => {
                  if (!navigator.clipboard) return;
                  try {
                    await navigator.clipboard.writeText(readableJson(evidence.data));
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1_500);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? "Copied" : "Copy JSON"}
              </Button>
            ) : null}
          </div>
          {evidence.isPending ? <PageLoading label="Loading audit details…" /> : null}
          {evidence.isError ? (
            <div className="relay-raw-evidence-error" role="alert">
              <p>Audit details could not be loaded. The Report outcome above is unchanged.</p>
              <Button size="small" variant="secondary" onClick={() => void evidence.refetch()}>
                Try again
              </Button>
            </div>
          ) : null}
          {evidence.data !== undefined ? (
            <ScrollArea className="relay-raw-evidence-scroll">
              <pre tabIndex={0} aria-label="Raw evidence JSON">
                <code>{highlightJson(readableJson(evidence.data))}</code>
              </pre>
            </ScrollArea>
          ) : null}
        </div>
      </Disclosure.Panel>
    </Disclosure.Root>
  );
}
