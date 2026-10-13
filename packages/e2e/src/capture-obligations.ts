import type { FinishedRun } from "e2e";
import type { ImportedArtifact } from "./artifacts.js";
import type { CaptureObligation } from "./import-spec.js";

export function resolveCaptureObligations(
  run: FinishedRun,
  artifacts: readonly ImportedArtifact[],
  obligations?: readonly CaptureObligation[],
) {
  const resolved = obligations?.map((obligation) => {
    const results = run.report.run.results.filter(
      (result) =>
        result.testId === obligation.testId &&
        result.targetId === obligation.targetId &&
        result.selected &&
        (obligation.agent === undefined || result.agent === obligation.agent) &&
        (obligation.repeat === undefined || result.repeat === obligation.repeat),
    );
    if (results.length !== 1)
      return {
        ...obligation,
        state: results.length ? "ambiguous" : "missing",
        artifactIds: [] as string[],
      };
    const result = results[0]!;
    const attempt = result.attempts.at(-1);
    const candidates =
      attempt?.steps.filter(
        (step) => step.api === "app.screenshot" && step.label === obligation.stepLabel,
      ) ?? [];
    if (obligation.occurrence === undefined && candidates.length > 1)
      return {
        ...obligation,
        resultId: result.id,
        attemptId: attempt?.id,
        state: "ambiguous",
        artifactIds: [] as string[],
      };
    const step = candidates[(obligation.occurrence ?? 1) - 1];
    const matches = step
      ? artifacts.filter(
          (item) =>
            item.ownerKind === "result" &&
            item.ownerId === result.id &&
            item.attemptId === attempt?.id &&
            item.source.kind === "screenshot" &&
            item.source.producer.kind === "step" &&
            item.source.producer.stepId === step.id,
        )
      : [];
    return {
      ...obligation,
      state: matches.some((item) => item.state === "available") ? "available" : "missing",
      resultId: result.id,
      attemptId: attempt?.id,
      ...(step ? { stepId: step.id } : {}),
      artifactIds: matches.map((item) => item.source.id),
    };
  });
  const identities = new Map<string, number>();
  for (const item of resolved ?? []) {
    if (!("stepId" in item) || !item.stepId) continue;
    const key = JSON.stringify([item.resultId, item.attemptId, item.stepId]);
    identities.set(key, (identities.get(key) ?? 0) + 1);
  }
  return resolved?.map((item) => {
    if (!("stepId" in item) || !item.stepId) return item;
    const key = JSON.stringify([item.resultId, item.attemptId, item.stepId]);
    return (identities.get(key) ?? 0) > 1 ? { ...item, state: "ambiguous", artifactIds: [] } : item;
  });
}
