import { ReportImage } from "./report-image";
/** @jsxImportSource react */
import { Link } from "@tanstack/react-router";
import type { ProductTestStep } from "@relay/product/catalog";
import { SavedRecordingPreview } from "./saved-recording-preview";
import { useState } from "react";
import type { ProductRunReportOverview } from "../data/run-product-service";

export function TestStepEvidencePreview({
  step,
  report,
  hasRuns,
  loading,
}: {
  step: Pick<ProductTestStep, "id" | "intent" | "label" | "recordingFrames">;
  report: ProductRunReportOverview | undefined;
  hasRuns: boolean;
  loading: boolean;
}) {
  if (!hasRuns && step.recordingFrames?.length) {
    return (
      <SavedRecordingPreview
        key={step.id}
        frames={step.recordingFrames}
        intent={step.label ?? step.intent}
      />
    );
  }
  const matches = report?.stepEvidence?.filter((item) => item.testStepId === step.id) ?? [];
  const titleId = `step-evidence-${step.id}`;

  const screenshotItems =
    report?.evidence.find((section) => section.id === "screenshot")?.items ?? [];

  return (
    <section className="h-full min-h-0 min-w-0 overflow-y-auto p-4" aria-labelledby={titleId}>
      <header className="flex items-start justify-between gap-3">
        <h3 id={titleId} className="text-[13px] font-medium text-muted-foreground">
          Step result
        </h3>
        {report ? (
          <Link
            className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
            to="/runs/$runId"
            params={{ runId: report.runId }}
            search={{ view: "evidence" }}
          >
            Open report
          </Link>
        ) : null}
      </header>

      {loading ? (
        <p className="mt-2 text-xs leading-normal text-muted-foreground">Loading the latest Run…</p>
      ) : null}
      {!loading && !hasRuns ? (
        <p className="mt-2 text-xs leading-normal text-muted-foreground">
          Run this test to see its result here.
        </p>
      ) : null}
      {!loading && hasRuns && !report ? (
        <p className="mt-2 text-xs leading-normal text-muted-foreground">
          The latest Run has not produced a report yet.
        </p>
      ) : null}
      {!loading && report?.stepEvidence && matches.length === 0 ? (
        <p className="mt-2 text-xs leading-normal text-muted-foreground">
          The latest Run did not save evidence for this step.
        </p>
      ) : null}
      {!loading && report && report.stepEvidence === undefined ? (
        <p className="mt-2 text-xs leading-normal text-muted-foreground">
          This legacy Run has no step-level evidence mapping. Its report remains available, but
          Relay cannot safely assign a screenshot to this step.
        </p>
      ) : null}
      {matches.length ? (
        <ol className="mt-3 grid gap-2 p-0" aria-label={`Evidence for ${step.intent}`}>
          {matches.map((item) => (
            <li
              className="grid gap-1 border-t border-border pt-2 text-xs"
              key={`${item.traceStepId}:${item.occurrence}`}
            >
              <strong>Occurrence {item.occurrence}</strong>
              <span className="text-muted-foreground">{evidenceSummary(item.evidence)}</span>
              {item.evidence.framePaths.length ? (
                <div className="grid gap-2">
                  {item.evidence.framePaths.map((framePath) => {
                    const frame = screenshotItems.find((candidate) => candidate.id === framePath);
                    return frame?.media ? (
                      <EvidenceImage key={framePath} frame={frame} />
                    ) : (
                      <span key={framePath} className="text-xs text-muted-foreground">
                        Screenshot not retained for <code>{framePath}</code>.
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function EvidenceImage({
  frame,
}: {
  frame: NonNullable<ProductRunReportOverview["evidence"][number]["items"][number]>;
}) {
  const [failed, setFailed] = useState(false);
  if (!frame.media || failed) {
    return (
      <span className="text-xs text-muted-foreground">
        {failed ? "Saved screenshot could not be loaded." : "Screenshot media is unavailable."}
      </span>
    );
  }
  return (
    <ReportImage
      className="block h-auto max-h-[65vh] w-full rounded-md border border-border object-contain"
      media={frame.media}
      alt={frame.title}
      width={frame.media.width}
      height={frame.media.height}
      onError={() => setFailed(true)}
    />
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
