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
import { RecoveryState } from "../components/product-patterns";
import {
  findingNoteCaseId,
  findingScreenshotRunId,
  latestFindingDecision,
  latestFindingNote,
} from "./batch-finding-review";
import {
  batchResultContext,
  batchResultFacts,
  batchResultHeadline,
  formatBatchFindingCode,
} from "./batch-result-view";

const findingsLinkClass =
  "relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 font-semibold text-[var(--text-interactive-base)] underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]";

export function BatchResultSummary({ report }: { report: ProductBatchReport }) {
  const facts = batchResultFacts(report);
  const context = batchResultContext(report);
  return (
    <div className="relay-batch-summary mt-1 flex max-w-[80ch] flex-wrap items-center gap-x-3 gap-y-1">
      <p className="text-sm font-medium text-foreground">{batchResultHeadline(report)}</p>
      {context ? <p className="text-[13px] leading-5 text-muted-foreground">{context}</p> : null}
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] leading-5 tabular-nums">
        {facts.map((fact) => (
          <span
            key={fact.label}
            className={
              fact.tone === "critical"
                ? "text-[var(--text-critical-base)]"
                : fact.tone === "warning"
                  ? "text-[var(--text-warning-base)]"
                  : "text-muted-foreground"
            }
          >
            <span className="font-semibold">{fact.value}</span> {fact.label.toLowerCase()}
          </span>
        ))}
      </p>
      {report.report.action ? (
        <p className="text-sm font-medium text-foreground">{report.report.action}</p>
      ) : null}
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
  if (count) return null;
  const empty = planFindingsEmptyCopy(report, { hasProblems: gridHasProblems });
  return (
    <div className="relay-batch-findings-lead mt-5 max-w-[62ch]" role="status">
      <RecoveryState
        title={empty[0]}
        detail={empty[1]}
        action={
          <Link className={findingsLinkClass} to="/accounts">
            Check Sign-ins
          </Link>
        }
      />
      <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
        Confirm and Reject never accept a visual baseline. Review screenshots opens the Report and
        does not accept a baseline.
      </p>
    </div>
  );
}

export function BatchStabilityPanel({ report }: { report: ProductBatchReport }) {
  const stability = summarizeProductStability({
    samples: stabilitySamplesFromBatch(report),
    historyComplete: false,
  });
  const flake = stability.signals.find((signal) => itemKind(signal.kind));
  const recommendation = stability.recommendations[0];
  if (!flake && stability.trend !== "improving" && stability.trend !== "regressing") {
    return null;
  }
  return (
    <section className="relay-batch-stability mt-8" aria-labelledby="batch-stability-title">
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
        {stabilityTrendCopy(stability.trend)}
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
      <h2
        id="batch-findings-title"
        className="text-[20px] font-semibold tracking-tight text-foreground"
      >
        Findings
      </h2>
      <p className="mt-1 max-w-[62ch] text-sm leading-6 text-muted-foreground">
        {report.analysis.findings.length} finding
        {report.analysis.findings.length === 1 ? "" : "s"} to review. Confirm and Reject never
        accept a visual baseline.
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
      <details className="mt-3">
        <summary className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground">
          Copy as markdown
        </summary>
        <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
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
      <div className="min-w-0">
        <p className="text-[12px] leading-4 text-muted-foreground">
          {planFindingLaneLabel(lane)}
          {product && finding.severity === "critical" ? " · Critical" : ""}
          {" · "}
          <span className="sr-only">{finding.code}</span>
          {formatBatchFindingCode(finding.code)}
        </p>
        <h3 className="mt-0.5 text-sm font-semibold text-foreground">{finding.screenLabel}</h3>
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
        Proposed {proposal.verdict === "confirm" ? "Confirm" : "Reject"} —{" "}
        {findingProposalCopy(proposal.reason)}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {runId ? (
          <Link
            className={`${findingsLinkClass} inline-flex min-h-11 items-center`}
            to="/runs/$runId"
            params={{ runId }}
            search={{ reportView: "captures" }}
          >
            Review screenshots
          </Link>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="min-h-11"
            variant={decision === "confirm" ? "secondary" : "outline"}
            aria-pressed={decision === "confirm"}
            onClick={() => record(finding.id, "confirm", actorId, notes, onNotes)}
          >
            Confirm
          </Button>
          <Button
            size="sm"
            className="min-h-11"
            variant={decision === "reject" ? "secondary" : "outline"}
            aria-pressed={decision === "reject"}
            onClick={() => record(finding.id, "reject", actorId, notes, onNotes)}
          >
            Reject
          </Button>
        </div>
      </div>
      {recorded ? (
        <p className="text-xs leading-snug text-muted-foreground" role="status">
          {recorded.text.replace(/^(?:confirm|reject):\s*/u, "")}
        </p>
      ) : null}
    </li>
  );
}

function findingProposalCopy(reason: string): string {
  const trimmed = reason
    .replace(/\s*This still does not accept a visual baseline\.?/gu, "")
    .replace(/^This is Infra \([^)]+\), /u, "")
    .trim();
  return trimmed.replace(/^./u, (character) => character.toUpperCase());
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
