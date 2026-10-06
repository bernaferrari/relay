import { basename } from "node:path";
import { parseOptionalSourceRevision, type RunPanelManifest } from "@relay/protocol";
import { captureReviewQueueForPlan } from "./capture-review-plan.js";
import { redactText } from "./redaction.js";
import type { PersistedRun } from "./runs.js";
import { parseAppMapTestExecutionIntentArtifact } from "./app-map-test-execution-intent.js";
import { parseAppMapCombineCellExecutionIntentArtifact } from "./app-map-combine-cell-intent.js";

const text = (value: string) => redactText(value).slice(0, 240);
const revisionDisplayText = (value: string) => {
  const redacted = redactText(value);
  return redacted.length > 240 ? `${redacted.slice(0, 239)}…` : redacted;
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Same frozen obligations and review decisions as the Plan gallery and export. */
export function buildRunPanelManifest(
  run: PersistedRun,
  input: { offset?: number; limit?: number } = {},
): RunPanelManifest {
  const queue = captureReviewQueueForPlan([run]);
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  const limit = Math.max(1, Math.min(40, Math.floor(input.limit ?? 40)));
  const history = (run.steps ?? []).filter(
    (step) => step.status === "error" || step.status === "healed" || step.heal,
  );
  const checks = (run.artifacts ?? [])
    .filter((artifact) => artifact.kind === "campaign-check-result")
    .map((artifact) => {
      const data = object(artifact.data);
      return {
        title: text(typeof data.title === "string" ? data.title : "Check"),
        status: text(typeof data.status === "string" ? data.status : "unknown"),
      };
    });
  const revision = parseOptionalSourceRevision(run.sourceRevision);
  const sourceRevision = revision
    ? {
        ...revision,
        ...(revision.branch !== undefined ? { branch: revisionDisplayText(revision.branch) } : {}),
        ...(revision.artifactDigest !== undefined
          ? { artifactDigest: revisionDisplayText(revision.artifactDigest) }
          : {}),
        ...(revision.buildId !== undefined
          ? { buildId: revisionDisplayText(revision.buildId) }
          : {}),
      }
    : undefined;
  const intent = (run.artifacts ?? []).flatMap((artifact) => {
    const parsed =
      parseAppMapTestExecutionIntentArtifact(artifact) ??
      parseAppMapCombineCellExecutionIntentArtifact(artifact)?.child;
    return parsed ? [parsed] : [];
  })[0];
  return {
    schemaVersion: 1,
    run: {
      id: run.id,
      name: text(run.title ?? run.action ?? "Run"),
      status: run.status,
      ...(run.outcome ? { outcome: run.outcome } : {}),
      ...(run.startedAt !== undefined ? { startedAt: run.startedAt } : {}),
      ...(run.finishedAt !== undefined ? { finishedAt: run.finishedAt } : {}),
      attempts: run.attempts ?? 1,
      ...(run.retryOf ? { retryOf: run.retryOf } : {}),
      ...(run.retriedBy ? { retriedBy: run.retriedBy } : {}),
      ...(run.healMessage ? { repair: text(run.healMessage) } : {}),
      ...(sourceRevision ? { sourceRevision } : {}),
      ...(intent
        ? {
            sourceTest: {
              appMapId: intent.sourcePlan.appMapId,
              testId: intent.sourcePlan.testId,
              appMapRevision: intent.sourcePlan.appMapRevision,
              ...(intent.plan.testFamily
                ? { testRevision: intent.plan.testFamily.testRevision }
                : {}),
            },
          }
        : {}),
      ...(run.review
        ? { review: { status: run.review.status, reason: text(run.review.reason) } }
        : {}),
      history: history.slice(0, 20).map((step) => ({
        title: text(step.title),
        status: step.status ?? "unknown",
        ...(step.heal ? { heal: text(step.heal) } : {}),
      })),
      historyCount: history.length,
    },
    coverage: queue.summary,
    checks: {
      passed: checks.filter((check) => check.status === "passed").length,
      failed: checks.filter((check) => check.status === "failed").length,
      needsReview: checks.filter((check) => !["passed", "failed"].includes(check.status)).length,
      items: checks.slice(0, 20),
      totalCount: checks.length,
      truncated: checks.length > 20,
    },
    frames: {
      offset,
      totalCount: queue.items.length,
      ...(offset + limit < queue.items.length ? { nextOffset: offset + limit } : {}),
      truncated: offset > 0 || offset + limit < queue.items.length,
      items: queue.items.slice(offset, offset + limit).map((item, index) => ({
        index: offset + index,
        captureId: item.captureId,
        caption: text(item.caption),
        status: item.status,
        blocked: item.blocked === true,
        ...(item.attempt !== undefined ? { attempt: item.attempt } : {}),
        ...(item.iteration !== undefined ? { iteration: item.iteration } : {}),
        ...(item.phase ? { phase: text(item.phase) } : {}),
        ...(item.observed
          ? {
              observed: {
                ...(item.observed.laneId ? { laneId: text(item.observed.laneId) } : {}),
                ...(item.observed.profileId ? { profileId: text(item.observed.profileId) } : {}),
              },
            }
          : {}),
        ...(item.framePath && /^(?:frames\/)?[^/\\]+\.png$/iu.test(item.framePath)
          ? { file: basename(item.framePath) }
          : {}),
        ...(item.imageSha256 && /^[a-f0-9]{64}$/u.test(item.imageSha256)
          ? { imageSha256: item.imageSha256 }
          : {}),
        ...(item.configuration
          ? {
              configuration: Object.fromEntries(
                Object.entries(item.configuration)
                  .filter((entry): entry is [string, string] => typeof entry[1] === "string")
                  .map(([key, value]) => [key, text(value)]),
              ),
            }
          : {}),
      })),
    },
  };
}
