import type { ProductRunReportOverview } from "./run-report-model";
import { storyFromReport } from "./run-story";

/** Follow the persisted failure taxonomy, without diagnosing from error copy. */
export function storyFailureNextAction(
  report: Pick<ProductRunReportOverview, "outcome" | "failureCategory">,
): "inspect" | "edit" | "setup" {
  if (report.outcome === "harness-failure") {
    if (report.failureCategory === "locator") return "edit";
    if (report.failureCategory === "environment" || report.failureCategory === "target-state")
      return "setup";
  }
  return "inspect";
}

/** The story owns only its first failed action. Keep a separate Run notice for
 * any unrelated, multiple, or recovery cause, even when another check overlaps. */
export function storyFailureOwnsCause(report: ProductRunReportOverview): boolean {
  if (report.outcome !== "product-failure") return false;
  const steps = storyFromReport({
    timeline: report.traceSteps?.length ? report.traceSteps : report.timeline,
    ...(report.stepEvidence ? { stepEvidence: report.stepEvidence } : {}),
  });
  const failure = steps
    .find((step) => step.state === "failed")
    ?.actions.find((action) => action.state === "failed")?.failure;
  if (failure?.kind !== "layout-overlap" || !failure.cause || !failure.technicalDetail)
    return false;
  const cause = (report.technicalCause ?? report.cause)?.trim();
  if (cause === failure.cause) return true;
  // The campaign wrapper reports one exact underlying check failure. A batch
  // with additional failed checks must retain its own Run-level explanation.
  return Boolean(
    cause &&
    !/[\r\n]/u.test(cause) &&
    cause.startsWith("1 campaign check failed: ") &&
    cause.endsWith(`: ${failure.cause}`),
  );
}
