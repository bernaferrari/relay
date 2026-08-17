import type { JobInfo } from "./api-types";
import type { NavigationTransitionRepairEntry } from "./navigation-transition-health";

export type CampaignRecoveryAttempt = {
  kind: string;
  capturedAt?: number;
  target?: string;
  error?: string;
};

export type CampaignRecoveryInterventionModel = {
  capturedAt: number;
  checkId: string;
  checkTitle: string;
  transitionId: string;
  reason: string;
  message: string;
  screenshot: {
    caption: string;
    path?: string;
    width?: number;
    height?: number;
    frameIndex?: number;
    frame?: NonNullable<JobInfo["frames"]>[number];
  };
  current: {
    app?: string;
    header?: string;
    identity?: string;
    accessibilityAvailable: boolean;
    nodeCount: number;
    retainedNodeCount: number;
  };
  attempts: CampaignRecoveryAttempt[];
  recovery: {
    warmRecipeId?: string;
    proposedColdRecipeId?: string;
    implicitResumeAllowed: false;
    choices: string[];
  };
  repair: NavigationTransitionRepairEntry;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function selectorText(value: unknown): string | undefined {
  const item = object(value);
  if (!item) return undefined;
  const preferred = ["identifier", "label", "text", "ref"].flatMap((key) => {
    const value = text(item[key]);
    return value ? [`${key} “${value}”`] : [];
  });
  if (preferred.length > 0) return preferred.join(" · ");
  const point = object(item.point);
  const x = finite(point?.x);
  const y = finite(point?.y);
  return x === undefined || y === undefined ? undefined : `point (${x}, ${y})`;
}

export function campaignRecoveryInterventionFromJob(
  job: JobInfo,
): CampaignRecoveryInterventionModel | undefined {
  const interventionArtifact = [...(job.artifacts ?? [])]
    .reverse()
    .find((artifact) => artifact.kind === "campaign-recovery-intervention");
  const data = object(interventionArtifact?.data);
  const recovery = object(data?.recovery);
  const checkId = text(data?.checkId);
  const checkTitle = text(data?.checkTitle);
  const transitionId = text(data?.transitionId);
  const reason = text(data?.reason);
  const screenshot = object(data?.screenshot);
  const caption = text(screenshot?.caption);
  if (
    !interventionArtifact ||
    data?.schemaVersion !== 1 ||
    data.status !== "intervention-required" ||
    recovery?.implicitResumeAllowed !== false ||
    !checkId ||
    !checkTitle ||
    !transitionId ||
    !reason ||
    !caption
  ) {
    return undefined;
  }
  const request = [...(job.artifacts ?? [])].reverse().find((artifact) => {
    if (artifact.kind !== "human-intervention-requested") return false;
    const requestData = object(artifact.data);
    return (
      requestData?.interventionKind === "campaign-cold-recovery" &&
      requestData.checkId === checkId &&
      requestData.transitionId === transitionId &&
      object(requestData.recovery)?.implicitResumeAllowed === false
    );
  });
  const requestData = object(request?.data);
  const message = text(requestData?.message);
  if (!message) return undefined;

  const chrome = object(data.chrome);
  const screenIdentity = object(data.screenIdentity);
  const accessibility = object(data.accessibility);
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const frameIndex = (job.frames ?? []).findIndex((frame) => frame.caption === caption);
  const frame = frameIndex >= 0 ? job.frames?.[frameIndex] : undefined;
  const attempts = Array.isArray(data.attemptedSelectors)
    ? data.attemptedSelectors.flatMap((value): CampaignRecoveryAttempt[] => {
        const attempt = object(value);
        const attemptData = object(attempt?.data);
        const kind = text(attempt?.kind);
        if (!kind) return [];
        const target = selectorText(attemptData?.target ?? attemptData?.replacement);
        const error = text(attemptData?.error);
        return [
          {
            kind,
            ...(finite(attempt?.capturedAt) !== undefined
              ? { capturedAt: finite(attempt?.capturedAt) }
              : {}),
            ...(target ? { target } : {}),
            ...(error ? { error } : {}),
          },
        ];
      })
    : [];
  const choices = Array.isArray(recovery.choices)
    ? recovery.choices.flatMap((choice) => (text(choice) ? [text(choice)!] : []))
    : [];

  return {
    capturedAt: interventionArtifact.capturedAt,
    checkId,
    checkTitle,
    transitionId,
    reason,
    message,
    screenshot: {
      caption,
      ...(text(screenshot?.path ?? screenshot?.framePath)
        ? { path: text(screenshot?.path ?? screenshot?.framePath) }
        : {}),
      ...(finite(screenshot?.width) !== undefined ? { width: finite(screenshot?.width) } : {}),
      ...(finite(screenshot?.height) !== undefined ? { height: finite(screenshot?.height) } : {}),
      ...(frameIndex >= 0 ? { frameIndex, frame } : {}),
    },
    current: {
      ...(text(chrome?.app) ? { app: text(chrome?.app) } : {}),
      ...(text(chrome?.header) ? { header: text(chrome?.header) } : {}),
      ...(text(screenIdentity?.fingerprint) ? { identity: text(screenIdentity?.fingerprint) } : {}),
      accessibilityAvailable: accessibility?.available === true,
      nodeCount: finite(accessibility?.nodeCount) ?? 0,
      retainedNodeCount: nodes.length,
    },
    attempts,
    recovery: {
      ...(text(recovery.warmRecipeId) ? { warmRecipeId: text(recovery.warmRecipeId) } : {}),
      ...(text(recovery.proposedColdRecipeId)
        ? { proposedColdRecipeId: text(recovery.proposedColdRecipeId) }
        : {}),
      implicitResumeAllowed: false,
      choices,
    },
    repair: {
      transitionId,
      title: `Review repair for ${checkTitle}`,
      summary: reason,
      operationId: "run.repair.get",
      fixedInput: { runId: job.id, checkId },
    },
  };
}
