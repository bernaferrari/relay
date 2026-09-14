/** @jsxImportSource react */
import type { CombineEvidenceAnalysisReport, CombineEvidenceFinding } from "@relay/protocol";
import type { ProductBatchReport } from "@relay/product/run-across";
import { Button } from "@relay/ui-react/components/button";
import { Link } from "@tanstack/react-router";
import {
  planFindingLane,
  planFindingLaneLabel,
  planFindingReviewEffect,
  planFindingsEmptyCopy,
  proposePlanFinding,
  renderPlanFindingsMarkdown,
} from "@relay/product/plan-findings";
import {
  summarizeProductStability,
  stabilitySamplesFromBatch,
} from "../data/stability-product-service";
import { appendBatchReviewNote, type BatchReviewNote } from "../data/batch-review-notes";
import {
  findingNoteCaseId,
  findingScreenshotRunId,
  latestFindingDecision,
  latestFindingNote,
} from "./batch-finding-review";
import { batchResultContext, batchResultFacts, batchResultHeadline } from "./batch-result-view";

const findingsLinkClass =
  "relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 font-semibold text-[var(--text-interactive-base)] underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]";

export function BatchResultSummary({ report }: { report: ProductBatchReport }) {
  const facts = batchResultFacts(report);
  const context = batchResultContext(report);
  const columns =
    facts.length <= 2 ? "grid-cols-2" : facts.length === 3 ? "grid-cols-3" : "grid-cols-4";
  return (
    <div className="relay-batch-summary mt-1 grid gap-4">
      <div className="grid max-w-[62ch] gap-1.5">
        <p className="text-[17px] font-medium leading-6 text-pretty text-foreground">
          {batchResultHeadline(report)}
        </p>
        {context ? <p className="text-[13px] leading-5 text-muted-foreground">{context}</p> : null}
        {report.report.action ? (
          <p className="text-sm font-medium text-foreground">{report.report.action}</p>
        ) : null}
      </div>
      <dl
        className={`relay-batch-facts grid gap-x-6 gap-y-3 max-[780px]:grid-cols-2 ${columns}`}
      >
        {facts.map((fact) => (
          <div className="flex min-w-0 flex-col-reverse gap-1" key={fact.label}>
            <dt className="text-[13px] leading-5 text-muted-foreground">{fact.label}</dt>
            <dd
              className={`text-[28px] font-semibold leading-8 tracking-tight tabular-nums ${
                fact.tone === "critical"
                  ? "text-[var(--text-critical-base)]"
                  : "text-foreground"
              }`}
            >
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function BatchFindingsLead({
  report,
  gridHasProblems,
}: {
  report: CombineEvidenceAnalysisReport;
  gridHasProblems?: boolean;
}) {
  const count = report.analysis.findings.length;
  if (!count) {
    const empty = planFindingsEmptyCopy(report, { hasProblems: gridHasProblems });
    return (
      <div className="relay-batch-findings-lead mt-5 grid max-w-[62ch] gap-1.5" role="status">
        <p className="text-sm leading-6 text-foreground">{empty[0]}</p>
        <p className="text-[13px] leading-5 text-muted-foreground">
          {empty[1]} Confirm and Reject never accept a visual baseline. Review screenshots opens the
          Report and does not accept a baseline.{" "}
          <Link className={`${findingsLinkClass} whitespace-nowrap`} to="/accounts">
            Check Sign-ins
          </Link>
        </p>
      </div>
    );
  }
  return (
    <p
      className="relay-batch-findings-lead mt-5 max-w-[62ch] text-sm leading-6 text-muted-foreground"
      role="status"
    >
      {count} finding{count === 1 ? "" : "s"} to review below. Confirm is a product issue. Reject is
      not a product failure this run. Confirm and Reject never accept a visual baseline. Review
      screenshots opens the Report — same as <code>relay run visual review</code>, not an accept.
    </p>
  );
}

export function BatchStabilityPanel({ report }: { report: ProductBatchReport }) {
  const stability = summarizeProductStability({
    samples: stabilitySamplesFromBatch(report),
    historyComplete: false,
  });
  const flake = stability.signals.find((signal) => itemKind(signal.kind));
  const recommendation = stability.recommendations[0];
  return (
    <section className="relay-batch-stability mt-8" aria-labelledby="batch-stability-title">
      <p className="text-[13px] leading-5 text-muted-foreground">Trend</p>
      <h2
        id="batch-stability-title"
        className="text-[20px] font-semibold tracking-tight text-foreground"
      >
        Stability
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        <span className="tabular-nums">{stability.passedCount}</span> passed ·{" "}
        <span className="tabular-nums">{stability.failedCount}</span> product issues
        {stability.passRate === null
          ? " · this Result only"
          : ` · ${Math.round(stability.passRate * 100)}% passed`}
        {flake ? ` · ${flake.summary}` : ""}
      </p>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">
        {stabilityTrendCopy(stability.trend)} Confirm and Reject still never accept a visual
        baseline.
      </p>
      {recommendation ? (
        <p className="mt-2 text-xs leading-snug text-muted-foreground">{recommendation.summary}</p>
      ) : null}
    </section>
  );
}

function itemKind(kind: string): boolean {
  return kind === "possible-flakiness" || kind === "mixed-outcomes";
}

function stabilityTrendCopy(trend: string): string {
  if (trend === "improving") return "Improving across these cases.";
  if (trend === "regressing") return "Regressing across these cases.";
  if (trend === "stable") return "Stable across these cases.";
  return "Not enough comparable history on this Result.";
}

export function BatchFindingsPanel({
  report,
  actorId,
  notes,
  onNotes,
}: {
  report: CombineEvidenceAnalysisReport;
  actorId?: string;
  notes: readonly BatchReviewNote[];
  onNotes(notes: readonly BatchReviewNote[]): void;
}) {
  if (!report.analysis.findings.length) return null;
  return (
    <section className="relay-batch-findings mt-8" aria-labelledby="batch-findings-title">
      <p className="text-[13px] leading-5 text-muted-foreground">Findings</p>
      <h2
        id="batch-findings-title"
        className="text-[20px] font-semibold tracking-tight text-foreground"
      >
        Review
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Record a verdict per finding. That note is review only — it never accepts a screenshot
        baseline.
      </p>
      <ul className="mt-4 grid list-none gap-3 p-0">
        {report.analysis.findings.map((finding) => (
          <FindingReviewCard
            key={finding.id}
            finding={finding}
            report={report}
            actorId={actorId}
            notes={notes}
            onNotes={onNotes}
          />
        ))}
      </ul>
      <details className="mt-4 rounded-lg border border-border bg-muted/20 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-foreground">
          Copy as markdown
        </summary>
        <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs leading-5">
          {renderPlanFindingsMarkdown(report)}
        </pre>
      </details>
    </section>
  );
}

function FindingReviewCard({
  finding,
  report,
  actorId,
  notes,
  onNotes,
}: {
  finding: CombineEvidenceFinding;
  report: CombineEvidenceAnalysisReport;
  actorId?: string;
  notes: readonly BatchReviewNote[];
  onNotes(notes: readonly BatchReviewNote[]): void;
}) {
  const runId = findingScreenshotRunId(finding, report);
  const proposal = proposePlanFinding(finding);
  const lane = planFindingLane(finding);
  const decision = latestFindingDecision(notes, finding.id);
  const recorded = latestFindingNote(notes, finding.id);
  const product = lane === "product";
  return (
    <li
      className={`grid gap-3 rounded-xl border border-border bg-card p-4 ${
        product
          ? "border-l-[3px] border-l-border-critical-selected"
          : "border-l-[3px] border-l-border"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] leading-4 text-muted-foreground">
            {planFindingLaneLabel(lane)}
            {finding.severity === "critical" ? " · Critical" : ""}
          </p>
          <h3 className="mt-0.5 text-sm font-semibold text-foreground">{finding.screenLabel}</h3>
        </div>
        <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
          {finding.code}
        </span>
      </div>
      <p className="text-sm leading-snug text-foreground">{finding.detail}</p>
      {finding.expected || finding.observed ? (
        <p className="text-xs leading-snug text-muted-foreground">
          {finding.expected ? `Expected ${finding.expected}` : null}
          {finding.expected && finding.observed ? " · " : null}
          {finding.observed ? `saw ${finding.observed}` : null}
        </p>
      ) : null}
      <p className="text-xs leading-snug text-muted-foreground">
        Proposed {proposal.verdict === "confirm" ? "Confirm" : "Reject"} — {proposal.reason}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {runId ? (
          <Button
            nativeButton={false}
            size="sm"
            variant="outline"
            render={
              <Link to="/runs/$runId" params={{ runId }} search={{ reportView: "captures" }} />
            }
          >
            Review screenshots
          </Button>
        ) : null}
        <Button
          size="sm"
          variant={decision === "confirm" ? "default" : "outline"}
          aria-pressed={decision === "confirm"}
          onClick={() => record(finding.id, "confirm", actorId, notes, onNotes)}
        >
          Confirm
        </Button>
        <Button
          size="sm"
          variant={decision === "reject" ? "default" : "ghost"}
          aria-pressed={decision === "reject"}
          onClick={() => record(finding.id, "reject", actorId, notes, onNotes)}
        >
          Reject
        </Button>
      </div>
      {recorded ? (
        <p className="text-xs leading-snug text-muted-foreground" role="status">
          {recorded.text.replace(/^(?:confirm|reject):\s*/u, "")}
        </p>
      ) : (
        <p className="text-xs leading-snug text-muted-foreground">
          Not recorded yet. Confirm and Reject never accept a visual baseline.
        </p>
      )}
    </li>
  );
}

function record(
  findingId: string,
  decision: "confirm" | "reject",
  actorId: string | undefined,
  notes: readonly BatchReviewNote[],
  onNotes: (notes: readonly BatchReviewNote[]) => void,
) {
  if (latestFindingDecision(notes, findingId) === decision) return;
  const effect = planFindingReviewEffect(decision);
  const actor = actorId?.trim() || "human:local";
  onNotes(
    appendBatchReviewNote(notes, {
      caseId: findingNoteCaseId(findingId),
      text: `${decision}: ${effect.note}`,
      at: Date.now(),
      actorId: actor,
    }),
  );
}
