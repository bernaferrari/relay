/**
 * Fresh live proof for resuming a run after a human has changed the target.
 *
 * iOS accessibility can arrive late relative to the pixels. A qualified AX
 * tree is therefore not enough on that platform: capture it only inside a
 * screenshot → AX → screenshot bracket whose visual identities agree.
 */
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import type { AuthoringEvidence } from "@relay/protocol";
import { authoringEvidenceExists, persistAuthoringEvidence } from "./authoring-evidence.js";
import type { OperationContext } from "./operation-context.js";
import {
  assertQualifiedHumanInterventionReproof,
  HumanInterventionReproofUnavailableError,
  operationOwnsHumanIntervention,
  recordHumanInterventionReproof,
} from "./job-intervention.js";
import { visualEvidenceAllowed } from "./redaction.js";
import { observeVisualScreenFingerprint } from "./screen-identity.js";
import type { TestJob } from "./session-contract.js";
import {
  cleanupScreenshot,
  isBlankScreenshot,
  type ScreenshotPayload,
  type SnapshotPayload,
} from "./workspace-capture.js";

export const HUMAN_INTERVENTION_PIXEL_BRACKET_SCHEMA_VERSION = 1 as const;

export type HumanInterventionPixelBracket = {
  schemaVersion: typeof HUMAN_INTERVENTION_PIXEL_BRACKET_SCHEMA_VERSION;
  captureOrder: "pixels-ax-pixels";
  serial: string;
  before: { capturedAt: number; visualFingerprint: string; rasterDigest: string };
  after: { capturedAt: number; visualFingerprint: string; rasterDigest: string };
  /** Immutable evidence is required before an iOS reproof can release a
   * human pause. The compact refs make the decision auditable offline while
   * the evidence store remains subject to the normal visual-redaction gate. */
  evidence: {
    before: AuthoringEvidence;
    semantics: AuthoringEvidence;
    after: AuthoringEvidence;
    manifest: AuthoringEvidence;
  };
};

export type HumanInterventionReproofCapture = {
  captureSnapshot: () => Promise<SnapshotPayload>;
  /** Required for iOS; Android keeps its established semantic-only reproof. */
  captureScreenshot?: () => Promise<ScreenshotPayload>;
  cleanupScreenshot?: (path: string) => Promise<void>;
  persistEvidence?: typeof persistAuthoringEvidence;
  /** Defaults to the content-addressed evidence store. Test/provider seams
   * must prove that returned refs still resolve before a pause can clear. */
  evidenceExists?: typeof authoringEvidenceExists;
};

function unavailable(message: string): HumanInterventionReproofUnavailableError {
  return new HumanInterventionReproofUnavailableError(message);
}

function snapshotObservation(
  snapshot: SnapshotPayload,
  pixelBracket?: HumanInterventionPixelBracket,
): Record<string, unknown> {
  return {
    capturedAt: snapshot.capturedAt,
    inspectable: snapshot.inspectable,
    source: snapshot.source,
    foregroundApp: snapshot.foregroundApp,
    bindingState: snapshot.bindingState,
    screenIdentity: snapshot.screenIdentity,
    visualFingerprint: snapshot.visualFingerprint,
    readiness: snapshot.readiness,
    nodeCount: snapshot.nodes.length,
    ...(pixelBracket ? { pixelBracket } : {}),
  };
}

function visualEvidence(
  screenshot: ScreenshotPayload,
  targetId: string,
): {
  capturedAt: number;
  visualFingerprint: string;
  rasterDigest: string;
  bytes: Buffer;
  mime: string;
} {
  if (screenshot.serial !== targetId) {
    throw unavailable("Resume reproof screenshot did not identify the intervened iOS target.");
  }
  if (!Number.isFinite(screenshot.capturedAt)) {
    throw unavailable("Resume reproof screenshot did not have a valid capture time.");
  }
  const bytes = Buffer.from(screenshot.base64, "base64");
  const visualFingerprint = observeVisualScreenFingerprint(bytes);
  const rasterDigest = normalizedRasterDigest(bytes);
  if (!bytes.byteLength || isBlankScreenshot(bytes) || !visualFingerprint || !rasterDigest) {
    throw unavailable(
      "Resume on iOS requires a fresh, non-blank screenshot around the accessibility proof.",
    );
  }
  return {
    capturedAt: screenshot.capturedAt,
    visualFingerprint,
    rasterDigest,
    bytes,
    mime: screenshot.mime,
  };
}

/** The perceptual fingerprint intentionally ignores much of the page so it
 * can identify a screen across benign change. A reproof needs the stricter
 * question: did any app pixel move while AX was in flight? Hash the complete
 * decoded raster after masking only the device status-bar band, whose clock
 * and radios are not app state. Orientation has already been normalized by
 * workspace capture before the payload reaches this boundary. */
function normalizedRasterDigest(png: Uint8Array): string | undefined {
  try {
    const image = PNG.sync.read(Buffer.from(png));
    if (image.width < 17 || image.height < 20) return undefined;
    const pixels = Buffer.from(image.data);
    const statusBarRows = Math.min(image.height, Math.ceil(image.height * 0.055));
    pixels.fill(0, 0, statusBarRows * image.width * 4);
    return createHash("sha256")
      .update(`relay-human-reproof-raster:v1:${image.width}x${image.height}\u0000`)
      .update(pixels)
      .digest("hex");
  } catch {
    return undefined;
  }
}

function assertSameTarget(snapshot: SnapshotPayload, targetId: string): void {
  if (snapshot.serial !== targetId) {
    throw unavailable(
      "Resume reproof accessibility snapshot did not identify the intervened iOS target.",
    );
  }
}

type PreparedPixelBracket = {
  before: ReturnType<typeof visualEvidence>;
  after: ReturnType<typeof visualEvidence>;
};

function preparePixelBracket(input: {
  targetId: string;
  before: ScreenshotPayload;
  snapshot: SnapshotPayload;
  after: ScreenshotPayload;
}): PreparedPixelBracket {
  const before = visualEvidence(input.before, input.targetId);
  const after = visualEvidence(input.after, input.targetId);
  assertSameTarget(input.snapshot, input.targetId);
  if (
    before.capturedAt > input.snapshot.capturedAt ||
    input.snapshot.capturedAt > after.capturedAt
  ) {
    throw unavailable(
      "Resume on iOS requires screenshots captured around the fresh accessibility proof.",
    );
  }
  if (
    before.visualFingerprint !== after.visualFingerprint ||
    before.rasterDigest !== after.rasterDigest
  ) {
    throw unavailable(
      "The iOS target pixels changed while accessibility was being captured; keep the run paused and retry after it settles.",
    );
  }
  return { before, after };
}

function evidenceRef(evidence: AuthoringEvidence) {
  return {
    id: evidence.id,
    uri: evidence.uri,
    sha256: evidence.sha256,
    capturedAt: evidence.capturedAt,
  };
}

function semanticEvidenceData(snapshot: SnapshotPayload, targetId: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "human-intervention-reproof-semantics",
    serial: targetId,
    capturedAt: snapshot.capturedAt,
    source: snapshot.source,
    inspectable: snapshot.inspectable,
    ...(snapshot.inspectionState ? { inspectionState: snapshot.inspectionState } : {}),
    ...(snapshot.foregroundApp ? { foregroundApp: snapshot.foregroundApp } : {}),
    ...(snapshot.treeApp ? { treeApp: snapshot.treeApp } : {}),
    ...(snapshot.bindingState ? { bindingState: snapshot.bindingState } : {}),
    bounds: snapshot.bounds,
    screenIdentity: snapshot.screenIdentity,
    readiness: snapshot.readiness,
    nodes: snapshot.nodes,
  });
}

type EvidenceWrite = {
  kind: AuthoringEvidence["kind"];
  capturedAt: number;
  data: Uint8Array | string;
  mime?: string;
};

function assertPersistedEvidenceMatches(
  evidence: AuthoringEvidence,
  expected: EvidenceWrite,
): void {
  const bytes =
    typeof expected.data === "string"
      ? Buffer.from(expected.data, "utf8")
      : Buffer.from(expected.data);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (
    evidence.kind !== expected.kind ||
    evidence.capturedAt !== expected.capturedAt ||
    evidence.sha256 !== sha256 ||
    evidence.uri !== `relay-evidence://${sha256}` ||
    evidence.bytes !== bytes.byteLength ||
    evidence.mime !== expected.mime
  ) {
    throw unavailable("Resume reproof evidence did not retain the captured immutable bytes.");
  }
}

async function persistVerifiedEvidence(input: {
  persistEvidence: typeof persistAuthoringEvidence;
  evidenceExists: typeof authoringEvidenceExists;
  write: EvidenceWrite;
}): Promise<AuthoringEvidence> {
  const evidence = await input.persistEvidence(input.write);
  assertPersistedEvidenceMatches(evidence, input.write);
  if (!(await input.evidenceExists(evidence))) {
    throw unavailable("Resume reproof evidence was not durably committed.");
  }
  return evidence;
}

async function persistPixelBracketEvidence(input: {
  job: TestJob;
  targetId: string;
  snapshot: SnapshotPayload;
  bracket: PreparedPixelBracket;
  persistEvidence: typeof persistAuthoringEvidence;
  evidenceExists: typeof authoringEvidenceExists;
}): Promise<HumanInterventionPixelBracket["evidence"]> {
  const before = await persistVerifiedEvidence({
    persistEvidence: input.persistEvidence,
    evidenceExists: input.evidenceExists,
    write: {
      kind: "screenshot",
      capturedAt: input.bracket.before.capturedAt,
      data: input.bracket.before.bytes,
      mime: input.bracket.before.mime,
    },
  });
  const semantics = await persistVerifiedEvidence({
    persistEvidence: input.persistEvidence,
    evidenceExists: input.evidenceExists,
    write: {
      kind: "snapshot",
      capturedAt: input.snapshot.capturedAt,
      data: semanticEvidenceData(input.snapshot, input.targetId),
      mime: "application/json",
    },
  });
  const after = await persistVerifiedEvidence({
    persistEvidence: input.persistEvidence,
    evidenceExists: input.evidenceExists,
    write: {
      kind: "screenshot",
      capturedAt: input.bracket.after.capturedAt,
      data: input.bracket.after.bytes,
      mime: input.bracket.after.mime,
    },
  });
  const manifest = await persistVerifiedEvidence({
    persistEvidence: input.persistEvidence,
    evidenceExists: input.evidenceExists,
    write: {
      kind: "snapshot",
      capturedAt: input.bracket.after.capturedAt,
      data: JSON.stringify({
        schemaVersion: HUMAN_INTERVENTION_PIXEL_BRACKET_SCHEMA_VERSION,
        kind: "human-intervention-reproof",
        jobId: input.job.id,
        serial: input.targetId,
        captureOrder: "pixels-ax-pixels",
        pixels: {
          before: evidenceRef(before),
          after: evidenceRef(after),
          visualFingerprint: input.bracket.before.visualFingerprint,
          rasterDigest: input.bracket.before.rasterDigest,
        },
        semantics: evidenceRef(semantics),
      }),
      mime: "application/json",
    },
  });
  return { before, semantics, after, manifest };
}

function pixelBracket(input: {
  targetId: string;
  prepared: PreparedPixelBracket;
  evidence: HumanInterventionPixelBracket["evidence"];
}): HumanInterventionPixelBracket {
  return {
    schemaVersion: HUMAN_INTERVENTION_PIXEL_BRACKET_SCHEMA_VERSION,
    captureOrder: "pixels-ax-pixels",
    serial: input.targetId,
    before: {
      capturedAt: input.prepared.before.capturedAt,
      visualFingerprint: input.prepared.before.visualFingerprint,
      rasterDigest: input.prepared.before.rasterDigest,
    },
    after: {
      capturedAt: input.prepared.after.capturedAt,
      visualFingerprint: input.prepared.after.visualFingerprint,
      rasterDigest: input.prepared.after.rasterDigest,
    },
    evidence: input.evidence,
  };
}

/**
 * Capture and append a reproof atomically from the route's perspective. No
 * reproof artifact is recorded until all required evidence is current and
 * coherent, so an idempotent retry cannot release a partially observed pause.
 */
export async function captureHumanInterventionReproof(input: {
  job: TestJob;
  operation: OperationContext;
  targetId: string;
  capture: HumanInterventionReproofCapture;
}): Promise<void> {
  if (input.job.targetContext.kind !== "device") {
    throw unavailable("The intervened target cannot be re-proven.");
  }
  if (input.job.targetContext.serial !== input.targetId) {
    throw unavailable("Resume reproof target did not match the paused job target.");
  }

  if (input.job.targetContext.platform !== "ios") {
    const snapshot = await input.capture.captureSnapshot();
    recordHumanInterventionReproof(input.job, input.operation, snapshotObservation(snapshot));
    return;
  }

  if (!input.capture.captureScreenshot) {
    throw unavailable("Resume on iOS requires pixel evidence around the accessibility proof.");
  }
  const owned = operationOwnsHumanIntervention(input.job, input.operation);
  if (!owned) {
    throw unavailable("Only the intervention owner can re-prove the paused iOS target state.");
  }
  if (!visualEvidenceAllowed()) {
    throw unavailable(
      "Resume on iOS requires durable visual evidence, but visual evidence is disabled by the workspace redaction policy.",
    );
  }
  const cleanup = input.capture.cleanupScreenshot ?? cleanupScreenshot;
  const persist = input.capture.persistEvidence ?? persistAuthoringEvidence;
  const evidenceExists = input.capture.evidenceExists ?? authoringEvidenceExists;
  let before: ScreenshotPayload | undefined;
  let after: ScreenshotPayload | undefined;
  try {
    before = await input.capture.captureScreenshot();
    const snapshot = await input.capture.captureSnapshot();
    after = await input.capture.captureScreenshot();
    const prepared = preparePixelBracket({ targetId: input.targetId, before, snapshot, after });
    const observation = snapshotObservation(snapshot);
    if (snapshot.capturedAt < owned.requestCapturedAt) {
      throw unavailable("Resume requires evidence captured after the human intervention request.");
    }
    // Validate the current semantic fact before writing any evidence. A bad
    // tree must never create a durable-looking pixel bracket that could be
    // mistaken for a successful reproof later.
    assertQualifiedHumanInterventionReproof(observation);
    const evidence = await persistPixelBracketEvidence({
      job: input.job,
      targetId: input.targetId,
      snapshot,
      bracket: prepared,
      persistEvidence: persist,
      evidenceExists,
    });
    const bracket = pixelBracket({ targetId: input.targetId, prepared, evidence });
    recordHumanInterventionReproof(
      input.job,
      input.operation,
      snapshotObservation(snapshot, bracket),
    );
  } finally {
    await Promise.all(
      [before?.path, after?.path]
        .filter((path): path is string => Boolean(path))
        .map(async (path) => cleanup(path).catch(() => undefined)),
    );
  }
}
