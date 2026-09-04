/** @jsxImportSource react */
import { Button, ScrollArea } from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Breadcrumbs, OutcomeMark } from "../components/product-patterns";
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

      {loading ? <PageLoading label="Loading the Run…" /> : null}
      <RecordingProblem
        error={run.error ?? report.error ?? cancel.error}
        recovery={cancel.data?.recovery ?? state?.recovery}
        onRetry={() => {
          void pointer.refetch();
          void run.refetch();
          void report.refetch();
        }}
        retrying={run.isFetching || report.isFetching}
      />

      {!loading && snapshot && !state?.recovery ? (
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
            <div className="relay-run-progress-meter">
              <progress
                value={snapshot.progress.completed ?? 0}
                max={snapshot.progress.total}
                aria-label={snapshot.progress.label}
              />
              <span>
                {snapshot.progress.completed ?? 0} of {snapshot.progress.total}
              </span>
            </div>
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
  function moveView(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % views.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + views.length) % views.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = views.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = views[nextIndex];
    if (!next) return;
    selectView(next.id);
    window.requestAnimationFrame(() => document.getElementById(`report-tab-${next.id}`)?.focus());
  }
  return (
    <section className="relay-page relay-report-page">
      <Breadcrumbs
        items={[
          { label: "Runs", to: "/runs" },
          ...(testId ? [{ label: report.title }] : []),
          { label: "Report" },
        ]}
      />
      <header className="relay-report-header">
        <div>
          <div className="relay-report-kicker">
            <OutcomeMark outcome={report.outcome} />
            <span>Run Report</span>
          </div>
          <h1>{report.title}</h1>
          <p className="relay-report-outcome">{outcomeSentence(report.outcome, target)}</p>
        </div>
        {testId ? (
          <Link
            className="relay-text-link relay-header-link"
            to="/tests/$testId"
            params={{ testId }}
          >
            Back to Test
          </Link>
        ) : (
          <Link className="relay-text-link relay-header-link" to="/runs">
            All Runs
          </Link>
        )}
      </header>

      {views.length > 1 ? (
        <div className="relay-report-nav" role="tablist" aria-label="Report view">
          {views.map((item, index) => (
            <button
              key={item.id}
              id={`report-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={view === item.id}
              aria-controls={`report-panel-${item.id}`}
              tabIndex={view === item.id ? 0 : -1}
              onClick={() => selectView(item.id)}
              onKeyDown={(event) => moveView(event, index)}
            >
              {item.label}
            </button>
          ))}
        </div>
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
            <section className="relay-causal-failure" aria-labelledby="causal-failure-title">
              <p className="relay-section-label">First problem</p>
              <h2 id="causal-failure-title">{firstSentence(failure)}</h2>
              {report.category ? (
                <p className="relay-causal-category">Category · {report.category}</p>
              ) : null}
              <p>{nextAction(report.outcome)}</p>
            </section>
          ) : null}

          {report.firstEvidence ? (
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
            <div className="relay-evidence-channels" aria-label="Evidence type">
              {report.evidence.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  aria-pressed={selectedEvidence.id === section.id}
                  onClick={() => setSelectedEvidenceId(section.id)}
                >
                  <span>
                    <strong>{section.label}</strong>
                    <small>{section.detail}</small>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </div>
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
                className={`relay-evidence-item relay-evidence-item--${item.tone ?? "neutral"}`}
              >
                <span className="relay-evidence-item-mark" aria-hidden="true" />
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
    <details
      id="raw-evidence"
      className="relay-raw-evidence"
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary>Audit details</summary>
      <div className="relay-raw-evidence-body">
        <div className="relay-raw-evidence-heading">
          <p>
            Technical evidence for forensic review. It may include internal identifiers and captured
            content.
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
    </details>
  );
}

function readableJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return "Raw evidence could not be formatted as JSON.";
  }
}

const JSON_TOKEN =
  /(?<string>"(?:\\.|[^"\\])*")(?<keySuffix>\s*:)?|(?<number>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(?<boolean>true|false)|(?<nil>null)/gu;

function highlightJson(json: string): ReactNode[] {
  const output: ReactNode[] = [];
  let cursor = 0;

  for (const match of json.matchAll(JSON_TOKEN)) {
    const index = match.index;
    if (index > cursor) output.push(json.slice(cursor, index));

    const groups = match.groups ?? {};
    const token = groups.string ?? groups.number ?? groups.boolean ?? groups.nil ?? match[0];
    const kind = groups.string
      ? groups.keySuffix
        ? "key"
        : "string"
      : groups.number
        ? "number"
        : groups.boolean
          ? "boolean"
          : "null";

    output.push(
      <span key={`${index}-${kind}`} className={`relay-json-token relay-json-token--${kind}`}>
        {token}
      </span>,
    );
    if (groups.keySuffix) output.push(groups.keySuffix);
    cursor = index + match[0].length;
  }

  if (cursor < json.length) output.push(json.slice(cursor));
  return output;
}

function outcomeSentence(
  outcome: Awaited<ReturnType<RunProductService["getReport"]>>["outcome"],
  target: string,
): string {
  if (outcome === "passed") return `This Test passed on ${target}.`;
  if (outcome === "product-failure") return `This Test found a product problem on ${target}.`;
  if (outcome === "harness-failure") return `Relay could not complete this Test on ${target}.`;
  if (outcome === "uncertain") return `Relay could not confirm the outcome on ${target}.`;
  if (outcome === "cancelled") return `This Run was cancelled on ${target}.`;
  return `Relay has not published a terminal outcome for this Run on ${target}.`;
}

function firstSentence(value: string): string {
  const line = value.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line.slice(0, 280).replace(/[.:!?]+$/u, "") + ".";
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  return `${minutes} min ${seconds} s`;
}

function nextAction(
  outcome: Awaited<ReturnType<RunProductService["getReport"]>>["outcome"],
): string {
  if (outcome === "product-failure") {
    return "Review this moment first, then decide whether the app or the saved Test needs to change.";
  }
  if (outcome === "harness-failure") {
    return "Reconnect the device or browser, then run this Test again.";
  }
  if (outcome === "uncertain") {
    return "Review the captured evidence before deciding whether to run this Test again.";
  }
  if (outcome === "cancelled") return "Run this Test again when the device or browser is ready.";
  return "Review the Report before taking the next action.";
}
