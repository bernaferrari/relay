/** @jsxImportSource react */
import { Link } from "@tanstack/react-router";
import type { ProductRunReportOverview } from "../data/run-product-service";

export function TestStepEvidencePreview({
  step,
  report,
  hasRuns,
  loading,
}: {
  step: { id: string; intent: string };
  report: ProductRunReportOverview | undefined;
  hasRuns: boolean;
  loading: boolean;
}) {
  const matches = report?.stepEvidence?.filter((item) => item.testStepId === step.id) ?? [];
  const titleId = `step-evidence-${step.id}`;

  return (
    <section className="relay-step-evidence" aria-labelledby={titleId}>
      <header className="relay-step-evidence-heading">
        <div>
          <p className="relay-section-label">Latest Run</p>
          <h3 id={titleId}>Evidence for this step</h3>
        </div>
        {report ? (
          <Link
            className="relay-inline-link"
            to="/runs/$runId"
            params={{ runId: report.runId }}
            search={{ view: "evidence" }}
          >
            Open report
          </Link>
        ) : null}
      </header>

      {loading ? <p className="relay-step-evidence-note">Loading the latest Run…</p> : null}
      {!loading && !hasRuns ? (
        <p className="relay-step-evidence-note">
          No Run evidence yet. Run this Test to capture evidence for this step.
        </p>
      ) : null}
      {!loading && hasRuns && !report ? (
        <p className="relay-step-evidence-note">The latest Run has not produced a report yet.</p>
      ) : null}
      {!loading && report && report.stepEvidence === undefined ? (
        <p className="relay-step-evidence-note">
          This older Run is not linked to individual Test steps. Its full evidence is still
          available in the report.
        </p>
      ) : null}
      {!loading && report?.stepEvidence && matches.length === 0 ? (
        <p className="relay-step-evidence-note">
          The latest Run did not save evidence for this step.
        </p>
      ) : null}
      {matches.length ? (
        <ol className="relay-step-evidence-occurrences" aria-label={`Evidence for ${step.intent}`}>
          {matches.map((item) => (
            <li key={`${item.traceStepId}:${item.occurrence}`}>
              <strong>Occurrence {item.occurrence}</strong>
              <span>{evidenceSummary(item.evidence)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function evidenceSummary(evidence: {
  framePaths: readonly string[];
  eventSequences: readonly number[];
  artifactKinds: readonly string[];
}): string {
  const parts = [
    countLabel(evidence.framePaths.length, "frame"),
    countLabel(evidence.eventSequences.length, "event"),
    countLabel(evidence.artifactKinds.length, "artifact"),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No saved evidence references";
}

function countLabel(count: number, label: string): string {
  return count ? `${count} ${label}${count === 1 ? "" : "s"}` : "";
}
