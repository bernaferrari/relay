import type {
  ReportDiagnosticEvent,
  ReportEvidenceItem,
  ReportVideoMedia,
} from "./run-report-model";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function text(value: unknown): string | undefined {
  const result = typeof value === "string" ? value.trim().slice(0, 8_192) : "";
  return result || undefined;
}
function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function publicText(value: unknown): string | undefined {
  const result = text(value);
  return result && result.length <= 8_192 ? result : undefined;
}

const MAX_INLINE_EVIDENCE_BASE64_CHARS = 24 * 1_024 * 1_024;

export function frameImageMedia(frame: Record<string, unknown>): ReportEvidenceItem["media"] {
  const mime = text(frame.mime)?.toLocaleLowerCase();
  const base64 =
    typeof frame.base64 === "string" && frame.base64.length <= MAX_INLINE_EVIDENCE_BASE64_CHARS
      ? frame.base64.replace(/\s+/gu, "")
      : undefined;
  if (!mime || !["image/jpeg", "image/png", "image/webp"].includes(mime) || !base64)
    return undefined;
  if (!/^[a-zA-Z0-9+/]+={0,2}$/u.test(base64)) return undefined;
  const width = finite(frame.width);
  const height = finite(frame.height);
  return {
    kind: "image",
    src: `data:${mime};base64,${base64}`,
    ...(width && width > 0 ? { width } : {}),
    ...(height && height > 0 ? { height } : {}),
  };
}

export function reportVideoMedia(runId: string, rawRun: unknown): ReportVideoMedia | undefined {
  const artifacts = array(record(rawRun)?.artifacts);
  const file = artifacts.flatMap((value) => {
    const artifact = record(value);
    if (text(artifact?.kind) !== "video") return [];
    return array(record(artifact?.data)?.files).flatMap((item) => {
      const path = text(record(item)?.path);
      const bytes = finite(record(item)?.bytes);
      const match = /^video\/([^/]+)\.(mp4|webm)$/iu.exec(path ?? "");
      return match && bytes !== undefined && bytes > 0
        ? [{ file: match[1]!, ext: match[2]!.toLowerCase() as "mp4" | "webm" }]
        : [];
    });
  })[0];
  if (!file) return undefined;
  const startedAt = artifacts
    .map((value) =>
      text(record(value)?.kind) === "video-start" ? finite(record(value)?.capturedAt) : undefined,
    )
    .find((value): value is number => value !== undefined);
  const finishedAt = artifacts
    .map((value) =>
      text(record(value)?.kind) === "video" ? finite(record(value)?.capturedAt) : undefined,
    )
    .find((value): value is number => value !== undefined);
  return {
    kind: "video",
    src: `/runs/${encodeURIComponent(runId)}/video/${encodeURIComponent(`${file.file}.${file.ext}`)}`,
    mime: file.ext === "webm" ? "video/webm" : "video/mp4",
    clock: {
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(finishedAt === undefined ? {} : { finishedAt }),
    },
  };
}

export function mapDiagnosticEventsToVideo(
  events: readonly ReportDiagnosticEvent[],
  clock: ReportVideoMedia["clock"],
): readonly ReportDiagnosticEvent[] {
  const startedAt = clock.startedAt;
  if (startedAt === undefined) return events;
  return events.map((event) => ({
    ...event,
    ...(event.at === undefined ||
    event.at < startedAt ||
    (clock.finishedAt !== undefined && event.at > clock.finishedAt)
      ? {}
      : { videoTimeMs: event.at - startedAt }),
  }));
}

export function reportDiagnosticEvents(rawEvidence: unknown): ReportDiagnosticEvent[] {
  const evidence = record(rawEvidence);
  const sources = [
    ...array(evidence?.logs).map((value) => ({ value, prefix: "log" })),
    ...array(evidence?.network).map((value) => ({ value, prefix: "network" })),
    ...array(evidence?.crash).map((value) => ({ value, prefix: "crash" })),
  ];
  return sources
    .flatMap(({ value, prefix }, index) => {
      const item = record(value);
      const title = publicText(item?.message ?? item?.title ?? item?.detail);
      if (!title) return [];
      const at = finite(item?.at ?? item?.capturedAt ?? item?.timestamp);
      return [
        {
          id: `${prefix}-${text(item?.id) ?? index + 1}`,
          title,
          ...(at === undefined ? {} : { at }),
        },
      ];
    })
    .slice(0, 200);
}

/** Trace times are wall-clock timestamps; media seeks are offsets from capture start. */
export function traceVideoInterval(
  step: { startedAt?: number; finishedAt?: number },
  clock: ReportVideoMedia["clock"],
): { startMs: number; endMs?: number } | undefined {
  if (
    step.startedAt === undefined ||
    clock.startedAt === undefined ||
    step.startedAt < clock.startedAt ||
    (clock.finishedAt !== undefined && step.startedAt > clock.finishedAt)
  )
    return undefined;
  const end = step.finishedAt;
  return {
    startMs: step.startedAt - clock.startedAt,
    ...(end !== undefined &&
    end >= step.startedAt &&
    (clock.finishedAt === undefined || end <= clock.finishedAt)
      ? { endMs: end - clock.startedAt }
      : {}),
  };
}
