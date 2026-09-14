import { InputNotDispatchedError, InputOutcomeUnknownError } from "./input-not-dispatched.js";
import type { Device } from "./device.js";
import { createHash } from "node:crypto";
import { resolveStepPoint, type StepPoint } from "@relay/protocol";
import {
  pressIdentifier,
  pressRef,
  pressLabel,
  pressMatchingText,
  findClick,
  pressPoint,
  pressText,
  pressResolvedControl,
  androidNamedPressCompletedHandoff,
  resolveSnapshotTargetPoint,
  selectedPlatform,
  sleep,
  scrollUp,
  base,
  longPressTarget,
  snapshot,
  type SnapshotNode,
} from "./device.js";
import { resolveNamedControlOutcome } from "./device-target-resolution.js";
import { cooperativeCheckpoint, raceCancel, throwIfCancelled } from "./control.js";
import { TargetControlReservedError } from "./target-control.js";
import { now } from "./events.js";
import { describeTarget, type RecipeStep, type StepTarget } from "./recipes.js";
import {
  handoffShellIdentityMatch,
  resilientScreenIdentityMatch,
} from "./recipe-runner-screen-identity.js";
import {
  nodeMatchesTarget,
  refMatchesRecordedTarget,
  resolveElementRelativePoint,
} from "./recipe-target-match.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { currentVerifiedScreen } from "./recipe-runner-context.js";
import { rethrowIosMutationOutcomeUnknown } from "./ios-mutation-policy.js";
import { iosSnapshotInputEpoch } from "./ios-snapshot-flight.js";
import { currentTargetContext } from "./target-context.js";
import { getRecipeAndroidLocalization } from "./recipe-localization.js";
import { resolveLocalizedRecipeTarget } from "./recipe-localized-target.js";

function snapshotBounds(nodes: SnapshotNode[]): { width: number; height: number } | undefined {
  let width = 0;
  let height = 0;
  for (const node of nodes) {
    if (!node.rect) continue;
    width = Math.max(width, node.rect.x + node.rect.width);
    height = Math.max(height, node.rect.y + node.rect.height);
  }
  return width > 0 && height > 0
    ? { width: Math.round(width), height: Math.round(height) }
    : undefined;
}

type RuntimeBoundsCacheEntry = {
  inputEpoch: number;
  pending: Promise<{ width: number; height: number } | undefined>;
};

/**
 * Keyed by (Device, confirmed iOS input epoch). A rotation, tap, or any other
 * acknowledged mutation advances the fence in ios-snapshot-flight.ts, so the
 * next resolution re-reads bounds instead of replaying pre-mutation extents.
 * Manual rotations and device handoffs therefore cannot serve stale bounds.
 */
const runtimeBoundsCache = new WeakMap<Device, RuntimeBoundsCacheEntry>();

function runtimeBounds(device: Device): Promise<{ width: number; height: number } | undefined> {
  let serial = "";
  try {
    const context = currentTargetContext();
    if (context.kind === "device") serial = context.serial;
  } catch {
    serial = "";
  }
  const inputEpoch = iosSnapshotInputEpoch(serial);
  const cached = runtimeBoundsCache.get(device);
  if (cached && cached.inputEpoch === inputEpoch) return cached.pending;
  const pending = snapshot(device)
    .then(snapshotBounds)
    .catch(() => undefined);
  runtimeBoundsCache.set(device, { inputEpoch, pending });
  return pending;
}

async function resolvePointForDevice(
  device: Device,
  point: StepPoint,
  mirrorX = false,
): Promise<{ x: number; y: number }> {
  if (point.relativeTo) {
    const resolved = resolveElementRelativePoint(await snapshot(device), point.relativeTo);
    return { x: resolved.x, y: resolved.y };
  }
  const bounds = await runtimeBounds(device);
  const logicalPoint =
    point.anchor && point.referenceBounds
      ? resolveStepPoint(point, bounds ?? point.referenceBounds)
      : { x: point.x, y: point.y };
  // agent-device's XCTest runner accepts logical application coordinates even
  // when raw snapshot children arrive in a portrait-native buffer.
  return mirrorX && bounds
    ? { x: Math.max(0, bounds.width - logicalPoint.x), y: logicalPoint.y }
    : logicalPoint;
}

export function isRightToLeftRun(variables?: Record<string, string>): boolean {
  const locale = (variables?.language ?? variables?.locale ?? "").trim().toLowerCase();
  return /^(?:ar|fa|he|iw|ps|ur)(?:-|$)/.test(locale);
}

function readInput(ctx: RecipeStepContext, input: string): string {
  const variables = ctx.job?.resolvedInputs ?? ctx.variables;
  if (!variables) throw new Error("extract: conversational steps require an execution context");
  const key = input.replace(/^\{\{\s*|\s*\}\}$/g, "");
  if (!Object.hasOwn(variables, key)) {
    throw new Error(`extract: input variable is missing (${key})`);
  }
  return variables[key]!;
}

function runVariableScript(source: string, ctx: RecipeStepContext): void {
  const values = ctx.job?.resolvedInputs;
  if (!values) throw new Error("script: variable transforms require an owning job");
  for (const [index, raw] of source.split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const set = line.match(/^set\s+([a-zA-Z0-9_.-]+)\s*=\s*(.*)$/);
    if (set) {
      values[set[1]!] = set[2]!;
      continue;
    }
    const copy = line.match(/^copy\s+([a-zA-Z0-9_.-]+)\s*=\s*([a-zA-Z0-9_.-]+)$/);
    if (copy) {
      if (!Object.hasOwn(values, copy[2]!))
        throw new Error(`script line ${index + 1}: source variable ${copy[2]} is missing`);
      values[copy[1]!] = values[copy[2]!]!;
      continue;
    }
    const remove = line.match(/^delete\s+([a-zA-Z0-9_.-]+)$/);
    if (remove) {
      delete values[remove[1]!];
      continue;
    }
    const assertion = line.match(
      /^assert\s+([a-zA-Z0-9_.-]+)\s+(exists|equals|contains)(?:\s+(.*))?$/,
    );
    if (assertion) {
      const actual = values[assertion[1]!];
      const operator = assertion[2];
      const expected = assertion[3] ?? "";
      const passed =
        operator === "exists"
          ? actual !== undefined && actual.length > 0
          : operator === "equals"
            ? actual === expected
            : actual?.includes(expected) === true;
      if (!passed) throw new Error(`script line ${index + 1}: assertion failed`);
      continue;
    }
    throw new Error(
      `script line ${index + 1}: use set, copy, delete, or assert (arbitrary code is not allowed)`,
    );
  }
}

/** Resolve {{name}} placeholders immediately before execution. Unresolved
 * placeholders stay visible so a bad configuration fails transparently. */
export function resolveRecipeStep(step: RecipeStep, variables: Record<string, string>): RecipeStep {
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (whole, name: string) =>
        Object.hasOwn(variables, name) ? variables[name]! : whole,
      );
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    }
    return value;
  };
  const resolved = visit(step) as RecipeStep;
  // Branch input names are references, not display strings. Replacing
  // `{{language_identifier}}` here turns the reference into its value (`-`),
  // then the executor incorrectly looks up a variable literally named `-`.
  // Preserve the reference while still resolving expected values and every
  // other field in the step.
  return step.kind === "branch" && resolved.kind === "branch"
    ? { ...resolved, input: step.input }
    : resolved;
}

function isCancel(err: unknown): boolean {
  return err instanceof Error && err.name === "JobCancelledError";
}

/**
 * Try each present target strategy in robustness order; log + continue on
 * failure, rethrow cancel immediately, throw when none succeed.
 */
async function tapTarget(
  device: Device,
  target: StepTarget,
  log: (line: string) => void,
  repetitions = 1,
  intervalMs = 90,
  region?: NonNullable<RecipeStep["when"]>["region"],
  mirrorPoints = false,
  expectedApp?: string,
  verifiedNodes?: SnapshotNode[],
  context?: RecipeStepContext,
): Promise<{
  strategy: string;
  method?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  point?: { x: number; y: number };
  localizedTarget?: { label?: string; text?: string; locale: string };
}> {
  const repeated =
    repetitions > 1
      ? {
          count: repetitions,
          intervalMs,
          // XCTest's native doubleTap is observably different from two
          // independent taps for text selection and zoom gestures.
          ...(repetitions === 2 ? { doubleTap: true } : {}),
        }
      : undefined;
  const literalPoint =
    target.point && !target.point.relativeTo
      ? await resolvePointForDevice(device, target.point, mirrorPoints)
      : undefined;
  const hasSemanticTarget = Boolean(
    target.identifier || target.label || target.text || target.relation,
  );
  const allowNamedPointFallback =
    selectedPlatform() !== "android" ||
    !hasSemanticTarget ||
    target.point?.fallbackPolicy === "reviewed";
  let namedTarget = {
    ...(target.identifier ? { identifier: target.identifier } : {}),
    ...(target.label ? { label: target.label } : {}),
    ...(target.role ? { role: target.role } : {}),
    ...(target.text ? { text: target.text } : {}),
    ...(target.relation ? { relation: target.relation } : {}),
    ...(literalPoint && allowNamedPointFallback ? { point: literalPoint } : {}),
    ...(expectedApp ? { expectedApp } : {}),
  };
  // An immediately preceding expect-screen already paid for and verified this
  // exact tree. Reuse it until the first mutation; fallback strategies still
  // take a fresh snapshot when the cached tree cannot resolve the target.
  const readBeforeTap = async () => {
    try {
      return await snapshot(device);
    } catch (error) {
      if (isCancel(error)) throw error;
      throw new InputNotDispatchedError(
        "Relay could not inspect the target before tapping. Reconnect the device, then try again.",
        { cause: error },
      );
    }
  };
  let nodes = verifiedNodes?.length ? verifiedNodes : await readBeforeTap();
  let namedOutcome = resolveNamedControlOutcome(nodes, namedTarget);
  let localizedTarget: { label?: string; text?: string; locale: string } | undefined;
  let localizedPackage: string | undefined;
  if (namedOutcome.status === "absent" && selectedPlatform() === "android" && context) {
    const localization = await getRecipeAndroidLocalization(context, nodes);
    const localized =
      localization && resolveLocalizedRecipeTarget(nodes, namedTarget, localization);
    if (localized) {
      localizedPackage = localization.packageName;
      namedTarget = localized.target;
      namedOutcome = localized.outcome;
      localizedTarget = {
        ...(localized.target.label ? { label: localized.target.label } : {}),
        ...(localized.target.text ? { text: localized.target.text } : {}),
        locale: localization.locale,
      };
      log(
        `locator: ${target.label ?? target.text} → ${localized.target.label ?? localized.target.text} (${localization.locale})`,
      );
    }
  }
  let named = namedOutcome.status === "resolved" ? namedOutcome.resolution : undefined;
  if (
    !named &&
    selectedPlatform() === "android" &&
    (target.identifier || target.label || target.text || target.relation)
  ) {
    // Compose can publish the destination shell before its actionable rows.
    // Wait for a few fresh accessibility generations; never convert absence
    // into an unreviewed coordinate tap.
    for (let attempt = 0; attempt < 5 && !named; attempt += 1) {
      await cooperativeCheckpoint();
      await sleep(250, device);
      nodes = await readBeforeTap();
      namedOutcome = resolveNamedControlOutcome(
        localizedPackage ? nodes.filter((node) => node.bundleId === localizedPackage) : nodes,
        namedTarget,
      );
      named = namedOutcome.status === "resolved" ? namedOutcome.resolution : undefined;
    }
  }
  if (named) {
    try {
      if (verifiedNodes && selectedPlatform() === "android") {
        await pressPoint(device, named.point.x, named.point.y, repeated);
      } else {
        await pressResolvedControl(device, named, namedTarget, repeated);
      }
    } catch (error) {
      // A semantic control may intentionally open a system surface (for
      // example Grok's App Language row opens Android Settings). Keep the
      // recipe executor aligned with pressNamedControl: accept that completed
      // handoff, but continue rejecting raw-point and launcher escapes.
      if (!androidNamedPressCompletedHandoff(error, namedTarget)) throw error;
    }
    return {
      strategy: named.method,
      method: named.method,
      bounds: named.bounds,
      point: named.point,
      ...(localizedTarget ? { localizedTarget } : {}),
    };
  }
  if (
    selectedPlatform() === "android" &&
    nodes.length > 0 &&
    (target.identifier || target.label || target.text || target.relation)
  ) {
    const failure =
      namedOutcome.status === "resolved"
        ? { status: "absent", detail: "semantic resolution became stale" }
        : namedOutcome;
    const classification =
      failure.status === "absent"
        ? "absent from current Android accessibility tree"
        : `${failure.status} in current Android accessibility tree`;
    throw new Error(
      `named target ${classification}: ${failure.detail} (${describeTarget(target)})`,
    );
  }
  const attempts: { strategy: string; run: () => Promise<void> }[] = [];
  let attemptedPoint: { x: number; y: number } | undefined;
  if (target.identifier)
    attempts.push({
      strategy: "identifier",
      run: () => pressIdentifier(device, target.identifier!, repeated),
    });
  if (target.ref)
    attempts.push({
      strategy: "ref",
      run: async () => {
        if (
          selectedPlatform() === "ios" &&
          (target.identifier || target.label) &&
          !refMatchesRecordedTarget(await snapshot(device), target)
        ) {
          throw new Error("recorded element reference now identifies a different control");
        }
        await pressRef(device, target.ref!, repeated);
      },
    });
  if (target.label)
    attempts.push({ strategy: "label", run: () => pressLabel(device, target.label!, repeated) });
  if (target.label)
    attempts.push({
      strategy: "snapshot-label",
      run: () => pressMatchingText(device, target.label!),
    });
  if (target.label && region && selectedPlatform() === "ios") {
    attempts.push({
      strategy: "snapshot-region",
      run: async () => {
        const point = resolveSnapshotTargetPoint(await snapshot(device), target, region);
        if (!point) throw new Error("regional snapshot target was absent or ambiguous");
        await pressPoint(device, point.x, point.y, repeated);
      },
    });
  }
  if (target.text)
    attempts.push({
      strategy: "text",
      run: () =>
        repeated ? pressText(device, target.text!, repeated) : findClick(device, target.text!),
    });
  if (target.point) {
    attempts.push({
      strategy: target.point.relativeTo ? "element-relative-point" : "point",
      run: async () => {
        const point = await resolvePointForDevice(device, target.point!, mirrorPoints);
        attemptedPoint = point;
        await pressPoint(device, point.x, point.y, repeated);
      },
    });
  }
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i]!;
    try {
      await a.run();
      return {
        strategy: a.strategy,
        method: a.strategy,
        ...(attemptedPoint ? { point: attemptedPoint } : {}),
      };
    } catch (err) {
      if (err instanceof InputOutcomeUnknownError) {
        throw new InputOutcomeUnknownError(
          `tap failed: ${describeTarget(target)}: ${err.message}`,
          { cause: err },
        );
      }
      rethrowIosMutationOutcomeUnknown(err);
      if (isCancel(err)) throw err;
      // Losing the device lane is not a locator problem. Folding it into
      // "no strategy matched" sends the reader hunting for a selector that
      // was never consulted.
      if (err instanceof TargetControlReservedError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (i === attempts.length - 1) {
        const reason =
          target.point?.relativeTo && msg.startsWith("element-relative")
            ? msg
            : "no strategy matched";
        // Carry the last attempt's reason. "No strategy matched" on its own
        // sends the reader looking for a selector problem even when the
        // strategy never got as far as the tree.
        throw new Error(
          reason === msg
            ? `tap failed: ${reason} (${describeTarget(target)})`
            : `tap failed: ${reason} (${describeTarget(target)}); ${a.strategy}: ${msg}`,
        );
      }
      log(`tap: ${a.strategy} failed (${msg}) — trying next`);
    }
  }
  throw new Error(`tap failed: target has no usable strategy (${describeTarget(target)})`);
}

async function tapRecordedTarget(
  device: Device,
  input: {
    target: StepTarget;
    fallbackTargets?: StepTarget[];
    expectedApp?: string;
    navigationContract?: Extract<RecipeStep, { kind: "tap" }>["navigationContract"];
    evidence?: Extract<RecipeStep, { kind: "tap" | "type" }>["evidence"];
    region?: NonNullable<RecipeStep["when"]>["region"];
  },
  ctx: RecipeStepContext,
  repetitions = 1,
  intervalMs = 90,
): Promise<void> {
  const verifiedNodes = currentVerifiedScreen(ctx.runtime)?.nodes;
  const beforeFramePath =
    ctx.runtime?.observation?.screenshot?.framePath ??
    currentVerifiedScreen(ctx.runtime)?.screenshot?.framePath;
  const candidates = [
    input.target,
    ...(input.fallbackTargets ?? []),
    ...(input.evidence?.candidates?.map((candidate) => candidate.target) ?? []),
  ];
  const unique = candidates.filter(
    (candidate, index) =>
      candidates.findIndex((other) => JSON.stringify(other) === JSON.stringify(candidate)) ===
      index,
  );
  const configuredTargetCount = 1 + (input.fallbackTargets?.length ?? 0);
  const failures: Array<{ target: StepTarget; error: string }> = [];
  for (const [index, candidate] of unique.entries()) {
    try {
      const hit = await tapTarget(
        device,
        candidate,
        ctx.log,
        repetitions,
        intervalMs,
        input.region,
        isRightToLeftRun(ctx.job?.resolvedInputs ?? ctx.variables),
        input.expectedApp,
        verifiedNodes,
        ctx,
      );
      const resolution = {
        kind: "target-resolution" as const,
        capturedAt: now(),
        data: {
          method: hit.method ?? hit.strategy,
          strategy: hit.strategy,
          ...(hit.bounds ? { bounds: hit.bounds } : {}),
          ...(hit.point ? { point: hit.point } : {}),
          ...(beforeFramePath ? { beforeFramePath } : {}),
          target: candidate,
          ...(hit.localizedTarget ? { localizedTarget: hit.localizedTarget } : {}),
        },
      };
      ctx.job?.artifacts.push(resolution);
      ctx.artifacts?.push(resolution);
      if (index > 0) {
        const configuredFallback = index < configuredTargetCount;
        ctx.job?.artifacts.push({
          kind: configuredFallback ? "locator-fallback" : "locator-heal",
          capturedAt: now(),
          data: {
            original: input.target,
            replacement: candidate,
            strategy: hit.strategy,
            reason: failures.map((failure) => failure.error).join("; "),
            persisted: false,
          },
        });
        if (input.navigationContract) {
          ctx.job?.artifacts.push({
            kind: "navigation-repair-proposal",
            capturedAt: now(),
            data: {
              status: "pending-review",
              connectionId: input.navigationContract.connectionId,
              beforeSelector: input.target,
              currentSelector: candidate,
              currentResolution: {
                strategy: hit.strategy,
                ...(hit.bounds ? { bounds: hit.bounds } : {}),
                ...(hit.point ? { point: hit.point } : {}),
              },
              attempts: structuredClone(failures),
              expectedDestination: {
                screenId: input.navigationContract.expectedScreenId,
                fingerprint: input.navigationContract.expectedFingerprint,
                evidenceIds: [...input.navigationContract.evidenceIds],
              },
              persisted: false,
            },
          });
        }
        ctx.log(
          `locator: used ${configuredFallback ? "configured" : "recorded"} fallback ${index + 1}/${unique.length} (${hit.strategy})`,
        );
      }
      return;
    } catch (error) {
      rethrowIosMutationOutcomeUnknown(error);
      if (error instanceof InputOutcomeUnknownError) throw error;
      if (isCancel(error)) throw error;
      // A later candidate cannot erase an earlier attempt's uncertain outcome.
      if (index === 0 && error instanceof InputNotDispatchedError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ target: structuredClone(candidate), error: message });
      const attempt = {
        kind: "target-resolution-attempt" as const,
        capturedAt: now(),
        data: {
          status: "failed",
          target: candidate,
          error: message,
        },
      };
      ctx.job?.artifacts.push(attempt);
      ctx.artifacts?.push(attempt);
    }
  }
  throw new Error(`tap failed: ${failures.at(-1)?.error ?? "no locator candidate matched"}`);
}

async function longPressRecordedTarget(
  device: Device,
  input: {
    target: StepTarget;
    fallbackTargets?: StepTarget[];
    evidence?: Extract<RecipeStep, { kind: "tap" }>["evidence"];
    durationMs?: number;
  },
  ctx: RecipeStepContext,
): Promise<void> {
  const candidates = [
    input.target,
    ...(input.fallbackTargets ?? []),
    ...(input.evidence?.candidates?.map((candidate) => candidate.target) ?? []),
  ];
  const attempts = candidates.flatMap((target) => [
    ...(target.identifier
      ? [
          {
            key: `identifier:${target.identifier}`,
            run: () => longPressTarget(device, { identifier: target.identifier }, input.durationMs),
          },
        ]
      : []),
    ...(target.ref
      ? [
          {
            key: `ref:${target.ref}`,
            run: () => longPressTarget(device, { ref: target.ref }, input.durationMs),
          },
        ]
      : []),
    ...(target.label
      ? [
          {
            key: `label:${target.label}`,
            run: () => longPressTarget(device, { label: target.label }, input.durationMs),
          },
        ]
      : []),
    ...(target.text
      ? [
          {
            key: `text:${target.text}`,
            run: () => longPressTarget(device, { text: target.text }, input.durationMs),
          },
        ]
      : []),
    ...(target.point
      ? [
          {
            key: `point:${JSON.stringify(target.point)}`,
            run: async () => {
              const point = await resolvePointForDevice(
                device,
                target.point!,
                isRightToLeftRun(ctx.job?.resolvedInputs ?? ctx.variables),
              );
              await longPressTarget(device, { point }, input.durationMs);
            },
          },
        ]
      : []),
  ]);
  const unique = attempts.filter(
    (candidate, index) => attempts.findIndex((other) => other.key === candidate.key) === index,
  );
  const failures: string[] = [];
  for (const [index, candidate] of unique.entries()) {
    try {
      await candidate.run();
      if (index > 0) ctx.log(`locator: used recorded hold fallback ${index + 1}/${unique.length}`);
      return;
    } catch (error) {
      rethrowIosMutationOutcomeUnknown(error);
      if (isCancel(error)) throw error;
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`hold failed: ${failures.at(-1) ?? "no locator candidate matched"}`);
}

const MAX_WAIT_MS = 15 * 60 * 1000;
const DEFAULT_EXPECT_TIMEOUT_MS = 5000;

/**
 * True when the error signals a genuine "element not there / condition unmet"
 * outcome — the SDK's find throws "No match", the wait command and our own
 * poll loops throw timeout-phrased errors. Anything else (no device, adb,
 * session binding, connection failures) is infrastructure and must keep its
 * original message instead of being converted into an assertion failure.
 */
function isNotFoundOrTimeout(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\bno match\b|did not match|not found|timed out|timeout/i.test(msg);
}

/**
 * True if the target's identifier/ref/label/text strategy currently resolves. Unlike the
 * `exists` helper (which swallows every non-cancel error as `false`),
 * infrastructure failures propagate with their original message — only a
 * genuine "No match" reads as absent, so `expect ... gone` cannot pass just
 * because the device went away.
 */
async function targetPresent(device: Device, target: StepTarget): Promise<boolean> {
  const query = target.identifier
    ? `id="${target.identifier.replaceAll('"', '\\"')}"`
    : target.ref
      ? target.ref.startsWith("@")
        ? target.ref
        : `@${target.ref}`
      : (target.label ?? target.text);
  if (!query) return false;
  try {
    await cooperativeCheckpoint();
    throwIfCancelled();
    await raceCancel(device.interactions.find({ ...base(), query, action: "exists", first: true }));
    return true;
  } catch (err) {
    if (isCancel(err)) throw err;
    if (isNotFoundOrTimeout(err)) {
      // SDK presence probes are interaction-oriented and can legitimately omit
      // visible, non-hittable content such as browser headings and paragraphs.
      // The canonical snapshot is the read-only authority for assertions, so a
      // genuine interaction miss gets one semantic-tree lookup before Relay
      // declares the target absent. Snapshot/infrastructure errors still
      // propagate instead of turning a disconnected target into a passing
      // `gone` assertion.
      const nodes = await snapshot(device);
      return nodes.some((node) => nodeMatchesTarget(node, target));
    }
    throw err;
  }
}

async function conditionalTargetPresent(
  device: Device,
  condition: NonNullable<RecipeStep["when"]>,
): Promise<boolean> {
  if (!condition.region) return targetPresent(device, condition.target);
  const nodes = await snapshot(device);
  const viewport =
    nodes.find((node) => (node.type ?? node.role)?.toLowerCase() === "application")?.rect ??
    nodes.find((node) => (node.type ?? node.role)?.toLowerCase() === "window")?.rect;
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
    throw new Error("conditional target: viewport bounds are unavailable");
  }
  const region = condition.region;
  return nodes.some((node) => {
    if (!nodeMatchesTarget(node, condition.target) || !node.rect) return false;
    const x = (node.rect.x + node.rect.width / 2 - viewport.x) / viewport.width;
    const y = (node.rect.y + node.rect.height / 2 - viewport.y) / viewport.height;
    return (
      (region.minX === undefined || x >= region.minX) &&
      (region.maxX === undefined || x <= region.maxX) &&
      (region.minY === undefined || y >= region.minY) &&
      (region.maxY === undefined || y <= region.maxY)
    );
  });
}

function clipboardExpectationError(
  observed: string,
  expected: string,
  match: "exact" | "contains" | undefined,
): Error {
  const observedDigest = createHash("sha256").update(observed).digest("hex").slice(0, 12);
  const expectedDigest = createHash("sha256").update(expected).digest("hex").slice(0, 12);
  return new Error(
    `clipboard: ${match === "contains" ? "content" : "value"} did not match expectation ` +
      `(observed ${observed.length} chars, sha256:${observedDigest}; ` +
      `expected ${expected.length} chars, sha256:${expectedDigest})`,
  );
}

export {
  DEFAULT_EXPECT_TIMEOUT_MS,
  MAX_WAIT_MS,
  clipboardExpectationError,
  conditionalTargetPresent,
  isCancel,
  isNotFoundOrTimeout,
  resilientScreenIdentityMatch,
  handoffShellIdentityMatch,
  longPressRecordedTarget,
  readInput,
  resolvePointForDevice,
  runVariableScript,
  scrollUp,
  tapRecordedTarget,
  targetPresent,
};
