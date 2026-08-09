/**
 * Recipe step executor — thin glue over the device.ts helpers.
 *
 * One function, one switch per step kind. Cancel propagates as
 * JobCancelledError (rethrown, not swallowed by strategy fallbacks or retries).
 * The pause step drives the same cooperative pause/resume mechanics the job
 * engine uses: it sets job.status="paused" so `POST /jobs/:id/resume`
 * (resumeJob) unblocks the checkpoint.
 */
import type { Device } from "./device.js";
import { createHash } from "node:crypto";
import { describeSnapshotChrome, resolveStepPoint, type StepPoint } from "@relay/protocol";
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
  resolveNamedControl,
  resolveSnapshotTargetPoint,
  selectedPlatform,
  replaceText,
  typeText,
  pressKey,
  scrollDown,
  sleep,
  swipeGesture,
  waitFor,
  base,
  longPressTarget,
  clipboardWrite,
  clipboardRead,
  clipboardPaste,
  clipboardCopy,
  changeAndroidAppBuild,
  closeApp,
  inspectAndroidApp,
  openApp,
  openUrl,
  openAppSwitcher,
  rotateDevice,
  keyboardAction,
  alertAction,
  updateSetting,
  captureNetwork,
  manageLogs,
  setAndroidLockState,
  snapshot,
  type SnapshotNode,
} from "./device.js";
import {
  cooperativeCheckpointWithTimeout,
  cooperativeCheckpoint,
  raceCancel,
  throwIfCancelled,
  requestPause,
  requestResume,
} from "./control.js";
import { publish, now } from "./events.js";
import { runAction, isActionId } from "./actions.js";
import { captureScreenshot } from "./workspace.js";
import {
  describeTarget,
  readRecipe,
  type Recipe,
  type RecipeStep,
  type StepTarget,
} from "./recipes.js";
import type { TestJob } from "./session.js";
import { evaluateSemantic } from "./evaluation.js";
import {
  compareScreenIdentity,
  observeScreenIdentity,
  observeVisualScreenFingerprint,
} from "./screen-identity.js";
import {
  nodeText,
  nodeMatchesTarget,
  refMatchesRecordedTarget,
  screenIdentityMatches,
  textForTarget,
  sameTarget,
  labelsForIdentifierPrefix,
  labelsForScope,
} from "./recipe-target-match.js";
import { runTourStep } from "./recipe-runner-tour.js";
export { refMatchesRecordedTarget, screenIdentityMatches } from "./recipe-target-match.js";

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

const runtimeBoundsCache = new WeakMap<
  Device,
  Promise<{ width: number; height: number } | undefined>
>();

function runtimeBounds(device: Device): Promise<{ width: number; height: number } | undefined> {
  const cached = runtimeBoundsCache.get(device);
  if (cached) return cached;
  const pending = snapshot(device)
    .then(snapshotBounds)
    .catch(() => undefined);
  runtimeBoundsCache.set(device, pending);
  return pending;
}

async function resolvePointForDevice(
  device: Device,
  point: StepPoint,
): Promise<{ x: number; y: number }> {
  const logicalPoint =
    point.anchor && point.referenceBounds
      ? resolveStepPoint(point, (await runtimeBounds(device)) ?? point.referenceBounds)
      : { x: point.x, y: point.y };
  // agent-device's XCTest runner accepts logical application coordinates even
  // when raw snapshot children arrive in a portrait-native buffer.
  return logicalPoint;
}

async function waitForResponseCompletion(
  device: Device,
  step: Extract<RecipeStep, { kind: "wait-response" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const timeoutMs = Math.min(step.timeoutMs ?? 90_000, MAX_WAIT_MS);
  const stableForMs = step.stableForMs ?? 2_000;
  const pollMs = 250;
  const beganAt = now();
  const deadline = beganAt + timeoutMs;
  const initialNodes = await snapshot(device);
  const initialText = textForTarget(initialNodes, step.target);
  let previousText = initialText;
  const initiallyIdle = step.idleTarget
    ? initialNodes.some((node) => nodeMatchesTarget(node, step.idleTarget!))
    : false;
  const completionTargetIsIdle = Boolean(
    step.idleTarget && sameTarget(step.target, step.idleTarget),
  );
  let sawIdleLeave = !initiallyIdle;
  // Physical-device snapshots can be slower than a short model response. If
  // the first post-action sample already contains content and the independent
  // idle signal, the response completed before Relay could observe it growing.
  // Treat that as a started response instead of waiting for an impossible
  // second content transition. A target that is also the idle signal is not
  // independent, though: it may be left over from the previous response. In
  // that case require the control to leave and return so an old response can
  // never satisfy a new wait immediately.
  let startedAt: number | undefined =
    initialText && initiallyIdle && !completionTargetIsIdle ? beganAt : undefined;
  let stableSince: number | undefined = startedAt;
  let samples = 1;
  let lastSignals: string[] = startedAt ? ["response-started", "idle-visible"] : [];

  if (startedAt) {
    ctx.log(`response completion: content already complete (${initialText.length} characters)`);
  }

  const record = (status: "complete" | "timeout", completedAt: number, text: string) => {
    ctx.job?.artifacts.push({
      kind: "response-completion",
      capturedAt: completedAt,
      data: {
        status,
        beganAt,
        startedAt,
        completedAt,
        durationMs: completedAt - beganAt,
        stableForMs,
        timeoutMs,
        samples,
        signals: lastSignals,
        observedCharacters: text.length,
        usedBusyTarget: Boolean(step.busyTarget),
        usedIdleTarget: Boolean(step.idleTarget),
      },
    });
  };

  while (now() < deadline) {
    await sleep(pollMs, device);
    const capturedAt = now();
    const nodes = await snapshot(device);
    samples += 1;
    const text = textForTarget(nodes, step.target);
    const changedFromInitial = text.length > 0 && text !== initialText;
    const idleVisible = step.idleTarget
      ? nodes.some((node) => nodeMatchesTarget(node, step.idleTarget!))
      : false;
    if (step.idleTarget && !idleVisible) sawIdleLeave = true;

    if (
      !startedAt &&
      (changedFromInitial ||
        (!initialText && text.length > 0) ||
        (completionTargetIsIdle && sawIdleLeave && idleVisible && text.length > 0))
    ) {
      startedAt = capturedAt;
      stableSince = capturedAt;
      ctx.log(`response completion: content started (${text.length} characters)`);
    }
    if (startedAt) {
      if (text !== previousText) stableSince = capturedAt;
      const stable = Boolean(text && stableSince && capturedAt - stableSince >= stableForMs);
      const busyGone = step.busyTarget
        ? !nodes.some((node) => nodeMatchesTarget(node, step.busyTarget!))
        : false;
      lastSignals = [
        "response-started",
        ...(stable ? ["text-stable"] : []),
        ...(busyGone ? ["busy-gone"] : []),
        ...(idleVisible ? ["idle-visible"] : []),
      ];
      const hasIndependentCompletionTarget = Boolean(step.busyTarget || step.idleTarget);
      if (stable && (!hasIndependentCompletionTarget || busyGone || idleVisible)) {
        record("complete", capturedAt, text);
        ctx.log(`response completion: complete · ${lastSignals.join(" + ")}`);
        return;
      }
    }
    previousText = text;
  }

  record("timeout", now(), previousText);
  throw new Error(
    `response completion: timed out after ${Math.round(timeoutMs / 1000)}s (${lastSignals.join(" + ") || "no response observed"})`,
  );
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

export type RecipeStepContext = {
  log: (line: string) => void;
  /**
   * Owning job. Required for `pause` steps (drives job.status + resume
   * checkpoint) and used to attach `screenshot` frames to a run. Standalone
   * single-step execution (no job, e.g. server's POST /step/run) omits it —
   * `pause` throws in that case (rejected upstream) and `screenshot` simply
   * captures without attaching to a job.
   */
  job?: TestJob;
  /** Ephemeral values and evidence for authoring replay and standalone flows.
   * They provide the same assertion semantics without inventing a persisted
   * TestJob merely to verify a proposal. */
  variables?: Record<string, string>;
  artifacts?: { kind: string; capturedAt: number; data: unknown }[];
  moduleStack?: string[];
  recipeGraph?: Readonly<Record<string, Recipe>>;
  /** Test seam and provider override for pixel-only destination identity. */
  observeVisualFingerprint?: () => Promise<string | undefined>;
};

async function runReusableRecipe(
  device: Device,
  recipeId: string,
  ctx: RecipeStepContext,
  bindings?: Record<string, string>,
): Promise<void> {
  const stack = ctx.moduleStack ?? [];
  if (stack.includes(recipeId))
    throw new Error(`reusable test cycle: ${[...stack, recipeId].join(" → ")}`);
  if (stack.length >= 12) throw new Error("reusable test nesting is limited to 12 levels");
  const recipe = ctx.recipeGraph?.[recipeId] ?? (await readRecipe(recipeId));
  if (!recipe) throw new Error(`reusable test not found: ${recipeId}`);
  const current = ctx.job?.resolvedInputs;
  const parameters = recipe.parameters ?? [];
  const declared = new Set(parameters.map((parameter) => parameter.name));
  for (const name of Object.keys(bindings ?? {})) {
    if (!declared.has(name)) {
      throw new Error(`reusable flow ${recipe.title} does not declare input ${name}`);
    }
  }

  const touched = new Map<string, string | undefined>();
  const resolved: Record<string, string> = {};
  if (current) {
    const overlay: Record<string, string> = { ...recipe.variables };
    for (const parameter of parameters) {
      const value =
        bindings?.[parameter.name] ??
        current[parameter.name] ??
        parameter.default ??
        recipe.variables?.[parameter.name];
      if (value === undefined && parameter.required) {
        throw new Error(`reusable flow ${recipe.title} requires input ${parameter.name}`);
      }
      if (value !== undefined) {
        overlay[parameter.name] = value;
        resolved[parameter.name] = value;
      }
    }
    for (const [name, value] of Object.entries(overlay)) {
      touched.set(name, current[name]);
      current[name] = value;
    }
    if (parameters.length > 0) {
      ctx.job?.artifacts.push({
        kind: "reusable-flow-inputs",
        capturedAt: now(),
        data: {
          recipeId: recipe.id,
          title: recipe.title,
          declared: parameters.map(({ name, required, default: defaultValue }) => ({
            name,
            ...(required ? { required: true } : {}),
            ...(defaultValue !== undefined ? { default: defaultValue } : {}),
          })),
          bindings: bindings ?? {},
          resolved,
        },
      });
    }
  }
  ctx.log(
    `↳ ${recipe.title} · ${recipe.steps.length} step(s)${parameters.length ? ` · ${Object.keys(resolved).length}/${parameters.length} inputs` : ""}`,
  );
  try {
    for (const child of recipe.steps) {
      await runRecipeStep(device, resolveRecipeStep(child, ctx.job?.resolvedInputs ?? {}), {
        ...ctx,
        moduleStack: [...stack, recipeId],
      });
    }
  } finally {
    if (current) {
      for (const [name, previous] of touched) {
        if (previous === undefined) delete current[name];
        else current[name] = previous;
      }
    }
  }
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
): Promise<{
  strategy: string;
  method?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  point?: { x: number; y: number };
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
  const namedTarget = {
    ...(target.identifier ? { identifier: target.identifier } : {}),
    ...(target.label ? { label: target.label } : {}),
    ...(target.text ? { text: target.text } : {}),
    ...(target.point ? { point: await resolvePointForDevice(device, target.point) } : {}),
  };
  const nodes = await snapshot(device);
  const named = resolveNamedControl(nodes, namedTarget);
  if (named) {
    try {
      await pressResolvedControl(device, named, namedTarget, repeated);
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
    };
  }
  const attempts: { strategy: string; run: () => Promise<void> }[] = [];
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
    const p = await resolvePointForDevice(device, target.point);
    attempts.push({ strategy: "point", run: () => pressPoint(device, p.x, p.y, repeated) });
  }
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i]!;
    try {
      await a.run();
      return { strategy: a.strategy, method: a.strategy };
    } catch (err) {
      if (isCancel(err)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (i === attempts.length - 1) {
        throw new Error(`tap failed: no strategy matched (${describeTarget(target)})`);
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
    evidence?: Extract<RecipeStep, { kind: "tap" | "type" }>["evidence"];
    region?: NonNullable<RecipeStep["when"]>["region"];
  },
  ctx: RecipeStepContext,
  repetitions = 1,
  intervalMs = 90,
): Promise<void> {
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
  const failures: string[] = [];
  for (const [index, candidate] of unique.entries()) {
    try {
      const hit = await tapTarget(
        device,
        candidate,
        ctx.log,
        repetitions,
        intervalMs,
        input.region,
      );
      const resolution = {
        kind: "target-resolution" as const,
        capturedAt: now(),
        data: {
          method: hit.method ?? hit.strategy,
          strategy: hit.strategy,
          ...(hit.bounds ? { bounds: hit.bounds } : {}),
          ...(hit.point ? { point: hit.point } : {}),
          target: candidate,
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
            reason: failures.join("; "),
            persisted: false,
          },
        });
        ctx.log(
          `locator: used ${configuredFallback ? "configured" : "recorded"} fallback ${index + 1}/${unique.length} (${hit.strategy})`,
        );
      }
      return;
    } catch (error) {
      if (isCancel(error)) throw error;
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`tap failed: ${failures.at(-1) ?? "no locator candidate matched"}`);
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
  const attempts = (
    await Promise.all(
      candidates.map(async (target) => [
        ...(target.identifier ? [{ identifier: target.identifier }] : []),
        ...(target.ref ? [{ ref: target.ref }] : []),
        ...(target.label ? [{ label: target.label }] : []),
        ...(target.text ? [{ text: target.text }] : []),
        ...(target.point ? [{ point: await resolvePointForDevice(device, target.point) }] : []),
      ]),
    )
  ).flat();
  const unique = attempts.filter(
    (candidate, index) =>
      attempts.findIndex((other) => JSON.stringify(other) === JSON.stringify(candidate)) === index,
  );
  const failures: string[] = [];
  for (const [index, candidate] of unique.entries()) {
    try {
      await longPressTarget(device, candidate, input.durationMs);
      if (index > 0) ctx.log(`locator: used recorded hold fallback ${index + 1}/${unique.length}`);
      return;
    } catch (error) {
      if (isCancel(error)) throw error;
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`hold failed: ${failures.at(-1) ?? "no locator candidate matched"}`);
}

/** Scroll up — mirrors scrollDown but via the SDK's direction field. */
async function scrollUp(device: Device, amount = 0.5): Promise<void> {
  await cooperativeCheckpoint();
  throwIfCancelled();
  await raceCancel(device.interactions.scroll({ ...base(), direction: "up", amount }));
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
    if (isNotFoundOrTimeout(err)) return false;
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

async function runRequiredRecipeStep(
  device: Device,
  step: RecipeStep,
  ctx: RecipeStepContext,
): Promise<void> {
  const { log, job } = ctx;
  switch (step.kind) {
    case "tap":
      if (step.gesture === "hold") {
        await longPressRecordedTarget(device, step, ctx);
      } else {
        const multi = step.gesture === "multi";
        await tapRecordedTarget(
          device,
          { ...step, region: step.when?.region },
          ctx,
          multi ? (step.tapCount ?? 2) : 1,
          multi ? (step.intervalMs ?? 100) : 0,
        );
      }
      break;

    case "type": {
      if (step.mode === "replace") {
        if (!step.target) throw new Error("replace text requires a target");
        await replaceText(device, step.target, step.text);
      } else {
        if (step.target) await tapRecordedTarget(device, { ...step, target: step.target }, ctx);
        await typeText(device, step.text);
      }
      break;
    }

    case "scroll":
      if (step.direction === "down") {
        await scrollDown(device, step.amount);
      } else {
        await scrollUp(device, step.amount);
      }
      break;

    case "swipe": {
      const { from, to, durationMs } = step;
      await swipeGesture(
        device,
        await resolvePointForDevice(device, from),
        await resolvePointForDevice(device, to),
        durationMs ?? 250,
      );
      break;
    }

    case "key":
      await pressKey(device, step.key);
      break;

    case "sleep":
      await sleep(step.ms, device);
      break;

    case "screenshot":
      await captureScreenshot({ jobId: job?.id, caption: step.caption, device });
      break;

    case "tour":
      await runTourStep(device, step, log, job);
      break;

    case "wait-for": {
      const target = step.target;
      const timeout = Math.min(step.timeoutMs ?? 30_000, MAX_WAIT_MS);
      if (target.identifier || target.ref) {
        const end = Date.now() + timeout;
        let found = false;
        while (Date.now() < end) {
          await cooperativeCheckpoint();
          if (await targetPresent(device, target)) {
            found = true;
            break;
          }
          await sleep(400, device);
        }
        if (!found) {
          throw new Error(
            `wait-for: timed out waiting for ${describeTarget(target)} (${timeout}ms)`,
          );
        }
      } else if (target.label) {
        await waitFor(device, { text: target.label }, timeout);
      } else if (target.text) {
        await waitFor(device, { query: target.text }, timeout);
      } else {
        // Validation rejects point-only / empty targets, but guard defensively.
        throw new Error(`wait-for: target has no identifier/ref/label/text`);
      }
      break;
    }

    case "wait-response":
      await waitForResponseCompletion(device, step, ctx);
      break;

    case "expect": {
      const target = step.target;
      const timeout = Math.min(step.timeoutMs ?? DEFAULT_EXPECT_TIMEOUT_MS, MAX_WAIT_MS);
      const timeoutSec = Math.round(timeout / 1000);
      const label = describeTarget(target);

      if (step.condition === "visible") {
        try {
          if (target.identifier || target.ref) {
            const end = Date.now() + timeout;
            let found = false;
            while (Date.now() < end) {
              await cooperativeCheckpoint();
              if (await targetPresent(device, target)) {
                found = true;
                break;
              }
              await sleep(400, device);
            }
            if (!found) throw new Error(`timed out waiting for ${describeTarget(target)}`);
          } else if (target.label) {
            await waitFor(device, { text: target.label }, timeout);
          } else if (target.text) {
            await waitFor(device, { query: target.text }, timeout);
          } else {
            // Validation rejects point-only / empty targets, but guard defensively.
            throw new Error(`expect: target has no identifier/ref/label/text`);
          }
        } catch (err) {
          if (isCancel(err)) throw err;
          // Infrastructure failures (no device / adb / session / connection)
          // keep their original message — only a real not-found/timeout
          // becomes the assertion failure.
          if (!isNotFoundOrTimeout(err)) throw err;
          throw new Error(`expect: "${label}" not visible after ${timeoutSec}s`);
        }
      } else {
        // condition === "gone": poll until the target no longer resolves.
        const end = Date.now() + timeout;
        let gone = false;
        while (Date.now() < end) {
          await cooperativeCheckpoint();
          if (!(await targetPresent(device, target))) {
            gone = true;
            break;
          }
          await sleep(400, device);
        }
        if (!gone) {
          throw new Error(`expect: "${label}" still visible after ${timeoutSec}s`);
        }
      }
      break;
    }

    case "expect-set": {
      const timeout = Math.min(step.timeoutMs ?? DEFAULT_EXPECT_TIMEOUT_MS, MAX_WAIT_MS);
      const deadline = Date.now() + timeout;
      const expected = [...new Set(step.labels)].sort((a, b) => a.localeCompare(b));
      let observed: string[] = [];
      let attempt = 0;
      while (attempt === 0 || Date.now() <= deadline) {
        attempt += 1;
        await cooperativeCheckpoint();
        const nodes = await snapshot(device);
        observed = step.scope
          ? labelsForScope(nodes, step.scope)
          : labelsForIdentifierPrefix(nodes, step.identifierPrefix ?? "");
        if (JSON.stringify(observed) === JSON.stringify(expected)) break;
        if (Date.now() >= deadline) break;
        await sleep(Math.max(0, Math.min(400, deadline - Date.now())), device);
      }
      if (JSON.stringify(observed) !== JSON.stringify(expected)) {
        const missing = expected.filter((label) => !observed.includes(label));
        const unexpected = observed.filter((label) => !expected.includes(label));
        const scopeDescription = step.scope
          ? "within " + describeTarget(step.scope)
          : "under " + (step.identifierPrefix ?? "");
        throw new Error(
          "expect-set: options did not match " +
            scopeDescription +
            " (missing: " +
            (missing.length ? missing.join(", ") : "none") +
            "; unexpected: " +
            (unexpected.length ? unexpected.join(", ") : "none") +
            ")",
        );
      }
      break;
    }

    case "expect-screen": {
      const expected = new Set([step.fingerprint, ...(step.aliases ?? [])]);
      const timeout = Math.min(step.timeoutMs ?? DEFAULT_EXPECT_TIMEOUT_MS, MAX_WAIT_MS);
      const deadline = Date.now() + timeout;
      let observedTitle = "unknown";
      let reached = false;
      do {
        let nodes: SnapshotNode[] = [];
        try {
          nodes = await snapshot(device);
        } catch {
          nodes = [];
        }
        const chrome = describeSnapshotChrome(nodes);
        observedTitle = chrome.header ?? chrome.app ?? "unknown";
        const observed = observeScreenIdentity(nodes);
        const semanticMatch = (step.observations ?? []).some(
          (observation) => compareScreenIdentity(observed, observation).decision === "match",
        );
        if (screenIdentityMatches(expected, observed.fingerprint) || semanticMatch) {
          reached = true;
          break;
        }

        // Custom-rendered and some system screens can expose an empty or
        // unstable accessibility tree. Authoring records a stable visual alias
        // for exactly that case, so replay consults the same modality while the
        // destination settles instead of sampling one transition frame.
        const visualFingerprint = ctx.observeVisualFingerprint
          ? await ctx.observeVisualFingerprint()
          : observeVisualScreenFingerprint(
              Buffer.from(
                (
                  await captureScreenshot({
                    device,
                    caption: `Verify ${step.screenTitle}`,
                    ephemeral: true,
                    includeScreenMatch: false,
                  })
                ).base64,
                "base64",
              ),
            );
        if (screenIdentityMatches(expected, observed.fingerprint, visualFingerprint)) {
          reached = true;
          break;
        }
        if (Date.now() < deadline) await sleep(Math.min(400, deadline - Date.now()), device);
      } while (Date.now() < deadline);

      if (!reached) {
        throw new Error(`expect-screen: on “${observedTitle}”, not “${step.screenTitle}”`);
      }
      log(`screen: reached ${step.screenTitle}`);
      break;
    }

    case "extract": {
      const variables = job?.resolvedInputs ?? ctx.variables;
      if (!variables) throw new Error("extract: no execution context");
      const nodes = await snapshot(device);
      const matches = nodes.filter((node) => nodeMatchesTarget(node, step.target));
      const values = [...new Set(matches.flatMap(nodeText))];
      if (values.length === 0) {
        throw new Error(`extract: no accessible content matched ${describeTarget(step.target)}`);
      }
      const text = values.join("\n");
      variables[step.as] = text;
      (job?.artifacts ?? ctx.artifacts)?.push({
        kind: "conversation-turn",
        capturedAt: now(),
        data: {
          role: step.role ?? "assistant",
          capturedAt: now(),
          source: "accessibility",
          blocks: [{ type: "text", text }],
          variable: step.as,
        },
      });
      log(`extract: saved ${step.as} (${text.length} characters)`);
      break;
    }

    case "assert-content": {
      const actual = readInput(ctx, step.input);
      const passed =
        step.match === "exact"
          ? actual === step.expected
          : step.match === "contains"
            ? actual.includes(step.expected)
            : !actual.includes(step.expected);
      (job?.artifacts ?? ctx.artifacts)?.push({
        kind: "content-assertion",
        capturedAt: now(),
        data: { input: step.input, expected: step.expected, match: step.match, passed },
      });
      if (!passed) {
        throw new Error(
          `content assertion: ${step.input} did not satisfy ${step.match} ${JSON.stringify(step.expected)}`,
        );
      }
      log(`content assertion: passed (${step.match})`);
      break;
    }

    case "evaluate-semantic": {
      const input = readInput(ctx, step.input);
      const evaluate = (provider?: string, model?: string) =>
        evaluateSemantic({
          input,
          criteria: step.criteria,
          threshold: step.threshold,
          provider,
          model,
        });

      if (step.requireAgreement) {
        // Independent judges are deliberately started together. This keeps
        // multi-model verification from doubling latency while preserving a
        // separate artifact and provenance record for every judge.
        const [firstOutcome, secondOutcome] = await Promise.allSettled([
          evaluate(step.provider, step.model),
          evaluate(step.secondProvider, step.secondModel),
        ]);
        if (firstOutcome.status === "rejected") {
          const summary = `Primary judge unavailable: ${firstOutcome.reason instanceof Error ? firstOutcome.reason.message : String(firstOutcome.reason)}`;
          job?.artifacts.push({
            kind: "judge-consensus",
            capturedAt: now(),
            data: {
              status: "uncertain",
              error: summary,
              second:
                secondOutcome.status === "fulfilled"
                  ? { ...secondOutcome.value, judge: "independent" }
                  : undefined,
            },
          });
          throw new Error(`judge uncertain: ${summary}`);
        }
        const result = firstOutcome.value;
        (job?.artifacts ?? ctx.artifacts)?.push({
          kind: "semantic-evaluation",
          capturedAt: now(),
          data: result,
        });
        log(
          `semantic evaluation: ${result.status} · ${result.score.toFixed(2)} · ${result.summary}`,
        );
        if (secondOutcome.status === "rejected") {
          const summary = `Independent judge unavailable: ${secondOutcome.reason instanceof Error ? secondOutcome.reason.message : String(secondOutcome.reason)}`;
          job?.artifacts.push({
            kind: "judge-consensus",
            capturedAt: now(),
            data: { status: "uncertain", first: result, error: summary },
          });
          throw new Error(`judge uncertain: ${summary}`);
        }
        const second = secondOutcome.value;
        job?.artifacts.push({
          kind: "semantic-evaluation",
          capturedAt: now(),
          data: { ...second, judge: "independent" },
        });
        log(
          `independent evaluation: ${second.status} · ${second.score.toFixed(2)} · ${second.summary}`,
        );
        const agreed = result.status === second.status;
        job?.artifacts.push({
          kind: "judge-consensus",
          capturedAt: now(),
          data: { status: agreed ? result.status : "uncertain", agreed, first: result, second },
        });
        if (!agreed) {
          throw new Error(
            `judge uncertain: judges disagree (${result.provider}: ${result.status}; ${second.provider}: ${second.status})`,
          );
        }
        if (result.status === "uncertain") {
          throw new Error(`judge uncertain: ${result.summary}`);
        }
        if (result.status === "fail") {
          throw new Error(`semantic assertion: ${result.summary}`);
        }
        break;
      }

      const result = await evaluate(step.provider, step.model);
      (job?.artifacts ?? ctx.artifacts)?.push({
        kind: "semantic-evaluation",
        capturedAt: now(),
        data: result,
      });
      log(`semantic evaluation: ${result.status} · ${result.score.toFixed(2)} · ${result.summary}`);
      if (result.status === "uncertain") {
        throw new Error(`judge uncertain: ${result.summary}`);
      }
      if (result.status === "fail") {
        throw new Error(`semantic assertion: ${result.summary}`);
      }
      break;
    }

    case "pause": {
      if (!job) throw new Error("pause: no job to pause (standalone step execution)");
      const checkpointStartedAt = now();
      const reason = step.reason ?? "other";
      const resumeLabel = step.resumeLabel ?? "Continue test";
      log(`⏸ ${step.message}`);
      job.status = "paused";
      job.waitingFor = {
        kind: "human",
        message: step.message,
        reason,
        resumeLabel,
        since: checkpointStartedAt,
        ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {}),
        ...(step.verifyAfter
          ? {
              verifyAfter: {
                ...step.verifyAfter,
                condition: step.verifyAfter.condition ?? "visible",
              },
            }
          : {}),
      };
      job.artifacts.push({
        kind: "human-intervention-requested",
        capturedAt: checkpointStartedAt,
        data: {
          reason,
          message: step.message,
          resumeLabel,
          ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {}),
        },
      });
      requestPause(job.id);
      publish({ type: "job.paused", at: now(), jobId: job.id, action: job.action });
      publish({
        type: "job.log",
        at: now(),
        jobId: job.id,
        line: `==> waiting for you: ${step.message}`,
        level: "info",
      });
      // Blocks until resumeJob (POST /jobs/:id/resume) calls requestResume.
      // On cancel, throws JobCancelledError and propagates up — never sets running.
      try {
        await cooperativeCheckpointWithTimeout(job.id, step.timeoutMs);
      } finally {
        // A timeout or cancellation must also wake the cooperative waiter.
        requestResume(job.id);
        job.waitingFor = undefined;
      }
      job.artifacts.push({
        kind: "human-intervention-completed",
        capturedAt: now(),
        data: {
          reason,
          message: step.message,
          waitedMs: now() - checkpointStartedAt,
        },
      });
      // resumeJob already set status="running" + published job.resumed; ensure it.
      job.status = "running";
      if (step.verifyAfter) {
        const verificationStartedAt = now();
        const condition = step.verifyAfter.condition ?? "visible";
        try {
          await runRecipeStep(
            device,
            {
              kind: "expect",
              target: step.verifyAfter.target,
              condition,
              ...(step.verifyAfter.timeoutMs !== undefined
                ? { timeoutMs: step.verifyAfter.timeoutMs }
                : {}),
            },
            ctx,
          );
          job.artifacts.push({
            kind: "human-intervention-verified",
            capturedAt: now(),
            data: {
              passed: true,
              target: step.verifyAfter.target,
              condition,
              durationMs: now() - verificationStartedAt,
            },
          });
          log(`human checkpoint: verified ${describeTarget(step.verifyAfter.target)} ${condition}`);
        } catch (error) {
          job.artifacts.push({
            kind: "human-intervention-verified",
            capturedAt: now(),
            data: {
              passed: false,
              target: step.verifyAfter.target,
              condition,
              durationMs: now() - verificationStartedAt,
              error: error instanceof Error ? error.message : String(error),
            },
          });
          throw error;
        }
      }
      break;
    }

    case "review": {
      if (!job) throw new Error("review: no job to annotate");
      const context = job.operationContext;
      const review = {
        schemaVersion: 1 as const,
        status: "pending" as const,
        capability: step.capability,
        reason: step.reason,
        requestedAt: now(),
        ...(context ? { requestedBy: { id: context.actorId, kind: context.actorKind } } : {}),
      };
      job.review = review;
      job.artifacts.push({ kind: "review-required", capturedAt: review.requestedAt, data: review });
      log(`? needs review · ${step.capability}: ${step.reason}`);
      break;
    }

    case "flow": {
      // validateRecipeSteps guarantees step.flow is a known ActionId; narrow to satisfy types.
      if (!isActionId(step.flow)) {
        throw new Error(`flow step references unknown action: ${step.flow}`);
      }
      const result = await runAction(device, step.flow, { onLog: log });
      if (!result.ok) throw new Error(result.error);
      break;
    }

    case "module": {
      await runReusableRecipe(device, step.recipeId, ctx, step.bindings);
      break;
    }

    case "branch": {
      const key = step.input.replace(/^\{\{\s*|\s*\}\}$/g, "");
      const actual = job?.resolvedInputs[key];
      const matched =
        step.operator === "exists"
          ? actual !== undefined && actual.length > 0
          : step.operator === "equals"
            ? actual === step.expected
            : step.operator === "not-equals"
              ? actual !== step.expected
              : actual?.includes(step.expected ?? "") === true;
      const recipeId = matched ? step.thenRecipeId : step.elseRecipeId;
      job?.artifacts.push({
        kind: "branch-decision",
        capturedAt: now(),
        data: { input: key, operator: step.operator, expected: step.expected, matched, recipeId },
      });
      log(
        `branch: ${matched ? "matched" : "otherwise"}${recipeId ? ` → ${recipeId}` : " → continue"}`,
      );
      if (recipeId) await runReusableRecipe(device, recipeId, ctx);
      break;
    }

    case "repeat": {
      for (let iteration = 0; iteration < step.count; iteration += 1) {
        await cooperativeCheckpoint(job?.id);
        if (job) job.resolvedInputs.iteration = String(iteration + 1);
        log(`repeat: ${iteration + 1}/${step.count}`);
        await runReusableRecipe(device, step.recipeId, ctx);
      }
      job?.artifacts.push({
        kind: "loop",
        capturedAt: now(),
        data: { recipeId: step.recipeId, count: step.count },
      });
      break;
    }

    case "script": {
      const before = { ...job?.resolvedInputs };
      runVariableScript(step.source, ctx);
      job?.artifacts.push({
        kind: "variable-script",
        capturedAt: now(),
        data: { source: step.source, before, after: { ...job?.resolvedInputs } },
      });
      log("script: variables transformed safely");
      break;
    }

    case "clipboard": {
      if (step.action === "write") {
        await clipboardWrite(device, step.text ?? "");
      } else if (step.action === "paste") {
        // Omitting text means "paste what the previous copy/read left in the
        // system clipboard". This mirrors a human copy → paste gesture and
        // keeps the YAML readable; explicit text remains the atomic,
        // cross-platform path for generated values.
        const text = step.text ?? (await clipboardRead(device));
        await clipboardPaste(device, text, step.target!);
        log(`clipboard: pasted ${text.length} character(s) through the system menu`);
      } else if (step.action === "copy") {
        const value = await clipboardCopy(device, step.target!, step.expect);
        log(`clipboard: copied ${value.length} character(s) through the system menu`);
        if (step.expect !== undefined) {
          const ok =
            step.match === "contains" ? value.includes(step.expect) : value === step.expect;
          if (!ok) throw clipboardExpectationError(value, step.expect, step.match);
        }
      } else {
        const value = await clipboardRead(device);
        log(`clipboard: read ${value.length} character(s)`);
        if (step.expect !== undefined) {
          const ok =
            step.match === "contains" ? value.includes(step.expect) : value === step.expect;
          if (!ok) {
            throw clipboardExpectationError(value, step.expect, step.match);
          }
        }
      }
      break;
    }

    case "app": {
      if (step.action === "switcher") {
        await openAppSwitcher(device);
        break;
      }
      if (step.action === "close") {
        await closeApp(device, step.app);
        break;
      }
      if (step.action === "open") {
        if (step.url) await openUrl(device, step.url);
        else
          await openApp(
            device,
            step.app!,
            step.relaunch === undefined ? undefined : { relaunch: step.relaunch },
          );
        break;
      }

      const build =
        step.action === "install" || step.action === "update" || step.action === "uninstall"
          ? await changeAndroidAppBuild({
              action: step.action,
              packageName: step.app!,
              artifact: step.artifact,
            })
          : await inspectAndroidApp(step.app!);
      const expected = step.version;
      const versionMatches =
        expected === undefined
          ? undefined
          : step.versionMatch === "contains"
            ? build.versionName?.includes(expected) === true
            : build.versionName === expected;

      job?.artifacts.push({
        kind: "app-build",
        capturedAt: now(),
        data: {
          action: step.action,
          ...build,
          ...(expected !== undefined
            ? {
                expectedVersion: expected,
                versionMatch: step.versionMatch ?? "exact",
                versionMatches,
              }
            : {}),
          ...(step.artifact ? { artifact: step.artifact } : {}),
        },
      });
      if (build.versionName) {
        if (job) {
          job.appVersion = build.versionName;
          job.resolvedInputs[step.as ?? "app_version"] = build.versionName;
        }
      }
      log(
        `app build: ${build.packageName} · ${build.installed ? (build.versionName ?? "installed (version unavailable)") : "not installed"}`,
      );
      if (step.action === "assert-installed" && !build.installed) {
        throw new Error(`app build: ${step.app} is not installed`);
      }
      if (step.action === "assert-not-installed" && build.installed) {
        throw new Error(
          `app build: ${step.app} is installed (${build.versionName ?? "version unavailable"})`,
        );
      }
      if (expected !== undefined && versionMatches === false) {
        throw new Error(
          `app build: ${step.app} version ${JSON.stringify(build.versionName ?? "unknown")} does not ${step.versionMatch === "contains" ? "contain" : "equal"} ${JSON.stringify(expected)}`,
        );
      }
      break;
    }

    case "device":
      if (step.action === "lock" || step.action === "unlock")
        await setAndroidLockState(step.action);
      else await keyboardAction(device, step.action === "keyboard-dismiss" ? "dismiss" : "enter");
      break;

    case "rotate":
      await rotateDevice(device, step.orientation);
      runtimeBoundsCache.delete(device);
      break;

    case "settings": {
      const common = { ...base(), setting: step.setting };
      const result =
        step.setting === "appearance"
          ? await updateSetting(device, {
              ...common,
              setting: "appearance",
              state: step.state as "light" | "dark" | "toggle",
            })
          : await updateSetting(device, {
              ...common,
              setting: step.setting as "wifi" | "airplane" | "location" | "animations",
              state: step.state as "on" | "off",
            });
      job?.artifacts.push({ kind: "device-setting", capturedAt: now(), data: result });
      break;
    }

    case "location": {
      const result = await updateSetting(device, {
        ...base(),
        setting: "location",
        state: "set",
        latitude: step.latitude,
        longitude: step.longitude,
      });
      job?.artifacts.push({ kind: "location", capturedAt: now(), data: result });
      break;
    }

    case "permission": {
      const result = await updateSetting(device, {
        ...base(),
        setting: "permission",
        state: step.action,
        permission: step.permission,
      });
      job?.artifacts.push({ kind: "permission", capturedAt: now(), data: result });
      break;
    }

    case "alert": {
      const result = await alertAction(device, step.action, step.timeoutMs);
      job?.artifacts.push({ kind: "alert", capturedAt: now(), data: result });
      break;
    }

    case "network": {
      const include = step.include ?? "summary";
      if (
        (include === "body" || include === "all") &&
        !ctx.job?.evidencePolicy?.sensitive["network-body"]
      ) {
        throw new Error("network body capture requires consent in Settings → Privacy & evidence");
      }
      const result = await captureNetwork(device, {
        action: step.action,
        include,
        limit: step.limit,
      });
      job?.artifacts.push({ kind: "network", capturedAt: now(), data: result });
      log(`network: captured ${include}`);
      break;
    }

    case "logs": {
      const result = await manageLogs(device, { action: step.action, message: step.message });
      job?.artifacts.push({ kind: "device-log", capturedAt: now(), data: result });
      break;
    }
  }
}

export async function runRecipeStep(
  device: Device,
  step: RecipeStep,
  ctx: RecipeStepContext,
): Promise<void> {
  if (step.when) {
    const present = await conditionalTargetPresent(device, step.when);
    const shouldRun = step.when.condition === "present" ? present : !present;
    if (!shouldRun) {
      const message = `${describeTarget(step.when.target)} is ${present ? "present" : "absent"}`;
      ctx.log(`conditional ${step.kind}: skipped — ${message}`);
      ctx.job?.artifacts.push({
        kind: "conditional-step-skipped",
        capturedAt: now(),
        data: {
          stepId: step.id,
          stepKind: step.kind,
          condition: step.when.condition,
          target: step.when.target,
          observed: present ? "present" : "absent",
        },
      });
      return;
    }
  }
  if (!step.optional) {
    await runRequiredRecipeStep(device, step, ctx);
    return;
  }
  try {
    await runRequiredRecipeStep(device, step, ctx);
  } catch (error) {
    if (isCancel(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    ctx.log(`optional ${step.kind}: skipped — ${message}`);
    ctx.job?.artifacts.push({
      kind: "optional-step-skipped",
      capturedAt: now(),
      data: { stepId: step.id, stepKind: step.kind, message },
    });
  }
}
