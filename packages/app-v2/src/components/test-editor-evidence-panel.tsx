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
    <aside className="relay-editor-evidence" aria-label="Selected step evidence">
      <div className="relay-editor-evidence-heading">
        <p className="relay-section-label">Evidence</p>
        <h2>{step ? "Latest proof for this step" : "Choose a step"}</h2>
        <p>
          {step
            ? "Compare the instruction with what Relay most recently captured."
            : "Evidence appears here without moving you away from the journey."}
        </p>
      </div>
      {step ? (
        <TestStepEvidencePreview step={step} report={report} hasRuns={hasRuns} loading={loading} />
      ) : (
        <span className="relay-editor-evidence-placeholder" aria-hidden="true" />
      )}
    </aside>
  );
}
