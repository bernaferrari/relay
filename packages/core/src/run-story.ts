import type { TestJob } from "./session-contract.js";

export type RunStoryBeat = {
  at: number;
  kind: string;
  text: string;
  evidence?: string;
};

export type RunStory = {
  runId: string;
  title: string;
  summary: string;
  outcome?: string;
  beats: RunStoryBeat[];
  video?: string;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function beatFromArtifact(artifact: TestJob["artifacts"][number]): RunStoryBeat | undefined {
  const data = object(artifact.data);
  if (artifact.kind === "campaign-check-result") {
    const title = text(data?.title) ?? "Check";
    const status = text(data?.status) ?? "unknown";
    return {
      at: artifact.capturedAt,
      kind: artifact.kind,
      text: `${title} · ${status}`,
      ...(text(data?.error) ? { evidence: text(data?.error) } : {}),
    };
  }
  if (artifact.kind === "campaign-recovery-intervention") {
    return {
      at: artifact.capturedAt,
      kind: artifact.kind,
      text: `Stuck: ${text(data?.checkTitle) ?? "recovery"}`,
      ...(text(data?.reason) ? { evidence: text(data?.reason) } : {}),
    };
  }
  if (artifact.kind === "human-intervention-requested") {
    return {
      at: artifact.capturedAt,
      kind: artifact.kind,
      text: text(data?.message) ?? "Waiting for Resume",
    };
  }
  if (artifact.kind === "job.log" || artifact.kind === "log") {
    return {
      at: artifact.capturedAt,
      kind: artifact.kind,
      text: text(data?.line) ?? text(data?.message) ?? "Log",
    };
  }
  return undefined;
}

/** Narrative from existing run artifacts. No second product, no new evidence. */
export function buildRunStory(
  run: Pick<TestJob, "id" | "action" | "artifacts"> & {
    title?: string;
    status?: string;
    videoPath?: string;
    frames?: { caption?: string }[];
  },
): RunStory {
  const beats = (run.artifacts ?? [])
    .flatMap((artifact) => {
      const beat = beatFromArtifact(artifact);
      return beat ? [beat] : [];
    })
    .sort((left, right) => left.at - right.at)
    .slice(0, 80);
  const failed = beats.filter((beat) => /fail|stuck|blocked/i.test(beat.text));
  const summary = failed.length
    ? `${failed.length} stuck or failed beat${failed.length === 1 ? "" : "s"} on ${run.title ?? run.action}.`
    : `${beats.length} reviewed beat${beats.length === 1 ? "" : "s"} on ${run.title ?? run.action}.`;
  const videoCaption = run.frames?.find((frame) =>
    /video|record/i.test(frame.caption ?? ""),
  )?.caption;
  return {
    runId: run.id,
    title: run.title?.trim() || run.action,
    summary,
    ...(run.status ? { outcome: run.status } : {}),
    beats,
    ...(run.videoPath || videoCaption ? { video: run.videoPath ?? videoCaption } : {}),
  };
}
