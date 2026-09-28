import type { PersistedRun } from "./runs.js";

export function summarizeRecipeStability(runs: readonly PersistedRun[]) {
  const passed = runs.filter(
    (run) =>
      run.review?.status !== "pending" &&
      run.review?.status !== "rejected" &&
      (run.outcome === "passed" || run.status === "ok" || run.status === "healed"),
  ).length;
  const productFailures = runs.filter((run) => run.outcome === "product-failure").length;
  const harnessFailures = runs.filter((run) => run.outcome === "harness-failure").length;
  const uncertain = runs.filter((run) => run.outcome === "uncertain").length;
  const judged = passed + productFailures;
  return {
    total: runs.length,
    passed,
    productFailures,
    harnessFailures,
    uncertain,
    passRate: judged > 0 ? passed / judged : null,
  };
}
