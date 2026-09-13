/** @jsxImportSource react */
import type { CombineEvidenceAnalysisReport } from "@relay/protocol";
import type { ProductBatchReport } from "@relay/product/run-across";
import { Button } from "@relay/ui-react/components/button";
import { Link } from "@tanstack/react-router";
import {
  planFindingReviewEffect,
  planFindingsEmptyCopy,
  renderPlanFindingsMarkdown,
} from "@relay/product/plan-findings";
import {
  summarizeProductStability,
  stabilitySamplesFromBatch,
} from "../data/stability-product-service";
import { appendBatchReviewNote, type BatchReviewNote } from "../data/batch-review-notes";

const findingsLinkClass =
  "relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 font-semibold text-[var(--text-interactive-base)] underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]";

export function BatchFindingsLead({ report }: { report: CombineEvidenceAnalysisReport }) {
  const count = report.analysis.findings.length;
  if (!count) {
    return (
      <p
        className="relay-batch-findings-lead mt-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
        role="status"
      >
        {planFindingsEmptyCopy(report)[0]} {planFindingsEmptyCopy(report)[1]} Confirm and Reject
        never accept a visual baseline. Accept a baseline from a Report.{" "}
        <Link className={`${findingsLinkClass} whitespace-nowrap`} to="/accounts">
          Check Sign-ins
        </Link>
      </p>
    );
  }
  return (
    <p
      className="relay-batch-findings-lead mt-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
      role="status"
    >
      {count} finding{count === 1 ? "" : "s"} to review below. Confirm is a product issue. Reject is
      not a product failure this run. Confirm and Reject never accept a visual baseline.
    </p>
  );
}

export function BatchStabilityPanel({ report }: { report: ProductBatchReport }) {
  const stability = summarizeProductStability({
    samples: stabilitySamplesFromBatch(report),
    historyComplete: false,
  });
  const flake = stability.signals.find((signal) => itemKind(signal.kind));
  return (
    <section className="relay-batch-stability mt-8" aria-labelledby="batch-stability-title">
      <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
        Trend
      </p>
      <h2 id="batch-stability-title">Stability</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {stability.passedCount} passed · {stability.failedCount} product issues · trend{" "}
        {stability.trend}
        {flake ? ` · ${flake.summary}` : ""}
      </p>
    </section>
  );
}

function itemKind(kind: string): boolean {
  return kind === "possible-flakiness" || kind === "mixed-outcomes";
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
      <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
        Findings
      </p>
      <h2 id="batch-findings-title">Review</h2>
      <pre className="mt-3 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-xs leading-5">
        {renderPlanFindingsMarkdown(report)}
      </pre>
      <ul className="mt-4 grid list-none gap-3 p-0">
        {report.analysis.findings.map((finding) => (
          <li key={finding.id} className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{finding.code}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => record(finding.id, "confirm", actorId, notes, onNotes)}
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => record(finding.id, "reject", actorId, notes, onNotes)}
            >
              Reject
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function record(
  findingId: string,
  decision: "confirm" | "reject",
  actorId: string | undefined,
  notes: readonly BatchReviewNote[],
  onNotes: (notes: readonly BatchReviewNote[]) => void,
) {
  const effect = planFindingReviewEffect(decision);
  const actor = actorId?.trim() || "human:local";
  onNotes(
    appendBatchReviewNote(notes, {
      caseId: `finding:${findingId}`,
      text: `${decision}: ${effect.note}`,
      at: Date.now(),
      actorId: actor,
    }),
  );
}
