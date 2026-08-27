import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  parseTracePack,
  tracePackOfflineAnalysisSchema,
  type EvidenceChannelStatus,
  type TracePack,
  type TracePackObject,
  type TracePackOfflineAnalysis,
} from "@relay/protocol";
import { replayPersistedRunOffline } from "./offline-run-replay.js";
import type { PersistedRun } from "./runs.js";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function sha256(bytes: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function jsonObject(path: string, kind: "frozen-run", content: unknown): TracePackObject {
  const serialized = canonicalJson(content);
  return {
    path,
    kind,
    mediaType: "application/json",
    encoding: "json",
    digest: sha256(serialized),
    bytes: Buffer.byteLength(serialized),
    content: canonicalValue(content),
  };
}

type PortableFrame = { absolute: string; logicalPath: string };

function portableFrame(run: PersistedRun, path: string): PortableFrame | undefined {
  const absolute = resolve(run.dir, path);
  const child = relative(run.dir, absolute);
  if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child))
    return undefined;
  const logicalPath = child.split(sep).join("/");
  if (logicalPath.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    return undefined;
  }
  return { absolute, logicalPath };
}

async function frameObject(frame: PortableFrame): Promise<TracePackObject | undefined> {
  try {
    const bytes = await readFile(frame.absolute);
    return {
      path: `files/${frame.logicalPath}`,
      kind: "frame",
      mediaType: "image/png",
      encoding: "base64",
      digest: sha256(bytes),
      bytes: bytes.byteLength,
      content: bytes.toString("base64"),
    };
  } catch {
    return undefined;
  }
}

function allFramePaths(run: PersistedRun): string[] {
  return [
    ...new Set([
      ...run.frames.map((frame) => frame.path),
      ...run.steps.flatMap((step) => step.frames.map((frame) => frame.path)),
    ]),
  ].sort();
}

function frozenRun(run: PersistedRun): Omit<PersistedRun, "dir"> {
  const { dir: _localPath, ...portable } = structuredClone(run);
  return portable;
}

function channels(run: PersistedRun): Record<string, EvidenceChannelStatus | "missing"> {
  if (!run.evidence) return {};
  return Object.fromEntries(
    Object.entries(run.evidence.channels)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([channel, record]) => [channel, record.status]),
  );
}

function packDigest(pack: Omit<TracePack, "digest">): `sha256:${string}` {
  return sha256(canonicalJson(pack));
}

/**
 * Freeze one immutable persisted run into a self-contained JSON document.
 * Binary frames are embedded as content-addressed base64 objects; the local
 * run directory is deliberately omitted so the pack can move between hosts.
 */
export async function exportTracePack(run: PersistedRun): Promise<TracePack> {
  if (!/^[a-f0-9]{64}$/u.test(run.inputDigest)) {
    throw new Error(`run ${run.id} has no valid frozen input digest`);
  }
  const requestedFrames = allFramePaths(run);
  const invalidFrames: string[] = [];
  const portableFrames = new Map<string, PortableFrame>();
  for (const path of requestedFrames) {
    const frame = portableFrame(run, path);
    if (!frame) {
      invalidFrames.push(path);
      continue;
    }
    portableFrames.set(frame.logicalPath, frame);
  }
  const frames = await Promise.all([...portableFrames.values()].map(frameObject));
  const objects = [jsonObject("run.json", "frozen-run", frozenRun(run)), ...frames.filter(Boolean)]
    .filter((object): object is TracePackObject => object !== undefined)
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const capturedFrames = new Set(
    objects.filter((object) => object.kind === "frame").map((object) => object.path.slice(6)),
  );
  const missing = [
    ...(!run.evidence ? ["evidence-manifest"] : []),
    ...invalidFrames.map((path) => `frame:${path}:invalid-path`),
    ...[...portableFrames.keys()]
      .filter((path) => !capturedFrames.has(path))
      .map((path) => `frame:${path}:missing`),
    ...Object.entries(run.evidence?.channels ?? {})
      .filter(([, record]) => record.status !== "captured")
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([channel, record]) => `channel:${channel}:${record.status}`),
  ];
  const redactedChannels = Object.entries(run.evidence?.channels ?? {})
    .filter(([, record]) => record.status === "redacted")
    .map(([channel]) => channel)
    .sort();
  const body = {
    schemaVersion: 1 as const,
    kind: "relay-trace-pack" as const,
    createdAt: run.writtenAt,
    source: {
      runId: run.id,
      runSchemaVersion: run.schemaVersion,
      status: run.status,
      action: run.action,
      inputDigest: run.inputDigest,
      writtenAt: run.writtenAt,
    },
    redaction: {
      status: run.schemaVersion >= 5 ? ("applied-at-persistence" as const) : ("unknown" as const),
      redactedChannels,
    },
    completeness: {
      status: missing.length ? ("partial" as const) : ("complete" as const),
      channels: channels(run),
      missing,
    },
    objects,
  };
  return parseTracePack({ ...body, digest: packDigest(body) });
}

function objectBytes(object: TracePackObject): Buffer {
  if (object.encoding === "base64") return Buffer.from(object.content as string, "base64");
  return Buffer.from(canonicalJson(object.content));
}

/** Validate both the schema and every content address before evidence is used. */
export function verifyTracePack(value: unknown): TracePack {
  const pack = parseTracePack(value);
  const paths = new Set<string>();
  for (const object of pack.objects) {
    if (paths.has(object.path))
      throw new Error(`TracePack object path is duplicated: ${object.path}`);
    paths.add(object.path);
    const bytes = objectBytes(object);
    if (bytes.byteLength !== object.bytes || sha256(bytes) !== object.digest) {
      throw new Error(`TracePack object integrity failed: ${object.path}`);
    }
  }
  const { digest: _digest, ...body } = pack;
  if (packDigest(body) !== pack.digest) throw new Error("TracePack manifest integrity failed");
  return pack;
}

function runFromPack(pack: TracePack): PersistedRun {
  const manifests = pack.objects.filter((object) => object.kind === "frozen-run");
  if (manifests.length !== 1) throw new Error("TracePack must contain exactly one frozen run");
  const value = manifests[0]!.content;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("TracePack frozen run is not an object");
  }
  const run = value as Omit<PersistedRun, "dir">;
  if (run.id !== pack.source.runId || run.inputDigest !== pack.source.inputDigest) {
    throw new Error("TracePack source identity does not match its frozen run");
  }
  return { ...structuredClone(run), dir: "" };
}

/**
 * Analyze only the pack's frozen evidence. The return type structurally fixes
 * futureTransitionVerdict to `unknown`, so an offline caller cannot turn a
 * historical proof or a newly-resolving selector into a future-device pass.
 */
export function analyzeTracePack(value: unknown): TracePackOfflineAnalysis {
  const pack = verifyTracePack(value);
  const run = runFromPack(pack);
  const replay = replayPersistedRunOffline(run);
  const runObject = pack.objects.find((object) => object.kind === "frozen-run")!;
  const proved: TracePackOfflineAnalysis["proved"] = [
    {
      code: "TRACE_PACK_INTEGRITY",
      statement: "Every exported object matches its recorded SHA-256 content address.",
      evidence: pack.objects.map((object) => object.digest),
    },
    ...replay.checks
      .filter((check) => check.replayStatus === "proved")
      .map((check) => ({
        code: "RECORDED_TRANSITION_PROOF",
        statement: `${check.title} was backed by a verified transition proof when this run was captured.`,
        evidence: [runObject.digest],
      })),
  ];
  const unknown: TracePackOfflineAnalysis["unknown"] = [
    {
      code: "FUTURE_TARGET_STATE",
      statement:
        "Frozen evidence cannot prove that the same transition will succeed on a future target state or build.",
      resolution: "Replay the frozen Test or focused failed check on a controlled live target.",
    },
    ...pack.completeness.missing.map((missing) => ({
      code: "MISSING_EVIDENCE",
      statement: `${missing} is absent from this TracePack.`,
      resolution: "Recapture the frozen plan with that evidence channel enabled and permitted.",
    })),
    ...replay.blockers.map((blocker) => ({
      code: blocker.kind.toUpperCase().replaceAll("-", "_"),
      statement: blocker.message,
      resolution:
        blocker.kind === "missing-frozen-plan"
          ? "Recapture a run with its frozen plan."
          : "Replay the first causal failure before trusting dependent checks.",
    })),
  ];
  const firstRoot = replay.firstRootFailure;
  const missingPlan = replay.blockers.some((blocker) => blocker.kind === "missing-frozen-plan");
  const historicalVerdict: TracePackOfflineAnalysis["historicalVerdict"] = firstRoot
    ? "failed"
    : replay.summary.checks > 0 && replay.summary.proved === replay.summary.checks
      ? "proved"
      : "insufficient-evidence";
  return tracePackOfflineAnalysisSchema.parse({
    schemaVersion: 1,
    mode: "trace-pack-offline-analysis",
    tracePackDigest: pack.digest,
    sourceRunId: run.id,
    historicalVerdict,
    futureTransitionVerdict: "unknown",
    proved,
    unknown,
    smallestLiveVerification: missingPlan
      ? {
          kind: "recapture-frozen-plan",
          reason: "Offline analysis has no frozen execution plan to evaluate.",
          requiresTarget: true,
        }
      : firstRoot
        ? {
            kind: "replay-check",
            checkId: firstRoot.checkId,
            reason: `${firstRoot.title} is the first causal failure; replay only this check first.`,
            requiresTarget: true,
          }
        : {
            kind: "replay-frozen-test",
            reason:
              "Historical evidence is exhausted; a live replay is the smallest way to learn whether current behavior still agrees.",
            requiresTarget: true,
          },
  });
}
