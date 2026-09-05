/** @jsxImportSource react */
import type { AppMapScenarioTestStep } from "@relay/protocol";
import type { ProductRunReportOverview } from "../data/run-product-service";
import { TestStepEvidencePreview } from "./test-step-evidence-preview";

export function TestEditorEvidencePanel({
  step,
  report,
  hasRuns,
  loading,
}: {
  step: AppMapScenarioTestStep | undefined;
  report: ProductRunReportOverview | undefined;
  hasRuns: boolean;
  loading: boolean;
}) {
  return (
    <aside
      className="sticky top-0 min-w-0 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm"
      aria-label="Selected step evidence"
    >
      <div className="grid gap-1">
        <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
          Evidence
        </p>
        <h2>{step ? "Latest proof for this step" : "Choose a step"}</h2>
        <p className="mt-1.5 text-xs leading-normal text-muted-foreground">
          {step
            ? "Compare the instruction with what Relay most recently captured."
            : "Evidence appears here without moving you away from the journey."}
        </p>
      </div>
      {step ? (
        <TestStepEvidencePreview step={step} report={report} hasRuns={hasRuns} loading={loading} />
      ) : (
        <span className="mt-4 block min-h-56 rounded-lg bg-muted" aria-hidden="true" />
      )}
    </aside>
  );
}
