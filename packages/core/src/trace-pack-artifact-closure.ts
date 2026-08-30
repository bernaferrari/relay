import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  EvidenceChannelStatus,
  TracePackArtifactReference,
  TracePackObject,
} from "@relay/protocol";
import { readAuthoringEvidence } from "./authoring-evidence.js";
import type { PersistedRun } from "./runs.js";

export type TracePackExportLimits = {
  maxArtifacts?: number;
  maxArtifactBytes?: number;
  maxTotalArtifactBytes?: number;
};

const DEFAULT_LIMITS = {
  maxArtifacts: 10_000,
  maxArtifactBytes: 512 * 1024 * 1024,
  maxTotalArtifactBytes: 1024 * 1024 * 1024,
} as const;

type RequiredLimits = Required<TracePackExportLimits>;
type RequestedArtifact = {
  path: string;
  logicalPath?: string;
  external: boolean;
  sources: Set<string>;
  channels: Set<string>;
  expectedBytes: Set<number>;
  mediaTypes: Set<string>;
  frame: boolean;
};

type ArtifactClosure = {
  reference: TracePackArtifactReference;
  object?: TracePackObject;
};

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function limitsOf(input: TracePackExportLimits): RequiredLimits {
  const result = { ...DEFAULT_LIMITS, ...input };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`TracePack ${name} must be a positive safe integer`);
    }
  }
  return result;
}

/** Reject declared or encoded artifact sizes before verification decodes any
 * base64 payload. The frozen run is bounded by the enclosing transport; these
 * limits specifically cover the binary closure. */
export function assertTracePackArtifactBounds(
  objects: readonly TracePackObject[],
  requestedLimits: TracePackExportLimits = {},
): void {
  const limits = limitsOf(requestedLimits);
  const artifacts = objects.filter((object) => object.kind !== "frozen-run");
  if (artifacts.length > limits.maxArtifacts) {
    throw new Error(`TracePack artifact object limit exceeded (${limits.maxArtifacts})`);
  }
  let total = 0;
  for (const object of artifacts) {
    if (object.bytes > limits.maxArtifactBytes) {
      throw new Error(`TracePack artifact object exceeds byte limit: ${object.path}`);
    }
    if (
      object.encoding === "base64" &&
      typeof object.content === "string" &&
      object.content.length > Math.ceil(limits.maxArtifactBytes / 3) * 4 + 4
    ) {
      throw new Error(`TracePack artifact encoding exceeds byte limit: ${object.path}`);
    }
    total += object.bytes;
    if (total > limits.maxTotalArtifactBytes) {
      throw new Error(
        `TracePack aggregate artifact byte limit exceeded (${limits.maxTotalArtifactBytes})`,
      );
    }
  }
}

function portablePath(run: PersistedRun, path: string): string | undefined {
  const absolute = resolve(run.dir, path);
  const child = relative(run.dir, absolute);
  if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    return undefined;
  }
  const logicalPath = child.split(sep).join("/");
  if (logicalPath.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    return undefined;
  }
  return logicalPath;
}

function mediaTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".json":
      return "application/json";
    case ".jsonl":
      return "application/x-ndjson";
    case ".xml":
      return "application/xml";
    case ".log":
    case ".txt":
    case ".ips":
    case ".crash":
    case ".diag":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function artifactChannel(kind: string): string | undefined {
  for (const channel of [
    "video",
    "logs",
    "network",
    "performance",
    "crash",
    "audio",
    "ui-tree",
    "screenshot",
  ]) {
    if (kind === channel || kind.startsWith(`${channel}-`)) return channel;
  }
  return undefined;
}

function looksLikeRunArtifact(path: string, channel?: string): boolean {
  if (!path.includes("/")) return false;
  if (channel && ["video", "screenshot", "audio", "crash"].includes(channel)) return true;
  return /\.(?:png|jpe?g|webp|mp4|webm|wav|m4a|aac|jsonl?|xml|log|txt|ips|crash|diag|har|trace)$/iu.test(
    path,
  );
}

function collectNestedPaths(
  value: unknown,
  source: string,
  channel: string | undefined,
  emit: (path: string, source: string, channel?: string, expectedBytes?: number) => void,
  depth = 0,
): void {
  if (depth > 64 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectNestedPaths(item, `${source}[${index}]`, channel, emit, depth + 1),
    );
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.path === "string" && looksLikeRunArtifact(record.path, channel)) {
    emit(
      record.path,
      `${source}.path`,
      channel,
      typeof record.bytes === "number" && Number.isSafeInteger(record.bytes) && record.bytes >= 0
        ? record.bytes
        : undefined,
    );
  }
  for (const [key, child] of Object.entries(record)) {
    if (key !== "path") collectNestedPaths(child, `${source}.${key}`, channel, emit, depth + 1);
  }
}

function collectEvidenceUris(
  value: unknown,
  source: string,
  emit: (uri: string, source: string, expectedBytes?: number, mediaType?: string) => void,
  depth = 0,
): void {
  if (depth > 64) return;
  if (typeof value === "string") {
    if (value.startsWith("relay-evidence://")) emit(value, source);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectEvidenceUris(item, `${source}[${index}]`, emit, depth + 1),
    );
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.uri === "string" && record.uri.startsWith("relay-evidence://")) {
    emit(
      record.uri,
      `${source}.uri`,
      typeof record.bytes === "number" && Number.isSafeInteger(record.bytes) && record.bytes >= 0
        ? record.bytes
        : undefined,
      typeof record.mime === "string" && record.mime.trim() ? record.mime : undefined,
    );
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "uri" && typeof child === "string" && child.startsWith("relay-evidence://")) {
      continue;
    }
    collectEvidenceUris(child, `${source}.${key}`, emit, depth + 1);
  }
}

function requestedArtifacts(run: PersistedRun, maxArtifacts: number): RequestedArtifact[] {
  const byPath = new Map<string, RequestedArtifact>();
  const emit = (
    path: string,
    source: string,
    channel?: string,
    expectedBytes?: number,
    frame = false,
    external = false,
    mediaType?: string,
  ): void => {
    const logicalPath = external ? undefined : portablePath(run, path);
    const key = external
      ? `external:${path}`
      : logicalPath
        ? `valid:${logicalPath}`
        : `invalid:${path}`;
    let request = byPath.get(key);
    if (!request) {
      if (byPath.size >= maxArtifacts) {
        throw new Error(`TracePack artifact reference limit exceeded (${maxArtifacts})`);
      }
      request = {
        path: logicalPath ?? path,
        logicalPath,
        external,
        sources: new Set(),
        channels: new Set(),
        expectedBytes: new Set(),
        mediaTypes: new Set(),
        frame,
      };
      byPath.set(key, request);
    }
    if (!request.sources.has(source) && request.sources.size >= 64) {
      throw new Error(`TracePack artifact source limit exceeded for ${request.path}`);
    }
    request.sources.add(source);
    if (channel) request.channels.add(channel);
    if (expectedBytes !== undefined) request.expectedBytes.add(expectedBytes);
    if (mediaType) request.mediaTypes.add(mediaType);
    request.frame ||= frame;
    request.external ||= external;
  };
  run.frames.forEach((frame, index) =>
    emit(frame.path, `run.frames[${index}].path`, "screenshot", frame.bytes, true),
  );
  run.steps.forEach((step, stepIndex) =>
    step.frames.forEach((frame, frameIndex) =>
      emit(
        frame.path,
        `run.steps[${stepIndex}].frames[${frameIndex}].path`,
        "screenshot",
        frame.bytes,
        true,
      ),
    ),
  );
  run.artifacts.forEach((artifact, index) =>
    collectNestedPaths(
      artifact.data,
      `run.artifacts[${index}].data`,
      artifactChannel(artifact.kind),
      emit,
    ),
  );
  // Browser proof envelopes name the portable files backing each required
  // channel. Treat those names as ordinary run artifacts so a captured
  // channel cannot claim a path that the TracePack does not contain.
  run.artifacts.forEach((artifact, index) => {
    if (artifact.kind !== "browser-proof-evidence") return;
    const data = artifact.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    const channels = (data as { channels?: unknown }).channels;
    if (!channels || typeof channels !== "object" || Array.isArray(channels)) return;
    for (const [channel, record] of Object.entries(channels as Record<string, unknown>)) {
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      const refs = (record as { artifactRefs?: unknown }).artifactRefs;
      if (!Array.isArray(refs)) continue;
      for (const [refIndex, ref] of refs.entries()) {
        if (typeof ref === "string") {
          emit(
            ref,
            `run.artifacts[${index}].data.channels.${channel}.artifactRefs[${refIndex}]`,
            channel,
          );
        }
      }
    }
  });
  collectNestedPaths(run.result, "run.result", undefined, emit);
  run.evidence?.events.forEach((event, index) => {
    collectNestedPaths(event.data, `run.evidence.events[${index}].data`, event.channel, emit);
    if (typeof event.artifact === "string" && looksLikeRunArtifact(event.artifact, event.channel)) {
      emit(event.artifact, `run.evidence.events[${index}].artifact`, event.channel);
    }
  });
  const { dir: _localPath, ...portableRun } = structuredClone(run);
  collectEvidenceUris(portableRun, "run", (uri, source, expectedBytes, mediaType) =>
    emit(uri, source, undefined, expectedBytes, false, true, mediaType),
  );
  return [...byPath.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

function missingClosure(
  request: RequestedArtifact,
  reason: Exclude<
    TracePackArtifactReference["reason"],
    "redacted-channel" | "external-reference-unresolved" | undefined
  >,
): ArtifactClosure {
  return {
    reference: {
      path: request.path,
      status: "missing",
      sources: [...request.sources].sort(),
      channels: [...request.channels].sort(),
      ...(request.expectedBytes.size === 1 ? { expectedBytes: [...request.expectedBytes][0] } : {}),
      reason,
    },
  };
}

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

async function closeArtifact(
  run: PersistedRun,
  root: string,
  request: RequestedArtifact,
  limits: RequiredLimits,
  embeddedBytes: number,
): Promise<ArtifactClosure> {
  const sources = [...request.sources].sort();
  const channels = [...request.channels].sort();
  const expectedBytes =
    request.expectedBytes.size === 1 ? [...request.expectedBytes][0] : undefined;
  const channelRecords = run.evidence?.channels as
    | Record<string, { status: EvidenceChannelStatus }>
    | undefined;
  if (channels.some((channel) => channelRecords?.[channel]?.status === "redacted")) {
    return {
      reference: {
        path: request.path,
        status: "redacted",
        sources,
        channels,
        ...(expectedBytes === undefined ? {} : { expectedBytes }),
        reason: "redacted-channel",
      },
    };
  }
  if (request.external) {
    const digest = request.path.match(/^relay-evidence:\/\/([a-f0-9]{64})$/u)?.[1];
    const bytes = digest ? await readAuthoringEvidence(digest) : null;
    if (bytes) {
      const actualDigest = sha256(bytes);
      if (actualDigest !== `sha256:${digest}`) {
        return missingClosure(request, "digest-mismatch");
      }
      if (
        request.expectedBytes.size > 1 ||
        (expectedBytes !== undefined && expectedBytes !== bytes.byteLength)
      ) {
        return missingClosure(request, "byte-count-mismatch");
      }
      if (bytes.byteLength > limits.maxArtifactBytes) {
        return missingClosure(request, "object-too-large");
      }
      if (embeddedBytes + bytes.byteLength > limits.maxTotalArtifactBytes) {
        return missingClosure(request, "pack-too-large");
      }
      const mediaType =
        request.mediaTypes.size === 1 ? [...request.mediaTypes][0]! : "application/octet-stream";
      const logicalPath = `evidence/${digest}`;
      const object: TracePackObject = {
        path: `files/${logicalPath}`,
        kind: "artifact",
        mediaType,
        encoding: "base64",
        digest: actualDigest,
        bytes: bytes.byteLength,
        content: bytes.toString("base64"),
      };
      return {
        object,
        reference: {
          path: logicalPath,
          status: "embedded",
          sources,
          channels,
          ...(expectedBytes === undefined ? {} : { expectedBytes }),
          objectPath: object.path,
          digest: object.digest,
          bytes: object.bytes,
          mediaType: object.mediaType,
        },
      };
    }
    return {
      reference: {
        path: request.path,
        status: "missing",
        sources,
        channels,
        reason: "external-reference-unresolved",
      },
    };
  }
  if (!request.logicalPath) return missingClosure(request, "invalid-path");
  const absolute = resolve(run.dir, request.logicalPath);
  try {
    const before = await lstat(absolute);
    if (!before.isFile()) return missingClosure(request, "not-a-file");
    const canonical = await realpath(absolute);
    if (!isWithin(root, canonical)) return missingClosure(request, "outside-run-directory");
    if (
      request.expectedBytes.size > 1 ||
      (expectedBytes !== undefined && expectedBytes !== before.size)
    ) {
      return missingClosure(request, "byte-count-mismatch");
    }
    if (before.size > limits.maxArtifactBytes) {
      return missingClosure(request, "object-too-large");
    }
    if (embeddedBytes + before.size > limits.maxTotalArtifactBytes) {
      return missingClosure(request, "pack-too-large");
    }
    const bytes = await readFile(canonical);
    const after = await lstat(absolute);
    if (
      !after.isFile() ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== before.size
    ) {
      return missingClosure(request, "changed-during-export");
    }
    const mediaType = mediaTypeFor(request.logicalPath);
    const object: TracePackObject = {
      path: `files/${request.logicalPath}`,
      kind: request.frame ? "frame" : "artifact",
      mediaType,
      encoding: "base64",
      digest: sha256(bytes),
      bytes: bytes.byteLength,
      content: bytes.toString("base64"),
    };
    return {
      object,
      reference: {
        path: request.logicalPath,
        status: "embedded",
        sources,
        channels,
        ...(expectedBytes === undefined ? {} : { expectedBytes }),
        objectPath: object.path,
        digest: object.digest,
        bytes: object.bytes,
        mediaType: object.mediaType,
      },
    };
  } catch {
    return missingClosure(request, "not-found");
  }
}

async function closeArtifacts(
  run: PersistedRun,
  requested: RequestedArtifact[],
  limits: RequiredLimits,
): Promise<ArtifactClosure[]> {
  if (requested.length === 0) return [];
  let root: string | undefined;
  try {
    root = await realpath(run.dir);
  } catch {
    root = undefined;
  }
  const closures: ArtifactClosure[] = [];
  let embeddedBytes = 0;
  // Deliberately sequential: the aggregate byte bound must be deterministic,
  // and parallel reads could allocate beyond it before the limit is observed.
  for (const request of requested) {
    const closure = request.external
      ? await closeArtifact(run, "", request, limits, embeddedBytes)
      : root
        ? await closeArtifact(run, root, request, limits, embeddedBytes)
        : missingClosure(request, "not-found");
    closures.push(closure);
    embeddedBytes += closure.object?.bytes ?? 0;
  }
  return closures;
}

export async function closeTracePackArtifacts(
  run: PersistedRun,
  requestedLimits: TracePackExportLimits = {},
): Promise<{
  objects: TracePackObject[];
  references: TracePackArtifactReference[];
}> {
  const limits = limitsOf(requestedLimits);
  const closures = await closeArtifacts(run, requestedArtifacts(run, limits.maxArtifacts), limits);
  const result = {
    objects: closures.flatMap((closure) => (closure.object ? [closure.object] : [])),
    references: closures.map((closure) => closure.reference),
  };
  assertTracePackArtifactBounds(result.objects, limits);
  return result;
}
