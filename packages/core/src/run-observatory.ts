import type {
  EvidenceChannel,
  EvidenceChannelRecord,
  RunEvidenceArtifactSummary,
  RunEvidenceLogEntry,
  RunEvidenceNetworkEntry,
  RunEvidencePerformanceSample,
  RunEvidenceQuery,
} from "@relay/protocol";
import type { PersistedRun } from "./runs.js";

type UnknownRecord = Record<string, unknown>;

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2_000;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function timestamp(value: UnknownRecord): number | undefined {
  for (const key of ["at", "timestamp", "time", "capturedAt", "startedAt"]) {
    const numberValue = finiteNumber(value[key]);
    if (numberValue !== undefined) return numberValue;
    const stringValue = text(value[key]);
    if (stringValue) {
      const parsed = Date.parse(stringValue);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function arrayFrom(value: unknown, keys: string[]): unknown[] {
  const input = record(value);
  for (const key of keys) {
    if (Array.isArray(input[key])) return input[key] as unknown[];
  }
  return Array.isArray(value) ? value : [];
}

function level(value: unknown): RunEvidenceLogEntry["level"] {
  const normalized = text(value)?.toLowerCase();
  if (!normalized) return "unknown";
  if (normalized === "warning") return "warn";
  if (["trace", "debug", "info", "warn", "error"].includes(normalized)) {
    return normalized as RunEvidenceLogEntry["level"];
  }
  return "unknown";
}

function logEntries(value: unknown, limit: number): RunEvidenceLogEntry[] {
  return arrayFrom(value, ["entries", "logs", "lines", "items"])
    .map((entry, index) => {
      if (typeof entry === "string") {
        return { id: `log-${index + 1}`, level: "unknown" as const, message: entry };
      }
      const input = record(entry);
      const message =
        text(input.message) ??
        text(input.text) ??
        text(input.line) ??
        text(input.log) ??
        JSON.stringify(entry);
      return {
        id: text(input.id) ?? `log-${index + 1}`,
        ...(timestamp(input) === undefined ? {} : { at: timestamp(input) }),
        level: level(input.level ?? input.severity ?? input.type),
        ...(text(input.source ?? input.tag ?? input.process)
          ? { source: text(input.source ?? input.tag ?? input.process) }
          : {}),
        message,
      } satisfies RunEvidenceLogEntry;
    })
    .slice(-limit);
}

function headers(value: unknown): Record<string, string> | undefined {
  const input = record(value);
  const entries = Object.entries(input).filter(([, item]) => typeof item === "string") as [
    string,
    string,
  ][];
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function networkEntries(
  value: unknown,
  limit: number,
  includeBodies: boolean,
): RunEvidenceNetworkEntry[] {
  return arrayFrom(value, ["entries", "requests", "network", "items"])
    .map((entry, index) => {
      const input = record(entry);
      const status = finiteNumber(input.status ?? input.statusCode);
      const error = text(input.error ?? input.failure ?? input.message);
      const durationMs = finiteNumber(input.durationMs ?? input.duration ?? input.elapsedMs);
      const url = text(input.url ?? input.requestUrl ?? input.href);
      const method = text(input.method ?? input.httpMethod);
      const result =
        error || (status !== undefined && status >= 400)
          ? "failure"
          : status === undefined
            ? "pending"
            : "success";
      return {
        id: text(input.id ?? input.requestId) ?? `request-${index + 1}`,
        ...(timestamp(input) === undefined ? {} : { at: timestamp(input) }),
        ...(method ? { method: method.toUpperCase() } : {}),
        ...(url ? { url } : {}),
        ...(status === undefined ? {} : { status }),
        ...(durationMs === undefined ? {} : { durationMs }),
        result,
        ...(text(input.source ?? input.transport)
          ? { source: text(input.source ?? input.transport) }
          : {}),
        ...(includeBodies && headers(input.requestHeaders ?? input.headers)
          ? { requestHeaders: headers(input.requestHeaders ?? input.headers) }
          : {}),
        ...(includeBodies && text(input.requestBody ?? input.body)
          ? { requestBody: text(input.requestBody ?? input.body) }
          : {}),
        ...(includeBodies && headers(input.responseHeaders)
          ? { responseHeaders: headers(input.responseHeaders) }
          : {}),
        ...(includeBodies && text(input.responseBody ?? input.response)
          ? { responseBody: text(input.responseBody ?? input.response) }
          : {}),
        ...(input.responseBodyTruncated === true ? { responseBodyTruncated: true } : {}),
      } satisfies RunEvidenceNetworkEntry;
    })
    .slice(-limit);
}

function metricValue(value: unknown): number | string | boolean | null | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  return finiteNumber(value);
}

function performanceSamples(
  artifacts: Array<{ kind: string; capturedAt: number; data: unknown }>,
  limit: number,
): RunEvidencePerformanceSample[] {
  return artifacts
    .filter(
      (artifact) => artifact.kind === "performance-start" || artifact.kind === "performance-end",
    )
    .map((artifact, index) => {
      const input = record(artifact.data);
      const source = record(input.result ?? input.metrics ?? input);
      const metrics: Record<string, number | string | boolean | null> = {};
      for (const [key, value] of Object.entries(source)) {
        const normalized = metricValue(value);
        if (normalized !== undefined) metrics[key] = normalized;
      }
      return {
        id: `performance-${index + 1}`,
        at: artifact.capturedAt,
        phase: artifact.kind === "performance-start" ? "start" : "end",
        metrics,
      } satisfies RunEvidencePerformanceSample;
    })
    .slice(-limit);
}

function artifactEntries(value: unknown): number | undefined {
  const input = record(value);
  const entries = finiteNumber(input.entries);
  return entries ?? (Array.isArray(input.entries) ? input.entries.length : undefined);
}

function artifactBytes(value: unknown): number | undefined {
  const input = record(value);
  const direct = finiteNumber(input.bytes);
  if (direct !== undefined) return direct;
  const files = Array.isArray(input.files) ? input.files : [];
  const total = files.reduce((sum, file) => sum + (finiteNumber(record(file).bytes) ?? 0), 0);
  return total > 0 ? total : undefined;
}

function artifactSummary(artifact: {
  kind: string;
  capturedAt: number;
  data: unknown;
}): RunEvidenceArtifactSummary {
  const data = record(artifact.data);
  const summary =
    text(data.message) ??
    text(data.warning) ??
    text(data.include) ??
    (artifact.kind === "network" && Array.isArray(data.entries)
      ? `${data.entries.length} request${data.entries.length === 1 ? "" : "s"}`
      : undefined);
  return {
    kind: artifact.kind,
    capturedAt: artifact.capturedAt,
    ...(artifactEntries(artifact.data) === undefined
      ? {}
      : { entries: artifactEntries(artifact.data) }),
    ...(artifactBytes(artifact.data) === undefined ? {} : { bytes: artifactBytes(artifact.data) }),
    ...(summary ? { summary } : {}),
  };
}

function channelMap(run: PersistedRun): Partial<Record<EvidenceChannel, EvidenceChannelRecord>> {
  return run.evidence?.channels ?? {};
}

/** Build a bounded, provider-neutral observability view from a persisted run. */
export function buildRunEvidence(
  run: PersistedRun,
  options: { limit?: number; includeBodies?: boolean } = {},
): RunEvidenceQuery {
  const requested = options.limit ?? DEFAULT_LIMIT;
  const applied = Math.max(1, Math.min(MAX_LIMIT, Math.floor(requested)));
  const consented = Boolean(run.evidence?.collectionPolicy?.sensitive?.["network-body"]);
  const bodiesIncluded = Boolean(options.includeBodies && consented);
  const logsArtifacts = run.artifacts.filter((artifact) => artifact.kind === "logs");
  const networkArtifacts = run.artifacts.filter((artifact) => artifact.kind === "network");
  const logs = logsArtifacts
    .flatMap((artifact) => logEntries(artifact.data, applied))
    .slice(-applied);
  const network = networkArtifacts
    .flatMap((artifact) => networkEntries(artifact.data, applied, bodiesIncluded))
    .slice(-applied);
  const performance = performanceSamples(run.artifacts, applied);
  const crashArtifacts = run.artifacts.filter((artifact) => artifact.kind === "crash");
  const notes = [
    ...(run.evidence?.channels.network?.message ? [run.evidence.channels.network.message] : []),
    ...(run.evidence?.channels.logs?.message ? [run.evidence.channels.logs.message] : []),
    ...(options.includeBodies && !consented
      ? ["Network bodies are omitted because this run has no network-body consent grant."]
      : []),
  ];
  const networkCapture =
    run.platform === "browser"
      ? {
          mode: "browser-events" as const,
          label: "Browser request events",
          detail: "Requests and responses were collected from the browser runtime.",
        }
      : networkArtifacts.length > 0
        ? {
            mode: "session-log" as const,
            label: "Session network log",
            detail:
              "Mobile traffic was parsed from the target session log. This is not transparent packet interception.",
          }
        : {
            mode: "unavailable" as const,
            label: "No network collector result",
            detail: "The target did not produce a network collector artifact for this run.",
          };
  return {
    schemaVersion: 1,
    runId: run.id,
    generatedAt: Date.now(),
    target: {
      ...(run.platform ? { platform: run.platform } : {}),
      ...(run.serial ? { serial: run.serial } : {}),
      ...(run.deviceName ? { name: run.deviceName } : {}),
      ...(run.targetProfile?.id ? { profileId: run.targetProfile.id } : {}),
    },
    channels: channelMap(run),
    logs,
    network,
    networkCapture,
    performance,
    crashes: crashArtifacts.map((artifact) => artifact.data).slice(-applied),
    artifacts: run.artifacts.map(artifactSummary),
    limits: { requested, applied, bodiesIncluded },
    notes: [...new Set(notes)],
  };
}
