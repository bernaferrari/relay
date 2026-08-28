import type { CombineEvidenceFinding, EvidenceChannelRecord } from "@relay/protocol";
import { failedStepFromTrace } from "@relay/protocol";
import type { JobInfo } from "./api-types";
import type { CombineCapture, CombineRow } from "./combine-review";
import { combineCaseIdentity } from "./combine-review";
import type { CombineCellAnalysis, CombineCellVerdict } from "./combine-verdict";
import { combineVerdictPresentation } from "./combine-verdict";
import { sameAppMapTestTupleIdentity } from "@relay/protocol";
import { friendlyError, readableFailure } from "./run-failure-presentation";

export type RepeatResultDecision = {
  label: string;
  detail: string;
  tone: "pass" | "review" | "blocked" | "pending";
};

export type RepeatResultEvidenceSummary = {
  decision: RepeatResultDecision;
  structuralFindings: readonly CombineEvidenceFinding[];
  localizationFindings: readonly CombineEvidenceFinding[];
  semanticFindings: readonly string[];
  firstCausalFailure?: string;
  crash?: string;
  recentLogs: readonly string[];
  selectorReasoning?: string;
  evidence: {
    status: "complete" | "partial" | "collecting";
    channels: readonly EvidenceChannelRecord[];
    missing: readonly string[];
  };
};

export type PreviousApprovedRepeatCapture = {
  job: JobInfo;
  capture: NonNullable<CombineCapture["frame"]>;
};

function targetIdentity(job: JobInfo): string | undefined {
  if (job.targetProfile) {
    return JSON.stringify([job.targetProfile.platform, job.targetProfile.targetId]);
  }
  return job.serial?.trim() || undefined;
}

function authoredFrames(job: JobInfo) {
  const requested = (job.frames ?? []).filter((frame) =>
    /^(screen|tour|final):/u.test(frame.caption),
  );
  return requested.length ? requested : (job.frames ?? []);
}

function checkpointName(caption: string): string {
  return caption.replace(/^(screen|tour|final):/u, "").trim();
}

/** Find only a prior result that a person explicitly approved for the exact
 * dimension tuple, target, Test, and checkpoint. A generic earlier Run is not
 * silently promoted into a visual baseline. */
export function findPreviousApprovedRepeatCapture(
  history: readonly JobInfo[],
  current: JobInfo,
  checkpoint: string,
): PreviousApprovedRepeatCapture | null {
  const currentAt = current.finishedAt ?? current.startedAt ?? current.queuedAt;
  const currentTarget = targetIdentity(current);
  const currentCase = combineCaseIdentity(current);
  if (!currentTarget || !currentCase) return null;
  const candidate = history
    .filter(
      (job) =>
        job.id !== current.id &&
        job.batchId !== current.batchId &&
        Boolean(combineCaseIdentity(job)) &&
        sameAppMapTestTupleIdentity(combineCaseIdentity(job)!, currentCase) &&
        job.review?.status === "approved" &&
        job.review.capability === "visual-baseline" &&
        targetIdentity(job) === currentTarget &&
        (job.finishedAt ?? job.startedAt ?? job.queuedAt) < currentAt,
    )
    .sort(
      (left, right) =>
        (right.finishedAt ?? right.startedAt ?? right.queuedAt) -
        (left.finishedAt ?? left.startedAt ?? left.queuedAt),
    )
    .find((job) =>
      authoredFrames(job).some((frame) => checkpointName(frame.caption) === checkpoint),
    );
  if (!candidate) return null;
  const capture = authoredFrames(candidate).find(
    (frame) => checkpointName(frame.caption) === checkpoint,
  );
  return capture ? { job: candidate, capture } : null;
}

export function repeatTupleLabel(row: CombineRow): string {
  return row.values.length
    ? row.values.map((value) => `${value.name}: ${value.value}`).join(" · ")
    : row.world;
}

export function repeatResultDecision(verdict: CombineCellVerdict): RepeatResultDecision {
  const presentation = combineVerdictPresentation(verdict);
  if (verdict === "pass" || verdict === "known") {
    return { label: "Passed", detail: presentation.hint, tone: "pass" };
  }
  if (verdict === "pending") {
    return { label: "Still running", detail: presentation.hint, tone: "pending" };
  }
  if (verdict === "failed") {
    return {
      label: "Could not verify",
      detail: "The Test stopped before this checkpoint could be proved.",
      tone: "blocked",
    };
  }
  if (verdict === "unanalyzed" || verdict === "missing") {
    return {
      label: "Evidence incomplete",
      detail: presentation.hint,
      tone: "blocked",
    };
  }
  return {
    label: "Needs review",
    detail: presentation.hint,
    tone: "review",
  };
}

function semanticFindings(job: JobInfo): string[] {
  return (job.artifacts ?? [])
    .filter((artifact) => artifact.kind === "semantic-evaluation")
    .flatMap((artifact) => {
      if (!artifact.data || typeof artifact.data !== "object" || Array.isArray(artifact.data)) {
        return [];
      }
      const data = artifact.data as Record<string, unknown>;
      const detail = data.summary ?? data.reason ?? data.detail;
      return typeof detail === "string" && detail.trim() ? [detail.trim()] : [];
    })
    .slice(0, 8);
}

function selectorReasoning(job: JobInfo): string | undefined {
  const artifact = [...(job.artifacts ?? [])]
    .reverse()
    .find((item) => /selector|target-resolution|repair/iu.test(item.kind));
  if (!artifact?.data || typeof artifact.data !== "object" || Array.isArray(artifact.data)) {
    return undefined;
  }
  const data = artifact.data as Record<string, unknown>;
  const detail = data.explanation ?? data.reason ?? data.strategy ?? data.selector;
  return typeof detail === "string" && detail.trim() ? detail.trim() : undefined;
}

function crashDetail(job: JobInfo): string | undefined {
  const artifact = [...(job.artifacts ?? [])].reverse().find((item) => /crash/iu.test(item.kind));
  if (!artifact) return undefined;
  if (typeof artifact.data === "string" && artifact.data.trim()) return artifact.data.trim();
  if (artifact.data && typeof artifact.data === "object" && !Array.isArray(artifact.data)) {
    const data = artifact.data as Record<string, unknown>;
    const detail = data.message ?? data.reason ?? data.signal;
    if (typeof detail === "string" && detail.trim()) return detail.trim();
  }
  return "A crash artifact was captured for this result.";
}

export function projectRepeatResultEvidence(input: {
  job: JobInfo;
  verdict: CombineCellVerdict;
  analysis?: CombineCellAnalysis;
}): RepeatResultEvidenceSummary {
  const findings = input.analysis?.findings ?? [];
  const failed = failedStepFromTrace(input.job);
  const channels = Object.values(input.job.evidence?.channels ?? {});
  const missing = channels
    .filter((channel) => channel.status !== "captured")
    .map((channel) => `${channel.channel}: ${channel.status}`);
  const active = ["queued", "running", "paused"].includes(input.job.status);
  return {
    decision: repeatResultDecision(input.verdict),
    structuralFindings: findings.filter((finding) =>
      ["SCREEN_MISSING", "CONTROL_MISSING"].includes(finding.code),
    ),
    localizationFindings: findings.filter(
      (finding) => !["SCREEN_MISSING", "CONTROL_MISSING"].includes(finding.code),
    ),
    semanticFindings: semanticFindings(input.job),
    ...(failed
      ? {
          firstCausalFailure: `${failed.label} · ${input.job.failureCategory ? readableFailure(input.job.failureCategory, input.job.error) : "Test stopped"}${input.job.error ? ` · ${friendlyError(input.job.error)}` : ""}`,
        }
      : {}),
    ...(crashDetail(input.job) ? { crash: crashDetail(input.job) } : {}),
    recentLogs: (input.job.logs ?? []).slice(-5),
    ...(selectorReasoning(input.job) ? { selectorReasoning: selectorReasoning(input.job) } : {}),
    evidence: {
      status: active
        ? "collecting"
        : missing.length > 0 || !input.job.evidence
          ? "partial"
          : "complete",
      channels,
      missing,
    },
  };
}
