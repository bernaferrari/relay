/** @jsxImportSource react */
import { StatusPill, runStateOf } from "../components/run-status";
import { RunTestLink } from "./run-test-link";
import { TestWorkspaceHeader } from "../components/test-workspace";
import { catalogQueryKeys } from "../data/catalog-queries";
import { SavedRunStory } from "./run-story-pages";
import { initialRunStep } from "../data/run-timeline-selection";
import { WorkbenchPage } from "../components/page-layout";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { ChevronRight, CircleAlert } from "lucide-react";
import { useState } from "react";
import { IssueDraftButton } from "../components/issue-draft-button";
import {
  firstSentence,
  formatDuration,
  failureTitle,
  nextAction,
  outcomeSentence,
  resultHeading,
} from "../components/run-report-formatters";
import type { RunProductService } from "../data/run-product-service";
import { runQueryKeys } from "../data/run-queries";
import { RunWorkbench } from "./run-workbench";
import { EvidencePreview } from "./run-report-panels";
import { RunReplayStatus } from "./run-replay";
import { RunReportActions } from "./run-report-actions";
import { EmbeddedRunResult } from "../components/embedded-run-result";

export function RunReport({
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
  const { queryClient } = useRouteContext({ from: "__root__" });
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
  const canInvestigate =
    report.outcome === "product-failure" ||
    report.outcome === "uncertain" ||
    report.outcome === "harness-failure";
  const heading = resultHeading(report.outcome);
  const actions = (
    <RunReportActions
      report={report}
      testId={testId}
      runService={runService}
      embedded={embedded}
      canInvestigate={canInvestigate}
    />
  );
  const failureNotice = failure ? (
    <Dialog>
      <DialogTrigger
        aria-label="Technical details"
        className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
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

      <section className="flex min-h-0 flex-1 flex-col" aria-label="Run evidence">
        {report.timeline.length || report.evidence.length ? (
          <RunWorkbench
            key={report.runId}
            report={report}
            view={
              typeof search.reportView === "string"
                ? search.reportView
                : search.view === "evidence"
                  ? "captures"
                  : undefined
            }
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
            onReviewCapture={
              runService.reviewCapture
                ? async (input) => {
                    await runService.reviewCapture?.({ runId: report.runId, ...input });
                    void queryClient.invalidateQueries({ queryKey: catalogQueryKeys.runs });
                    await queryClient.invalidateQueries({
                      queryKey: runQueryKeys.report(report.runId),
                    });
                  }
                : undefined
            }
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
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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

  if (embedded)
    return (
      <EmbeddedRunResult
        key={report.runId}
        report={report}
        onReviewCaptures={() =>
          void navigate({
            to: "/runs/$runId",
            params: { runId: report.runId },
            search: { reportView: "captures" },
          })
        }
      />
    );

  const selectRunView = (reportView: string | undefined) =>
    void navigate({
      to: "/runs/$runId",
      params: { runId: report.runId },
      replace: true,
      resetScroll: false,
      search: (previous) => ({ ...previous, reportView }),
    });
  const header = (
    <TestWorkspaceHeader
      title={report.title}
      children={
        <>
          <RunTestLink testId={testId} />
          <span role="status">
            <StatusPill
              size="md"
              state={runStateOf({
                outcome: report.outcome,
                captureSummary: {
                  issue:
                    report.captureReview?.items.filter((item) => item.status === "issue").length ??
                    0,
                },
              })}
            />
          </span>
          {outcomeSentence(report.outcome, target, Boolean(report.captureReview?.items.length))}
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
  );
  if (
    (typeof search.reportView !== "string" || search.reportView === "story") &&
    search.view !== "evidence"
  ) {
    return (
      <WorkbenchPage className="flex h-full min-h-0 flex-col !p-0 overflow-auto">
        <SavedRunStory
          header={header}
          report={report}
          {...(testId ? { testId } : {})}
          runService={runService}
          onViewChange={selectRunView}
          extraActions={actions}
          summary={outcomeSentence(
            report.outcome,
            target,
            Boolean(report.captureReview?.items.length),
          )}
          notice={
            <>
              <RunReplayStatus runService={runService} />
              {failureNotice}
              {report.evidenceUnavailable ? (
                <p className="text-sm text-muted-foreground" role="status">
                  Evidence details are temporarily unavailable. The saved outcome above is
                  unchanged.
                </p>
              ) : null}
            </>
          }
        />
      </WorkbenchPage>
    );
  }
  return (
    <WorkbenchPage className="flex h-full min-h-0 flex-col !p-0 overflow-auto [&>header]:shrink-0">
      {header}
      <RunReplayStatus runService={runService} />
      {body}
    </WorkbenchPage>
  );
}
