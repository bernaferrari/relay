import {
  ProtocolError,
  ProtocolErrorCode,
  type ReadResourceResult,
} from "@modelcontextprotocol/server";
import {
  captureReviewLeftoverLastFramePaths,
  destIdentityCheckpointFramePaths,
  isCaptureReviewLeftoverCaption,
} from "@relay/protocol";

export const relayMcpResourceByteLimit = 32_768;
export const relayMcpResourceMimeType = "application/json";

type ResourceEnvelope = {
  schemaVersion: 1;
  projectId: string;
  resource: string;
  truncated: boolean;
  data: unknown;
  byteLimit?: number;
  originalBytes?: number;
};

const localPath = /^(?:file:|\/(?:Users|private|var|tmp|home)\/|[A-Za-z]:[\\/])/i;
const sensitiveKey =
  /(?:^|_)(?:authorization|base64|cookie|credential|password|secret|token)(?:$|_)/i;
const pathKey = /(?:^|_)(?:file_?)?path$/i;

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "null" : serialized;
}

function serializedBytes(value: unknown): number | undefined {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
  } catch {
    return undefined;
  }
}

function boundedString(value: unknown, limit = 240): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function boundedRelativeName(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    return undefined;
  }
  return boundedString(value, 240);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayField(value: unknown, field: string): unknown[] {
  const items = object(value)[field];
  return Array.isArray(items) ? items : [];
}

function listedFrames(value: unknown): { path: string; caption?: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [{ path: item.trim() }];
    const record = object(item);
    const path = typeof record.path === "string" ? record.path.trim() : "";
    if (!path) return [];
    const caption = typeof record.caption === "string" ? record.caption : undefined;
    return [{ path, ...(caption ? { caption } : {}) }];
  });
}

function artifactRecords(value: unknown): { kind?: string; data?: unknown }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = object(item);
    return record.kind || record.data !== undefined ? [record] : [];
  });
}

function frozenRunContent(value: unknown): Record<string, unknown> | undefined {
  const frozen = arrayField(object(object(value).tracePack), "objects")
    .map(object)
    .find((item) => item.kind === "frozen-run");
  const content = object(frozen?.content);
  return Object.keys(content).length ? content : undefined;
}

function destIdentityRelativeNames(value: unknown): { relativeName: string; caption?: string }[] {
  const frozen = frozenRunContent(value);
  const envelope = object(value);
  const frames = listedFrames(frozen?.frames);
  const artifacts = artifactRecords(frozen?.artifacts);
  const destPaths = destIdentityCheckpointFramePaths(frames, artifacts);
  const listed = destPaths.length
    ? destPaths.map((path) => {
        const frame = frames.find((item) => item.path === path);
        return { path, ...(frame?.caption ? { caption: frame.caption } : {}) };
      })
    : listedFrames(frozen?.destIdentity ?? envelope.destIdentity).filter(
        (frame) => !isCaptureReviewLeftoverCaption(frame.caption),
      );
  const byPath = new Map(frames.map((frame) => [frame.path, frame]));
  const seen = new Set<string>();
  return listed.flatMap((frame) => {
    if (seen.has(frame.path)) return [];
    seen.add(frame.path);
    const relativeName = boundedRelativeName(frame.path);
    if (!relativeName) return [];
    const caption = frame.caption ?? byPath.get(frame.path)?.caption;
    if (isCaptureReviewLeftoverCaption(caption)) return [];
    return [{ relativeName, ...(caption ? { caption } : {}) }];
  });
}

function leftoverRelativeNames(value: unknown): Set<string> {
  const frozen = frozenRunContent(value);
  if (!frozen) return new Set();
  return new Set(
    captureReviewLeftoverLastFramePaths(
      listedFrames(frozen.frames),
      artifactRecords(frozen.artifacts),
    )
      .map((path) => boundedRelativeName(path))
      .filter((path): path is string => Boolean(path)),
  );
}

export function hoistTracePackDestIdentity(value: unknown): unknown {
  const destIdentity = destIdentityRelativeNames(value);
  return destIdentity.length ? { ...object(value), destIdentity } : value;
}
export function rewriteDestIdentityRelativeNames(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteDestIdentityRelativeNames);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key === "destIdentity" && Array.isArray(item)) {
      next[key] = item.map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
        const rec = entry as Record<string, unknown>;
        const path = typeof rec.path === "string" ? rec.path : undefined;
        const caption = typeof rec.caption === "string" ? rec.caption : undefined;
        const relativeName =
          typeof rec.relativeName === "string"
            ? rec.relativeName
            : path
              ? boundedRelativeName(path)
              : undefined;
        return {
          ...(relativeName ? { relativeName } : {}),
          ...(caption ? { caption } : {}),
        };
      });
      continue;
    }
    next[key] = rewriteDestIdentityRelativeNames(item);
  }
  return next;
}

/**
 * Stable, decision-useful metadata for a TracePack that is too large to put
 * in an MCP tool result or resource response. The scoped
 * `relay://runs/:runId/trace-pack` resource is the stable artifact handle: it
 * returns the complete sanitized pack when bounded, otherwise this manifest.
 * Keep this projection deliberately independent of TracePack content so it
 * cannot accidentally copy screenshots, trees, or credentials into a
 * bounded response.
 */
export function tracePackResourceManifest(value: unknown): Record<string, unknown> {
  const envelope = object(value);
  const pack = object(envelope.tracePack);
  const source = object(pack.source);
  const completeness = object(pack.completeness);
  const analysis = object(envelope.analysis);
  const objects = arrayField(pack, "objects").map(object);
  const missing = arrayField(completeness, "missing")
    .map((item) => boundedString(item, 160))
    .filter((item): item is string => item !== undefined)
    .slice(0, 100);
  const destIdentity = destIdentityRelativeNames(value);
  const leftover = leftoverRelativeNames(value);
  const destPaths = new Set(destIdentity.map((item) => item.relativeName));
  const visibleObjects =
    leftover.size && destIdentity.length
      ? objects.filter((item) => {
          const relativeName = boundedRelativeName(item.path);
          if (!relativeName || destPaths.has(relativeName)) return true;
          return !leftover.has(relativeName);
        })
      : objects;
  const objectManifest = visibleObjects.slice(0, 100).map((item) => {
    const relativeName = boundedRelativeName(item.path);
    const kind = boundedString(item.kind, 40);
    const mediaType = boundedString(item.mediaType, 120);
    const encoding = boundedString(item.encoding, 20);
    const digest = boundedString(item.digest, 80);
    return {
      ...(relativeName ? { relativeName } : {}),
      ...(kind ? { kind } : {}),
      ...(mediaType ? { mediaType } : {}),
      ...(encoding ? { encoding } : {}),
      ...(digest ? { digest } : {}),
      ...(typeof item.bytes === "number" ? { bytes: item.bytes } : {}),
    };
  });
  const objectBytes = objects.reduce(
    (total, item) => (typeof item.bytes === "number" ? total + item.bytes : total),
    0,
  );
  const proved = arrayField(analysis, "proved");
  const unknown = arrayField(analysis, "unknown");
  const packDigest = boundedString(pack.digest, 80);
  const createdAt = typeof pack.createdAt === "number" ? pack.createdAt : undefined;
  const packBytes = serializedBytes(pack);
  const sourceRunId = boundedString(source.runId, 160);
  const sourceStatus = boundedString(source.status, 80);
  const sourceAction = boundedString(source.action, 80);
  const completenessStatus = boundedString(completeness.status, 40);
  const historicalVerdict = boundedString(analysis.historicalVerdict, 40);
  const futureTransitionVerdict = boundedString(analysis.futureTransitionVerdict, 40);
  const analysisDigest = boundedString(analysis.tracePackDigest, 80);
  const analysisSourceRunId = boundedString(analysis.sourceRunId, 160);
  return {
    ...(packDigest ? { digest: packDigest } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(packBytes !== undefined ? { serializedBytes: packBytes } : {}),
    objectCount: objects.length,
    ...(destIdentity.length ? { destIdentity } : {}),
    ...(objects.length > objectManifest.length
      ? { remainingObjectCount: objects.length - objectManifest.length }
      : {}),
    objectBytes,
    objects: objectManifest,
    source: {
      ...(sourceRunId ? { runId: sourceRunId } : {}),
      ...(sourceStatus ? { status: sourceStatus } : {}),
      ...(sourceAction ? { action: sourceAction } : {}),
    },
    completeness: {
      ...(completenessStatus ? { status: completenessStatus } : {}),
      channelCount: Object.keys(object(completeness.channels)).length,
      missing,
    },
    analysis: {
      ...(historicalVerdict ? { historicalVerdict } : {}),
      ...(futureTransitionVerdict ? { futureTransitionVerdict } : {}),
      provedCount: proved.length,
      unknownCount: unknown.length,
      ...(analysisDigest ? { tracePackDigest: analysisDigest } : {}),
      ...(analysisSourceRunId ? { sourceRunId: analysisSourceRunId } : {}),
    },
  };
}

function sanitize(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (sensitiveKey.test(key) || pathKey.test(key) || key.toLowerCase().endsWith("path")) {
    return undefined;
  }
  if (typeof value === "string") {
    if (localPath.test(value) || value.startsWith("iVBORw0KGgo")) return "[redacted]";
    return value;
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => sanitize(item, "", seen));
    seen.delete(value);
    return result;
  }
  const result: Record<string, unknown> = {};
  for (const [childKey, item] of Object.entries(value as Record<string, unknown>)) {
    const sanitized = sanitize(item, childKey, seen);
    if (sanitized !== undefined) result[childKey] = sanitized;
  }
  seen.delete(value);
  return result;
}

function resourceText(
  projectId: string,
  resource: string,
  value: unknown,
  byteLimit = relayMcpResourceByteLimit,
  fallbackValue?: unknown,
): string {
  const envelope: ResourceEnvelope = {
    schemaVersion: 1,
    projectId,
    resource,
    truncated: false,
    data: sanitize(value),
  };
  const complete = stableJson(envelope);
  const originalBytes = Buffer.byteLength(complete, "utf8");
  if (originalBytes <= byteLimit) return complete;

  const truncated: ResourceEnvelope = {
    schemaVersion: 1,
    projectId,
    resource,
    truncated: true,
    data: fallbackValue === undefined ? null : sanitize(fallbackValue),
    byteLimit,
    originalBytes,
  };
  const bounded = stableJson(truncated);
  if (Buffer.byteLength(bounded, "utf8") <= byteLimit) return bounded;
  const metadataOnly = stableJson({ ...truncated, data: null });
  if (Buffer.byteLength(metadataOnly, "utf8") <= byteLimit) return metadataOnly;
  throw new ProtocolError(
    ProtocolErrorCode.InternalError,
    "Relay resource byte limit is too small",
  );
}

export function readResult(
  uri: URL,
  projectId: string,
  resource: string,
  value: unknown,
  fallbackValue?: unknown,
): ReadResourceResult {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: relayMcpResourceMimeType,
        text: resourceText(projectId, resource, value, relayMcpResourceByteLimit, fallbackValue),
      },
    ],
  };
}
