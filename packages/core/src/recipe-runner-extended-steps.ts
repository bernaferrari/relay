import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import type { Device } from "./device.js";
import {
  replaceText,
  scrollDown,
  scrollUp,
  sleep,
  snapshot,
  type SnapshotNode,
  typeText,
} from "./device.js";
import { cooperativeCheckpoint } from "./control.js";
import { now } from "./events.js";
import {
  captureScrollableSurveyForTarget,
  type ValidatedFrozenDocumentOrigin,
} from "./scrollable-survey.js";
import { readAuthoringEvidence } from "./authoring-evidence.js";
import {
  documentOriginAttestationAuthorizationIsValid,
  type DocumentOriginAttestationAuthorization,
  type DocumentOriginAttestationBinding,
} from "./document-origin-attestation-authority.js";
import { mintValidatedFrozenDocumentOrigin } from "./frozen-document-origin-capability.js";
import { persistLogicalScrollSurface } from "./logical-scroll-surface.js";
import { listPersistedRuns } from "./runs.js";
import {
  findReusableSurfaceComparison,
  surfaceComparisonNeedsRecapture,
  surfaceComparisonCacheIdentity,
  surfaceComparisonCacheKey,
  type SurfaceComparisonCacheProvenance,
} from "./surface-comparison-cache.js";
import { ensureAndroidSurfaceRuntimeFacts } from "./surface-comparison-runtime-facts.js";
import { compareScreenIdentity, observeScreenIdentity } from "./screen-identity.js";
import {
  resolveSemanticRevealTarget,
  resolveSnapshotTargetPoint,
  resolveSnapshotTargetRevealDirection,
} from "./device-target-resolution.js";
import {
  resilientScreenIdentityMatch,
  longPressRecordedTarget,
  tapRecordedTarget,
} from "./recipe-runner-support.js";
import { screenIdentityMatches } from "./recipe-target-match.js";
import type { RecipeStep } from "./recipes.js";
import {
  currentVerifiedScreen,
  invalidateVerifiedScreen,
  type RecipeStepContext,
} from "./recipe-runner-context.js";
import {
  advanceSemanticRevealNavigation,
  estimateSemanticRevealMovement,
  initialSemanticRevealProgress,
  type RevealDirection,
  type SemanticRevealEstimate,
} from "./semantic-reveal-navigation.js";

type SemanticRevealAttempt =
  | ({ source: "semantic-index"; attemptedDirection: RevealDirection } & SemanticRevealEstimate)
  | { source: "live-target"; attemptedDirection: RevealDirection; amount: number };

function semanticRevealRepair(
  step: Extract<RecipeStep, { kind: "reveal" }>,
  ctx: RecipeStepContext,
  reason: string,
  attempts: SemanticRevealAttempt[],
  nodes: Awaited<ReturnType<typeof snapshot>>,
): never {
  const data = {
    schemaVersion: 1,
    status: "needs-review",
    reason,
    target: structuredClone(step.target),
    authoredDirection: step.direction ?? "auto",
    maxAttempts: step.maxAttempts ?? 12,
    surfaces: (step.navigation ?? []).map((plan) => ({
      surfaceId: plan.surfaceId,
      captureId: plan.captureId,
      targetOrder: plan.targetOrder,
      targetDocumentY: plan.targetDocumentY,
    })),
    attempts: structuredClone(attempts),
    lastObservation: {
      fingerprint: observeScreenIdentity(nodes).fingerprint,
      nodeCount: nodes.length,
      accessibilityTree: structuredClone(nodes),
    },
  };
  const artifact = { kind: "semantic-reveal-repair", capturedAt: now(), data };
  ctx.job?.artifacts.push(artifact);
  ctx.artifacts?.push(artifact);
  throw new Error(`reveal-control: ${reason}; repair packet captured`);
}

export async function runTapStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "tap" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  if (step.gesture === "hold") return longPressRecordedTarget(device, step, ctx);
  const multi = step.gesture === "multi";
  await tapRecordedTarget(
    device,
    { ...step, region: step.when?.region },
    ctx,
    multi ? (step.tapCount ?? 2) : 1,
    multi ? (step.intervalMs ?? 100) : 0,
  );
}

export async function runTypeStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "type" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  if (step.mode === "replace") {
    if (!step.target) throw new Error("replace text requires a target");
    return replaceText(device, step.target, step.text);
  }
  if (step.target) await tapRecordedTarget(device, { ...step, target: step.target }, ctx);
  await typeText(device, step.text);
}

export async function runSemanticScrollStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "scroll" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const performScroll = () =>
    step.direction === "down" ? scrollDown(device, step.amount) : scrollUp(device, step.amount);
  if (!step.until) return performScroll();
  const expected = new Set([step.until.fingerprint, ...(step.until.aliases ?? [])]);
  const maxAttempts = step.maxAttempts ?? 12;
  let previousFingerprint: string | undefined;
  let repeated = 0;
  for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
    await cooperativeCheckpoint();
    const observed = observeScreenIdentity(await snapshot(device));
    if (
      screenIdentityMatches(expected, observed.fingerprint) ||
      (step.until.observations ?? []).some(
        (observation) => compareScreenIdentity(observed, observation).decision === "match",
      ) ||
      resilientScreenIdentityMatch(observed, step.until.observations ?? [], ctx.job, {
        allowDynamicShell: false,
      })
    ) {
      ctx.log(
        attempt
          ? `scroll: revealed ${step.until.screenTitle} after ${attempt} semantic scroll${attempt === 1 ? "" : "s"}`
          : `scroll: ${step.until.screenTitle} already visible`,
      );
      return;
    }
    if (attempt === maxAttempts) {
      throw new Error(
        `reveal-screen: could not reveal “${step.until.screenTitle}” after ${maxAttempts} scrolls`,
      );
    }
    repeated = observed.fingerprint === previousFingerprint ? repeated + 1 : 0;
    if (repeated >= 2) {
      throw new Error(`reveal-screen: reached the list edge before “${step.until.screenTitle}”`);
    }
    previousFingerprint = observed.fingerprint;
    await performScroll();
    await sleep(250, device);
  }
}

export async function runRevealStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "reveal" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const maxAttempts = step.maxAttempts ?? 12;
  const targetFound = (nodes: Awaited<ReturnType<typeof snapshot>>) => {
    const hit = resolveSemanticRevealTarget(nodes, step.target);
    if (!hit) return false;
    if (hit.revealDirection) return false;
    return true;
  };
  const chromeNudge = (nodes: Awaited<ReturnType<typeof snapshot>>) =>
    resolveSemanticRevealTarget(nodes, step.target)?.revealDirection;
  if (step.navigation?.length) {
    let previousFingerprint: string | undefined;
    let repeated = 0;
    let progress = initialSemanticRevealProgress();
    const movements: SemanticRevealAttempt[] = [];
    let lastAttemptedDirection: RevealDirection | undefined;
    for (let attempts = 0; attempts <= maxAttempts; attempts += 1) {
      await cooperativeCheckpoint();
      const nodes = ctx.runtime?.observation?.nodes ?? (await snapshot(device));
      if (ctx.runtime && !ctx.runtime.observation) {
        ctx.runtime.observation = { nodes, observedAt: now() };
      }
      if (targetFound(nodes)) {
        ctx.log(
          `reveal: found semantic target after ${attempts} indexed scroll${attempts === 1 ? "" : "s"}`,
        );
        return;
      }
      const nudge = chromeNudge(nodes);
      if (nudge) {
        const priorDirection = lastAttemptedDirection;
        if (priorDirection && priorDirection !== nudge) {
          if (progress.directionChanges > 0) {
            semanticRevealRepair(
              step,
              ctx,
              `live target geometry requested a second direction reversal (${priorDirection} to ${nudge})`,
              movements,
              nodes,
            );
          }
          // The target itself is stronger evidence than inferred anchors. One
          // small correction may clear fixed chrome; it consumes the only
          // permitted reversal for this reveal.
          progress = { ...progress, direction: nudge, directionChanges: 1 };
        }
        if (ctx.runtime) {
          invalidateVerifiedScreen(ctx);
        }
        if (nudge === "down") await scrollDown(device, 0.18);
        else await scrollUp(device, 0.18);
        movements.push({ source: "live-target", attemptedDirection: nudge, amount: 0.18 });
        lastAttemptedDirection = nudge;
        ctx.log(`reveal: ${nudge} 0.18 to clear chrome over the live target`);
        previousFingerprint = undefined;
        repeated = 0;
        await sleep(250, device);
        continue;
      }
      if (attempts === maxAttempts) {
        semanticRevealRepair(
          step,
          ctx,
          `semantic target was not found after ${maxAttempts} indexed scrolls`,
          movements,
          nodes,
        );
      }
      const estimate = estimateSemanticRevealMovement(nodes, step.navigation);
      if (!estimate) {
        semanticRevealRepair(
          step,
          ctx,
          "live viewport does not overlap the compiled full-surface semantic index",
          movements,
          nodes,
        );
      }
      const observed = observeScreenIdentity(nodes);
      repeated = observed.fingerprint === previousFingerprint ? repeated + 1 : 0;
      previousFingerprint = observed.fingerprint;
      if (repeated >= 2) {
        semanticRevealRepair(
          step,
          ctx,
          "indexed navigation reached the surface edge without revealing the target",
          movements,
          nodes,
        );
      }
      const authoredDirection =
        step.direction && step.direction !== "auto" ? step.direction : undefined;
      const decision = advanceSemanticRevealNavigation(progress, estimate, authoredDirection);
      if (decision.status === "unsafe") {
        semanticRevealRepair(step, ctx, decision.reason, movements, nodes);
      }
      progress = decision.progress;
      const movement = decision.movement;
      movements.push({
        source: "semantic-index",
        ...movement,
        attemptedDirection: movement.direction,
      });
      lastAttemptedDirection = movement.direction;
      if (ctx.runtime) {
        invalidateVerifiedScreen(ctx);
      }
      if (movement.direction === "down") await scrollDown(device, movement.amount);
      else await scrollUp(device, movement.amount);
      ctx.log(
        `reveal: ${movement.direction} ${movement.amount.toFixed(2)} from semantic surface ${movement.surfaceId}`,
      );
      await sleep(250, device);
    }
  }
  const directions =
    step.direction === "up" ? ["up"] : step.direction === "down" ? ["down"] : ["down", "up"];
  let attempts = 0;
  for (const direction of directions) {
    let previousFingerprint: string | undefined;
    let repeated = 0;
    while (attempts <= maxAttempts) {
      await cooperativeCheckpoint();
      const nodes = ctx.runtime?.observation?.nodes ?? (await snapshot(device));
      if (ctx.runtime && !ctx.runtime.observation) {
        ctx.runtime.observation = { nodes, observedAt: now() };
      }
      if (targetFound(nodes) || resolveSnapshotTargetPoint(nodes, step.target)) {
        ctx.log(
          `reveal: found semantic target after ${attempts} scroll${attempts === 1 ? "" : "s"}`,
        );
        return;
      }
      if (attempts === maxAttempts) break;
      const observed = observeScreenIdentity(nodes);
      repeated = observed.fingerprint === previousFingerprint ? repeated + 1 : 0;
      previousFingerprint = observed.fingerprint;
      if (repeated >= 2) break;
      const suggestedDirection =
        chromeNudge(nodes) ??
        (step.direction === "auto"
          ? resolveSnapshotTargetRevealDirection(nodes, step.target)
          : undefined);
      const nextDirection = suggestedDirection ?? direction;
      const targetedAmount = suggestedDirection ? 0.18 : undefined;
      if (ctx.runtime) {
        invalidateVerifiedScreen(ctx);
      }
      if (nextDirection === "down") await scrollDown(device, targetedAmount);
      else await scrollUp(device, targetedAmount);
      attempts += 1;
      await sleep(250, device);
    }
  }
  throw new Error(`reveal-control: semantic target was not found after ${maxAttempts} scrolls`);
}

export async function runScrollOrRevealStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "scroll" | "reveal" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  if (step.kind === "scroll") {
    invalidateVerifiedScreen(ctx);
    return runSemanticScrollStep(device, step, ctx);
  }
  return runRevealStep(device, step, ctx);
}

function evidenceBytesMatch(bytes: Buffer, evidence: { sha256: string; bytes: number }): boolean {
  return (
    bytes.byteLength === evidence.bytes &&
    createHash("sha256").update(bytes).digest("hex") === evidence.sha256
  );
}

function isSnapshotNode(value: unknown): value is SnapshotNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function frozenScreenshotMatchesViewport(
  image: Buffer,
  origin: Extract<RecipeStep, { kind: "capture-surface" }>["documentOrigin"],
): boolean {
  if (!origin) return false;
  try {
    const decoded = PNG.sync.read(image);
    return decoded.width === origin.width && decoded.height === origin.height;
  } catch {
    return false;
  }
}

function frozenDocumentOriginGeometryIsValid(
  origin: Extract<RecipeStep, { kind: "capture-surface" }>["documentOrigin"],
): boolean {
  return Boolean(
    origin &&
    origin.index === 0 &&
    origin.offsetY === 0 &&
    origin.appendedHeight === 0 &&
    Number.isSafeInteger(origin.capturedAt) &&
    Number.isSafeInteger(origin.width) &&
    Number.isSafeInteger(origin.height) &&
    origin.width > 0 &&
    origin.height > 0,
  );
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function evidenceSha256(value: unknown): string | undefined {
  const sha256 = objectRecord(value)?.sha256;
  return typeof sha256 === "string" && /^[a-f0-9]{64}$/u.test(sha256) ? sha256 : undefined;
}

type RuntimeEvidenceReference = {
  id: string;
  uri: string;
  sha256: string;
  mime: "application/json";
  bytes: number;
};

function attestationEvidence(value: unknown): RuntimeEvidenceReference | undefined {
  const evidence = objectRecord(value);
  const sha256 = evidenceSha256(evidence);
  if (
    !evidence ||
    !sha256 ||
    typeof evidence.id !== "string" ||
    !evidence.id.trim() ||
    evidence.uri !== `relay-evidence://${sha256}` ||
    evidence.mime !== "application/json" ||
    typeof evidence.bytes !== "number" ||
    !Number.isSafeInteger(evidence.bytes) ||
    evidence.bytes < 0
  ) {
    return undefined;
  }
  return {
    id: evidence.id,
    uri: evidence.uri,
    sha256,
    mime: "application/json",
    bytes: evidence.bytes,
  };
}

function attestationAuthorization(
  value: unknown,
): DocumentOriginAttestationAuthorization | undefined {
  const authorization = objectRecord(value);
  if (
    !authorization ||
    authorization.schemaVersion !== 1 ||
    authorization.issuer !== "relay-local-capture" ||
    typeof authorization.signature !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(authorization.signature)
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    issuer: "relay-local-capture",
    signature: authorization.signature,
  };
}

function frozenDocumentOriginProofIsValid(
  step: Extract<RecipeStep, { kind: "capture-surface" }>,
): boolean {
  // RecipeStep is normally parser-validated, but this execution boundary is
  // also callable from persisted/manual JS. Treat every malformed nested
  // shape as unavailable proof rather than letting a property read throw.
  const origin = objectRecord(step.documentOrigin);
  const proof = objectRecord(step.documentOriginProof);
  const firstViewport = objectRecord(proof?.firstViewport);
  const screenshotSha256 = evidenceSha256(origin?.screenshot);
  const accessibilityTreeSha256 = evidenceSha256(origin?.accessibilityTree);
  const attestation = attestationEvidence(proof?.attestation);
  const authorization = attestationAuthorization(proof?.authorization);
  return Boolean(
    origin &&
    proof &&
    firstViewport &&
    screenshotSha256 &&
    accessibilityTreeSha256 &&
    attestation &&
    authorization &&
    proof.schemaVersion === 1 &&
    proof.method === "frozen-origin-match" &&
    firstViewport.screenshotSha256 === screenshotSha256 &&
    firstViewport.accessibilityTreeSha256 === accessibilityTreeSha256,
  );
}

async function frozenDocumentOriginAttestationIsValid(
  step: Extract<RecipeStep, { kind: "capture-surface" }>,
  origin: NonNullable<Extract<RecipeStep, { kind: "capture-surface" }>["documentOrigin"]>,
  targetProfileId: string,
): Promise<boolean> {
  const proof = objectRecord(step.documentOriginProof);
  const attestation = attestationEvidence(proof?.attestation);
  const authorization = attestationAuthorization(proof?.authorization);
  if (
    !attestation ||
    !authorization ||
    typeof targetProfileId !== "string" ||
    !targetProfileId.trim()
  ) {
    return false;
  }
  const bytes = await readAuthoringEvidence(attestation.sha256);
  if (!bytes || !evidenceBytesMatch(bytes, attestation)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return false;
  }
  const payload = objectRecord(parsed);
  const terminal = objectRecord(payload?.terminal);
  const firstViewport = objectRecord(payload?.firstViewport);
  const terminalViewport = objectRecord(payload?.terminalViewport);
  const terminalCapturedAt = terminalViewport?.capturedAt;
  const terminalWidth = terminalViewport?.width;
  const terminalHeight = terminalViewport?.height;
  const terminalScreenshotSha256 = terminalViewport?.screenshotSha256;
  const terminalAccessibilityTreeSha256 = terminalViewport?.accessibilityTreeSha256;
  if (
    !payload ||
    !terminal ||
    !firstViewport ||
    !terminalViewport ||
    payload.schemaVersion !== 1 ||
    payload.kind !== "relay.document-origin-attestation" ||
    payload.method !== "frozen-origin-match" ||
    payload.targetProfileId !== targetProfileId ||
    payload.surfaceId !== step.surfaceId ||
    payload.capturedAt !== origin.capturedAt ||
    terminal.status !== "completed" ||
    terminal.reason !== "end-of-content" ||
    terminal.restoredStartViewport !== true ||
    firstViewport.index !== 0 ||
    firstViewport.offsetY !== 0 ||
    firstViewport.appendedHeight !== 0 ||
    firstViewport.capturedAt !== origin.capturedAt ||
    firstViewport.width !== origin.width ||
    firstViewport.height !== origin.height ||
    firstViewport.screenshotSha256 !== origin.screenshot.sha256 ||
    firstViewport.accessibilityTreeSha256 !== origin.accessibilityTree.sha256 ||
    typeof terminalCapturedAt !== "number" ||
    !Number.isSafeInteger(terminalCapturedAt) ||
    typeof terminalWidth !== "number" ||
    !Number.isSafeInteger(terminalWidth) ||
    typeof terminalHeight !== "number" ||
    !Number.isSafeInteger(terminalHeight) ||
    terminalWidth <= 0 ||
    terminalHeight <= 0 ||
    typeof terminalScreenshotSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(terminalScreenshotSha256) ||
    typeof terminalAccessibilityTreeSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(terminalAccessibilityTreeSha256)
  ) {
    return false;
  }
  const binding: DocumentOriginAttestationBinding = {
    attestationSha256: attestation.sha256,
    targetProfileId,
    surfaceId: step.surfaceId,
    firstViewport: {
      index: 0,
      offsetY: 0,
      appendedHeight: 0,
      capturedAt: origin.capturedAt,
      width: origin.width,
      height: origin.height,
      screenshotSha256: origin.screenshot.sha256,
      accessibilityTreeSha256: origin.accessibilityTree.sha256,
    },
    terminalViewport: {
      capturedAt: terminalCapturedAt,
      width: terminalWidth,
      height: terminalHeight,
      screenshotSha256: terminalScreenshotSha256,
      accessibilityTreeSha256: terminalAccessibilityTreeSha256,
    },
  };
  return documentOriginAttestationAuthorizationIsValid(binding, authorization);
}

function isFrozenInspectableSnapshot(
  value: unknown,
): value is { nodes: SnapshotNode[]; foregroundApp?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { inspectable?: unknown }).inspectable === true &&
    Array.isArray((value as { nodes?: unknown }).nodes) &&
    (value as { nodes: unknown[] }).nodes.every(isSnapshotNode) &&
    ((value as { foregroundApp?: unknown }).foregroundApp === undefined ||
      typeof (value as { foregroundApp?: unknown }).foregroundApp === "string")
  );
}

/** Rehydrate an immutable, content-addressed first viewport for the one
 * bounded Android restore path. This is intentionally exported for offline
 * contract tests; it never reads a device or changes an App Map. Missing or
 * malformed evidence simply disables the fast path; it never gives the runner
 * a reason to scroll by approximation. */
export async function loadFrozenDocumentOriginForCaptureSurface(
  step: Extract<RecipeStep, { kind: "capture-surface" }>,
  serial: string,
  targetProfileId: string,
): Promise<ValidatedFrozenDocumentOrigin | undefined> {
  const origin = step.documentOrigin;
  // A hand-authored or degraded step must not turn its title/first frame into
  // a permission to fling. The compiler only emits this pair for a trusted,
  // completed baseline; repeat the guard at the execution boundary because
  // recipes can also enter through persisted/manual input.
  if (
    !origin ||
    step.baselineTrust !== "trusted" ||
    !frozenDocumentOriginGeometryIsValid(origin) ||
    !frozenDocumentOriginProofIsValid(step)
  ) {
    return undefined;
  }
  if (!(await frozenDocumentOriginAttestationIsValid(step, origin, targetProfileId))) {
    return undefined;
  }
  const [image, tree] = await Promise.all([
    readAuthoringEvidence(origin.screenshot.sha256),
    readAuthoringEvidence(origin.accessibilityTree.sha256),
  ]);
  if (
    !image ||
    !tree ||
    !evidenceBytesMatch(image, origin.screenshot) ||
    !evidenceBytesMatch(tree, origin.accessibilityTree) ||
    !frozenScreenshotMatchesViewport(image, origin)
  ) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(tree.toString("utf8"));
  } catch {
    return undefined;
  }
  if (!isFrozenInspectableSnapshot(parsed)) return undefined;
  const nodes = parsed.nodes;
  // This is the only production issuer of the in-memory capability: every
  // preceding guard validates the trusted step, proof-to-evidence binding,
  // locally authorized attestation, CAS bytes, decoded PNG geometry, and an
  // inspectable AX document.
  return mintValidatedFrozenDocumentOrigin({
    screenshot: {
      base64: image.toString("base64"),
      width: origin.width,
      height: origin.height,
      capturedAt: origin.capturedAt,
    },
    snapshot: {
      serial,
      capturedAt: origin.capturedAt,
      nodes,
      interactive: nodes.filter((node) => node.hittable === true),
      bounds: { width: origin.width, height: origin.height },
      inspectable: true,
      source: "sdk",
      ...(parsed.foregroundApp?.trim() ? { foregroundApp: parsed.foregroundApp } : {}),
      screenIdentity: observeScreenIdentity(nodes),
    },
  });
}

/** Freeze runtime comparison policy before a capture begins. A compiled
 * trusted baseline is no longer trustworthy when its required frozen-origin
 * evidence cannot be rehydrated; leaving that distinction as a log line
 * allowed a later exact-inverse survey to report a false match. */
export function captureSurfaceBaselineDisposition(
  step: Extract<RecipeStep, { kind: "capture-surface" }>,
  frozenDocumentOrigin: ValidatedFrozenDocumentOrigin | undefined,
): { requiresRecapture: boolean; reason?: string } {
  const frozenOriginUnavailable = step.baselineTrust === "trusted" && !frozenDocumentOrigin;
  if (frozenOriginUnavailable) {
    return {
      requiresRecapture: true,
      reason: step.documentOrigin
        ? "The frozen document-origin evidence is unavailable or invalid, so this comparison must be recaptured and reviewed."
        : "A trusted baseline lacks frozen document-origin evidence, so this comparison must be recaptured and reviewed.",
    };
  }
  return {
    requiresRecapture: step.baselineTrust === "recapture-required",
    ...(step.baselineTrustReason ? { reason: step.baselineTrustReason } : {}),
  };
}

export async function runCaptureSurfaceStep(
  step: Extract<RecipeStep, { kind: "capture-surface" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const job = ctx.job;
  if (!job?.serial || !job.targetProfile) {
    throw new Error("capture-surface requires a frozen device target profile");
  }
  await ensureAndroidSurfaceRuntimeFacts(job);
  const evaluatedAt = now();
  const documentOrigin = await loadFrozenDocumentOriginForCaptureSurface(
    step,
    job.serial,
    job.targetProfile.id,
  );
  const baselineDisposition = captureSurfaceBaselineDisposition(step, documentOrigin);
  const baselineRequiresRecapture = baselineDisposition.requiresRecapture;
  if (step.baselineTrust === "trusted" && !documentOrigin) {
    ctx.log(
      `surface: ${step.screenTitle} · frozen document origin is unavailable or absent; using exact inverse restoration only and requiring recapture review`,
    );
  }
  const cacheIdentity = surfaceComparisonCacheIdentity(job, step);
  const cacheKey = cacheIdentity ? surfaceComparisonCacheKey(cacheIdentity) : undefined;
  if (!step.forceRecapture && !baselineRequiresRecapture && cacheIdentity) {
    const cached = findReusableSurfaceComparison({
      identity: cacheIdentity,
      runs: await listPersistedRuns(200),
      currentArtifacts: job.artifacts,
      currentRunId: job.id,
      at: evaluatedAt,
    });
    if (cached) {
      job.artifacts.push({
        kind: "logical-scroll-surface-result",
        capturedAt: evaluatedAt,
        data: { ...cached.data, cache: cached.provenance },
      });
      ctx.log(
        `surface: ${step.screenTitle} · cache hit from run ${cached.provenance.sourceRunId} · ${cached.data.comparison.matches ? "matches baseline" : "repair proposed"}`,
      );
      return;
    }
  }
  const cache: SurfaceComparisonCacheProvenance = step.forceRecapture
    ? {
        schemaVersion: 1,
        status: "bypassed",
        evaluatedAt,
        reason: "Explicit forceRecapture requested fresh device evidence.",
        ...(cacheKey ? { key: cacheKey } : {}),
        ...(cacheIdentity ? { identity: cacheIdentity } : {}),
      }
    : {
        schemaVersion: 1,
        status: "miss",
        evaluatedAt,
        reason: cacheIdentity
          ? "No completed comparison has the exact immutable cache identity."
          : "Exact target, locale, and app build facts are required for reuse.",
        ...(cacheKey ? { key: cacheKey } : {}),
        ...(cacheIdentity ? { identity: cacheIdentity } : {}),
      };
  if (!step.forceRecapture) {
    const data = surfaceComparisonNeedsRecapture({
      step,
      cache: {
        ...cache,
        status: "miss",
        ...(baselineRequiresRecapture
          ? {
              reason:
                baselineDisposition.reason ??
                "The frozen logical-surface baseline is incomplete and must be recaptured before comparison.",
            }
          : {}),
      },
    });
    job.artifacts.push({
      kind: "logical-scroll-surface-needs-recapture",
      capturedAt: evaluatedAt,
      data,
    });
    ctx.log(
      `surface: ${step.screenTitle} · fresh evidence needed · rerun with forceRecapture for ${step.screenId}`,
    );
    return;
  }
  const verified = currentVerifiedScreen(ctx.runtime);
  const screenshot = verified?.screenId === step.screenId ? verified.screenshot : undefined;
  const nodes = verified?.screenId === step.screenId ? verified.nodes : undefined;
  const bounds = nodes?.reduce(
    (current, node) =>
      node.rect
        ? {
            width: Math.max(current.width, node.rect.x + node.rect.width),
            height: Math.max(current.height, node.rect.y + node.rect.height),
          }
        : current,
    { width: 0, height: 0 },
  );
  const initialCapture =
    screenshot && nodes?.length && screenshot.width && screenshot.height
      ? {
          screenshot,
          snapshot: {
            serial: job.serial,
            capturedAt: screenshot.capturedAt,
            nodes,
            interactive: nodes.filter((node) => node.hittable === true),
            ...(bounds && bounds.width > 0 && bounds.height > 0 ? { bounds } : {}),
            inspectable: true,
            source: "sdk" as const,
            ...(screenshot.foregroundApp ? { foregroundApp: screenshot.foregroundApp } : {}),
            screenIdentity: observeScreenIdentity(nodes),
          },
        }
      : undefined;
  const survey = await captureScrollableSurveyForTarget({
    serial: job.serial,
    ...(step.maxScrolls === undefined ? {} : { maxScrolls: step.maxScrolls }),
    ...(initialCapture ? { initialCapture } : {}),
    ...(documentOrigin
      ? {
          frozenDocumentOrigin: documentOrigin,
        }
      : {}),
  });
  const surface = await persistLogicalScrollSurface({
    survey,
    targetProfile: job.targetProfile,
    surfaceId: step.surfaceId,
    capturePolicy: {
      captureMode: "full-surface",
      source: "explicit",
      reason: step.reason,
      decidedAt: survey.frames[0]?.screenshot.capturedAt ?? now(),
    },
  });
  const baseline = step.baseline;
  const heightRatio =
    baseline?.compositeHeight && surface.composite
      ? surface.composite.height / baseline.compositeHeight
      : undefined;
  const semanticRatio = baseline?.semanticNodeCount
    ? surface.mergedTree.nodeCount / baseline.semanticNodeCount
    : undefined;
  const visualMatches =
    !baselineRequiresRecapture &&
    surface.status === "completed" &&
    Boolean(surface.composite) &&
    (baseline?.compositeWidth === undefined ||
      surface.composite?.width === baseline.compositeWidth) &&
    (heightRatio === undefined || (heightRatio >= 0.7 && heightRatio <= 1.3));
  const semanticMatches =
    !baselineRequiresRecapture &&
    (semanticRatio === undefined || (semanticRatio >= 0.65 && semanticRatio <= 1.35));
  const matches = visualMatches && semanticMatches;
  job.artifacts.push({
    kind: "logical-scroll-surface-result",
    capturedAt: surface.capturedAt,
    data: {
      schemaVersion: 1,
      screenId: step.screenId,
      screenTitle: step.screenTitle,
      variantId: step.variantId,
      surfaceId: step.surfaceId,
      baselineCaptureId: step.baselineCaptureId,
      capture: surface,
      comparison: {
        policy: baselineRequiresRecapture ? "recapture-required" : "visual-and-semantic",
        matches,
        visualMatches,
        semanticMatches,
        ...(heightRatio === undefined ? {} : { heightRatio }),
        ...(semanticRatio === undefined ? {} : { semanticRatio }),
      },
      repair: !survey.restoredStartViewport
        ? {
            status: "proposed",
            action: "review-viewport-restore",
            reason: survey.message,
            coverageContinues: true,
          }
        : matches
          ? { status: "not-needed" }
          : {
              status: "proposed",
              action: "propose-recapture",
              reason: baselineRequiresRecapture
                ? (baselineDisposition.reason ??
                  "The frozen logical-surface baseline is incomplete and needs review.")
                : surface.status === "completed"
                  ? "Logical surface differs materially from its frozen baseline."
                  : surface.message,
            },
      cache,
    },
  });
  if (!survey.restoredStartViewport) {
    // Inverse-swipe proof is recorded on the surface artifact. Emitting SOS
    // here looked like a campaign stop and unproved every later Settings child.
    ctx.log(
      `surface: ${step.screenTitle} · restore not proven — ${survey.message} Coverage continues from the current viewport.`,
    );
  } else if (survey.reason === "start-viewport-unproven") {
    ctx.log(
      `surface: ${step.screenTitle} · frozen origin did not match · exact inverse restoration was proven; captured segment needs review before it can become a baseline.`,
    );
  }
  ctx.log(
    `surface: ${step.screenTitle} · ${surface.viewports.length} viewport(s) · ${matches ? "matches baseline" : "repair proposed"}`,
  );
}
