import { createHash } from "node:crypto";
import { basename } from "node:path";
import {
  tracePackVisualLocalizationSchema,
  type TracePack,
  type TracePackObject,
  type TracePackVisualLocalization,
} from "@relay/protocol";
import { analyzeCombineEvidenceBatchData } from "./combine-evidence-batch-analysis.js";
import { frameObservations, type FrameObservation } from "./frame-observation.js";
import { pngDimensions } from "./ios-geometry.js";
import type { PersistedRun } from "./runs.js";
import { verifyTracePack } from "./trace-pack.js";

type Fact = TracePackVisualLocalization["historicalBaseline"]["fact"];
type FrameDelta = TracePackVisualLocalization["historicalBaseline"]["frames"][number];
type FrameObservationProjection = FrameDelta["observations"][number];

type PackProjection = {
  pack: TracePack;
  run: PersistedRun;
  runObjectDigest: string;
  locale?: string;
  testKey?: `sha256:${string}`;
  targetKey?: `sha256:${string}`;
  sourceKey?: `sha256:${string}`;
  frames: FrameProjection[];
};

type FrameProjection = {
  index: number;
  caption?: string;
  status: "embedded" | "missing" | "redacted";
  object?: TracePackObject;
  dimensions?: { width: number; height: number };
  semantic?: FrameObservation;
};

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

function identityDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex")}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function fact(
  classification: Fact["classification"],
  statement: string,
  evidence: readonly string[],
): Fact {
  return { classification, statement, evidence: [...new Set(evidence)].sort() };
}

function runFromPack(pack: TracePack): { run: PersistedRun; digest: string } {
  const objects = pack.objects.filter((object) => object.kind === "frozen-run");
  if (objects.length !== 1) throw new Error("TracePack must contain exactly one frozen run");
  const object = objects[0]!;
  const raw = record(object.content);
  if (!raw || raw.id !== pack.source.runId || raw.inputDigest !== pack.source.inputDigest) {
    throw new Error("TracePack source identity does not match its frozen run");
  }
  return { run: { ...structuredClone(raw), dir: "" } as PersistedRun, digest: object.digest };
}

const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/u;

function localeFromRun(run: PersistedRun): string | undefined {
  const candidate = text(run.resolvedInputs.locale ?? run.resolvedInputs.language);
  if (candidate && LOCALE_PATTERN.test(candidate)) return candidate;
  for (const artifact of run.artifacts) {
    if (artifact.kind !== "frozen-inputs") continue;
    const data = record(artifact.data);
    const values = record(data?.values);
    const value = text(data?.locale ?? values?.locale ?? values?.language);
    if (value && LOCALE_PATTERN.test(value)) return value;
  }
  return undefined;
}

function testKeyFromRun(run: PersistedRun): `sha256:${string}` | undefined {
  const artifact = run.artifacts.find(
    (item) => item.kind === "app-map-test-plan" || item.kind === "app-map-flow-plan",
  );
  const plan = record(artifact?.data);
  const test = record(plan?.test);
  const appMapId = text(plan?.appMapId);
  const testId = text(test?.id);
  return appMapId && testId ? identityDigest([appMapId, testId]) : undefined;
}

function targetKeyFromRun(run: PersistedRun): `sha256:${string}` | undefined {
  if (run.executionTarget) {
    return identityDigest([
      run.executionTarget.provider.key,
      run.executionTarget.kind,
      run.executionTarget.platform,
      run.executionTarget.identity.kind,
      run.executionTarget.identity.value,
      run.targetProfile?.id ?? null,
    ]);
  }
  const serial = text(run.serial);
  const platform = text(run.platform);
  const profileId = text(run.targetProfile?.id);
  return serial && platform
    ? identityDigest(["legacy-target", platform, serial, profileId])
    : undefined;
}

function sourceKeyFromRun(run: PersistedRun): `sha256:${string}` | undefined {
  if (run.sourceRevision) {
    return identityDigest([
      run.sourceRevision.vcs,
      run.sourceRevision.sha,
      run.sourceRevision.artifactDigest ?? null,
      run.appVersion ?? null,
    ]);
  }
  const appVersion = text(run.appVersion);
  return appVersion ? identityDigest(["app-version", appVersion]) : undefined;
}

function artifactObject(
  pack: TracePack,
  path: string,
): {
  status: "embedded" | "missing" | "redacted";
  object?: TracePackObject;
} {
  const reference = pack.completeness.artifacts?.find((item) => item.path === path);
  if (!reference) return { status: "missing" };
  if (reference.status !== "embedded") return { status: reference.status };
  const object = pack.objects.find((item) => item.path === reference.objectPath);
  return object ? { status: "embedded", object } : { status: "missing" };
}

function bytesOf(object: TracePackObject | undefined): Buffer | undefined {
  return object?.encoding === "base64" && typeof object.content === "string"
    ? Buffer.from(object.content, "base64")
    : undefined;
}

function project(value: unknown): PackProjection {
  const pack = verifyTracePack(value);
  const { run, digest } = runFromPack(pack);
  const semantics = frameObservations(run);
  const frames = run.frames.map((frame, index): FrameProjection => {
    const embedded = artifactObject(pack, frame.path);
    const bytes = bytesOf(embedded.object);
    const dimensions =
      bytes && embedded.object?.mediaType === "image/png" ? pngDimensions(bytes) : undefined;
    return {
      index,
      ...(frame.caption ? { caption: frame.caption } : {}),
      status: embedded.status,
      ...(embedded.object ? { object: embedded.object } : {}),
      ...(dimensions ? { dimensions } : {}),
      ...(semantics.get(basename(frame.path))
        ? { semantic: semantics.get(basename(frame.path))! }
        : {}),
    };
  });
  const locale = localeFromRun(run);
  const testKey = testKeyFromRun(run);
  const targetKey = targetKeyFromRun(run);
  const sourceKey = sourceKeyFromRun(run);
  return {
    pack,
    run,
    runObjectDigest: digest,
    ...(locale ? { locale } : {}),
    ...(testKey ? { testKey } : {}),
    ...(targetKey ? { targetKey } : {}),
    ...(sourceKey ? { sourceKey } : {}),
    frames,
  };
}

function common<T>(values: readonly (T | undefined)[]): T | undefined {
  return values.length > 0 && values.every((value) => value !== undefined && value === values[0])
    ? values[0]
    : undefined;
}

function frameObservation(
  projection: PackProjection,
  frame: FrameProjection | undefined,
): FrameObservationProjection {
  if (!frame) {
    return {
      tracePackDigest: projection.pack.digest,
      status: "absent",
      semanticObservation: false,
    };
  }
  return {
    tracePackDigest: projection.pack.digest,
    status: frame.status,
    ...(frame.object ? { digest: frame.object.digest } : {}),
    ...(frame.dimensions ? { width: frame.dimensions.width, height: frame.dimensions.height } : {}),
    ...(frame.caption !== undefined ? { caption: frame.caption } : {}),
    semanticObservation: Boolean(frame.semantic),
  };
}

function visualHistory(projections: readonly PackProjection[]): {
  baseline: TracePackVisualLocalization["historicalBaseline"];
  sufficient: boolean;
  reasons: string[];
} {
  const locale = common(projections.map((item) => item.locale));
  const testKey = common(projections.map((item) => item.testKey));
  const targetKey = common(projections.map((item) => item.targetKey));
  const scopeMissing = projections.some((item) => !item.locale || !item.testKey || !item.targetKey);
  const evidence = projections.map((item) => item.runObjectDigest);
  if (!locale || !testKey || !targetKey) {
    const reason = scopeMissing
      ? "At least one pack lacks locale, canonical Test, or target identity required for a locale-specific historical baseline."
      : "The packs describe different locales, Tests, or targets and cannot share one historical visual baseline.";
    return {
      baseline: {
        status: "not-comparable",
        frameCountStatus: "unavailable",
        fact: fact("unknowable", reason, evidence),
        frames: [],
      },
      sufficient: false,
      reasons: [reason],
    };
  }

  const frameCount = Math.max(...projections.map((item) => item.frames.length));
  if (frameCount === 0) {
    const reason =
      "The locale-specific Test and target baseline is identified, but none of the packs contains a captured frame.";
    return {
      baseline: {
        status: "comparable",
        locale,
        testKey,
        targetKey,
        frameCountStatus: "unchanged",
        fact: fact("unknowable", reason, evidence),
        frames: [],
      },
      sufficient: false,
      reasons: [reason],
    };
  }
  const frames: FrameDelta[] = [];
  const reasons: string[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const observations = projections.map((item) => frameObservation(item, item.frames[index]));
    const embedded = observations.filter((item) => item.status === "embedded");
    const captions = observations.map((item) => item.caption);
    const captionStatus = captions.some((item) => item === undefined)
      ? ("unavailable" as const)
      : new Set(captions).size === 1
        ? ("unchanged" as const)
        : ("changed" as const);
    const canonicalKey = `frame-${String(index + 1).padStart(3, "0")}`;
    let status: FrameDelta["status"];
    let statement: string;
    let classification: Fact["classification"] = "recomputable";
    if (observations.some((item) => item.status === "missing" || item.status === "redacted")) {
      status = embedded.length ? "presence-changed" : "not-comparable";
      classification = "unknowable";
      statement = `${canonicalKey} is referenced but not embedded in at least one TracePack, so its pixels cannot be compared offline.`;
      reasons.push(statement);
    } else if (embedded.length !== observations.length) {
      status = "presence-changed";
      statement = `${canonicalKey} was added or removed across the frozen run manifests.`;
    } else {
      const dimensions = observations.map((item) => `${item.width ?? "?"}x${item.height ?? "?"}`);
      if (observations.some((item) => item.width === undefined || item.height === undefined)) {
        status = "not-comparable";
        classification = "unknowable";
        statement = `${canonicalKey} is embedded but lacks a supported PNG dimension header in at least one pack.`;
        reasons.push(statement);
      } else if (new Set(dimensions).size > 1) {
        status = "dimensions-changed";
        statement = `${canonicalKey} has different raster dimensions across the frozen runs.`;
      } else if (new Set(observations.map((item) => item.digest)).size === 1) {
        status = "exact-match";
        statement = `${canonicalKey} is byte-identical across the frozen runs.`;
      } else {
        status = "pixels-changed";
        statement = `${canonicalKey} has different embedded raster bytes; this proves change, not regression.`;
      }
    }
    frames.push({
      canonicalKey,
      status,
      captionStatus,
      fact: fact(
        classification,
        statement,
        observations.flatMap((item) => (item.digest ? [item.digest] : [item.tracePackDigest])),
      ),
      observations,
    });
  }
  return {
    baseline: {
      status: "comparable",
      locale,
      testKey,
      targetKey,
      frameCountStatus:
        new Set(projections.map((item) => item.frames.length)).size === 1 ? "unchanged" : "changed",
      fact: fact(
        "recomputable",
        `Every pack belongs to the same ${locale} Test and target baseline; embedded frames may be compared as historical evidence.`,
        evidence,
      ),
      frames,
    },
    sufficient: frames.every((frame) => frame.fact.classification === "recomputable"),
    reasons,
  };
}

function localizationHistory(projections: readonly PackProjection[]): {
  localization: TracePackVisualLocalization["localization"];
  sufficiency: TracePackVisualLocalization["sufficiency"]["localization"];
  reasons: string[];
} {
  const locales = [...new Set(projections.flatMap((item) => (item.locale ? [item.locale] : [])))];
  const evidence = projections.map((item) => item.runObjectDigest);
  if (locales.length < 2) {
    return {
      localization: {
        status: "not-applicable",
        locales,
        coverage: { frames: 0, inspectedFrames: 0 },
        findings: [],
        fact: fact(
          "recomputable",
          "Localization recomputation requires at least two frozen locale cases; this history contains at most one.",
          evidence,
        ),
      },
      sufficiency: "not-applicable",
      reasons: [],
    };
  }
  const testKey = common(projections.map((item) => item.testKey));
  const targetKey = common(projections.map((item) => item.targetKey));
  const sourceKey = common(projections.map((item) => item.sourceKey));
  if (!testKey || !targetKey || !sourceKey || projections.some((item) => !item.locale)) {
    const reason =
      "Locale cases do not share one proved Test, target, and source-build identity, so localization findings cannot be recomputed safely.";
    return {
      localization: {
        status: "insufficient-evidence",
        locales,
        coverage: { frames: 0, inspectedFrames: 0 },
        findings: [],
        fact: fact("unknowable", reason, evidence),
      },
      sufficiency: "insufficient",
      reasons: [reason],
    };
  }

  const captures = projections.flatMap((projection) =>
    projection.frames.flatMap((frame) => {
      if (frame.status !== "embedded" || !frame.object) return [];
      return [
        {
          locale: projection.locale!,
          jobId: projection.run.id,
          index: frame.index,
          packPath: `${projection.pack.digest}/${frame.object.path}`,
          sha256: frame.object.digest,
          ...(frame.semantic ? { observation: frame.semantic } : {}),
        },
      ];
    }),
  );
  const report = analyzeCombineEvidenceBatchData({
    batchId: identityDigest(projections.map((item) => item.pack.digest)),
    title: "TracePack localization recomputation",
    locales,
    captures,
    compareText: true,
  });
  if (report.coverage.frames === 0 || report.coverage.inspectedFrames === 0) {
    const reason =
      "The TracePacks contain no embedded frame with a locale-stable semantic observation.";
    return {
      localization: {
        status: "insufficient-evidence",
        locales,
        baselineLocale: locales[0],
        coverage: report.coverage,
        findings: [],
        fact: fact("unknowable", reason, evidence),
      },
      sufficiency: "insufficient",
      reasons: [reason],
    };
  }
  const partial = report.coverage.inspectedFrames < report.coverage.frames;
  const reason = partial
    ? `${report.coverage.frames - report.coverage.inspectedFrames} embedded locale frame(s) have no semantic observation; deterministic findings cover only inspected frames.`
    : undefined;
  return {
    localization: {
      status: partial ? "partial" : "recomputed",
      locales,
      baselineLocale: report.analysis.baselineLocale,
      coverage: report.coverage,
      findings: report.analysis.findings,
      fact: fact(
        "recomputable",
        partial
          ? "Relay reran its deterministic localization checks over the inspected subset of embedded locale evidence."
          : "Relay reran its deterministic localization checks over every embedded locale frame.",
        captures.map((capture) => capture.sha256),
      ),
    },
    sufficiency: partial ? "partial" : "sufficient",
    reasons: reason ? [reason] : [],
  };
}

/**
 * Recompute only facts supported by content-addressed TracePack objects. This
 * function has no workspace, model, OCR, network, target, or mutation input.
 */
export function recomputeTracePackVisualLocalization(
  values: readonly unknown[],
): TracePackVisualLocalization {
  if (values.length < 2 || values.length > 64) {
    throw new Error("TracePack visual/localization recomputation requires 2-64 ordered packs");
  }
  const projections = values.map(project);
  if (new Set(projections.map((item) => item.pack.digest)).size !== projections.length) {
    throw new Error("TracePack visual/localization recomputation requires unique packs");
  }
  const visual = visualHistory(projections);
  const localization = localizationHistory(projections);
  const reasons = [...new Set([...visual.reasons, ...localization.reasons])];
  const latest = projections.at(-1)!;
  const missingFrame = projections.find((item) =>
    item.frames.some((frame) => frame.status !== "embedded" || !frame.dimensions),
  );
  const frameEvidenceGap =
    missingFrame ??
    (projections.every((item) => item.frames.length === 0) ? projections[0] : undefined);
  const needsSemantics =
    localization.sufficiency === "partial" || localization.sufficiency === "insufficient";

  return tracePackVisualLocalizationSchema.parse({
    schemaVersion: 1,
    mode: "trace-pack-visual-localization-recomputation",
    orderedTracePacks: projections.map((item, ordinal) => ({
      ordinal,
      tracePackDigest: item.pack.digest,
      sourceRunId: item.run.id,
      ...(item.locale ? { locale: item.locale } : {}),
      ...(item.testKey ? { testKey: item.testKey } : {}),
      ...(item.targetKey ? { targetKey: item.targetKey } : {}),
      ...(item.sourceKey ? { sourceKey: item.sourceKey } : {}),
      frameCount: item.frames.length,
      embeddedFrames: item.frames.filter((frame) => frame.status === "embedded").length,
      inspectedFrames: item.frames.filter((frame) => frame.semantic).length,
    })),
    historicalBaseline: visual.baseline,
    localization: localization.localization,
    sufficiency: {
      visual: visual.sufficient ? "sufficient" : "insufficient",
      localization: localization.sufficiency,
      reasons,
    },
    futureTransitionVerdict: "unknown",
    smallestLiveVerification: frameEvidenceGap
      ? {
          classification: "live-verification-required",
          kind: "recapture-frame-evidence",
          tracePackDigest: frameEvidenceGap.pack.digest,
          reason:
            "Recapture the first pack whose required frame is missing, redacted, or not a supported PNG before drawing a visual conclusion.",
          requiresTarget: true,
        }
      : needsSemantics && localesNeedSemanticComparison(localization.localization.locales)
        ? {
            classification: "live-verification-required",
            kind: "recapture-semantic-evidence",
            tracePackDigest: latest.pack.digest,
            reason:
              "Recapture one affected locale frame with its UI tree to complete deterministic localization checks.",
            requiresTarget: true,
          }
        : {
            classification: "live-verification-required",
            kind: "replay-frozen-test",
            tracePackDigest: latest.pack.digest,
            reason:
              "Historical evidence recomputation is exhausted; replay the latest frozen Test to establish current behavior.",
            requiresTarget: true,
          },
    repairPolicy: { mutation: "none", requiresReview: true },
  });
}

function localesNeedSemanticComparison(locales: readonly string[]): boolean {
  return locales.length >= 2;
}
