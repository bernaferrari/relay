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
import type { TestJob } from "./session.js";
import {
  compareScreenIdentity,
  localeNeutralStructureSignature,
  observeScreenIdentity,
} from "./screen-identity.js";
import {
  nodeMatchesTarget,
  refMatchesRecordedTarget,
  resolveElementRelativePoint,
  textForTarget,
  sameTarget,
} from "./recipe-target-match.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { currentVerifiedScreen } from "./recipe-runner-context.js";

function isLocalizedRecipeJob(job?: TestJob): boolean {
  const locale = (job?.resolvedInputs?.language ?? job?.resolvedInputs?.locale ?? "")
    .trim()
    .toLocaleLowerCase();
  return Boolean(locale && !/^en(?:-|$)/.test(locale));
}

/**
 * App-locale runs intentionally change visible text, so an English semantic
 * fingerprint cannot be the only screen proof.  Stable platform identifiers
 * plus near-identical accessibility structure are a strict, language-neutral
 * substitute.  Labels alone never qualify: that would make an unrelated
 * translated surface look like the recorded screen.
 */
function meaningfulStableIdentifiers(
  observation: ReturnType<typeof observeScreenIdentity>,
): Set<string> {
  return new Set(
    observation.nodes.flatMap((node) => {
      const identifier = node.identifier;
      if (!identifier) return [];
      if (identifier === "android:id/content" || identifier.endsWith(":id/action_bar_root"))
        return [];
      return [identifier];
    }),
  );
}

function resilientScreenIdentityMatch(
  observed: ReturnType<typeof observeScreenIdentity>,
  observations: NonNullable<Extract<RecipeStep, { kind: "expect-screen" }>["observations"]>,
  job?: TestJob,
  options: { allowDynamicShell?: boolean } = {},
): boolean {
  const localized = isLocalizedRecipeJob(job);
  const structureSignature = localeNeutralStructureSignature(observed);
  return observations.some((observation) => {
    const comparison = compareScreenIdentity(observed, observation);
    const stableIdentifiers = comparison.signals.find(
      (signal) => signal.kind === "stable-identifier-overlap" && signal.impact === "positive",
    )?.strength;
    const structure = comparison.signals.find(
      (signal) => signal.kind === "structural-overlap" && signal.impact === "positive",
    )?.strength;
    const expectedIdentifiers = meaningfulStableIdentifiers(observation);
    const observedIdentifiers = meaningfulStableIdentifiers(observed);
    const sharedIdentifiers = [...expectedIdentifiers].filter((identifier) =>
      observedIdentifiers.has(identifier),
    );
    // Dynamic lists can replace most visible copy and change row count while
    // leaving a compact application-owned identifier set intact. Grok
    // Navigation is the usual case: profile_section + settings_button +
    // new_conversation_button stay put, conversation titles do not. Role-bag
    // overlap across that list is not screen identity — a handful of extra or
    // missing rows already drops a ~80-node tree below 0.95.
    // Richer shells (six or more reviewed identifiers) stay on the explicit
    // handoff rule so a reflowed system Settings page cannot match without
    // its declared owner app.
    const stableApplicationShell =
      expectedIdentifiers.size >= 2 &&
      expectedIdentifiers.size <= 5 &&
      observedIdentifiers.size === expectedIdentifiers.size &&
      sharedIdentifiers.length === expectedIdentifiers.size;
    return (
      (options.allowDynamicShell !== false && stableApplicationShell) ||
      (localized && (stableIdentifiers ?? 0) >= 0.98 && (structure ?? 0) >= 0.95) ||
      (localized &&
        structureSignature !== undefined &&
        structureSignature === localeNeutralStructureSignature(observation))
    );
  });
}

/** Cross-app handoffs can land at a different scroll offset while still
 * exposing the exact same reviewed, package-owned shell. This deliberately
 * requires a much richer identifier set than the generic dynamic-list rule;
 * the caller separately proves the foreground package. */
function handoffShellIdentityMatch(
  observed: ReturnType<typeof observeScreenIdentity>,
  observations: NonNullable<Extract<RecipeStep, { kind: "expect-screen" }>["observations"]>,
): boolean {
  const observedIdentifiers = meaningfulStableIdentifiers(observed);
  return observations.some((observation) => {
    const expectedIdentifiers = meaningfulStableIdentifiers(observation);
    if (expectedIdentifiers.size < 6 || observedIdentifiers.size !== expectedIdentifiers.size) {
      return false;
    }
    if ([...expectedIdentifiers].some((identifier) => !observedIdentifiers.has(identifier))) {
      return false;
    }
    const structure = compareScreenIdentity(observed, observation).signals.find(
      (signal) => signal.kind === "structural-overlap" && signal.impact === "positive",
    )?.strength;
    return (structure ?? 0) >= 0.9;
  });
}
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
  const literalPoint =
    target.point && !target.point.relativeTo
      ? await resolvePointForDevice(device, target.point, mirrorPoints)
      : undefined;
  const namedTarget = {
    ...(target.identifier ? { identifier: target.identifier } : {}),
    ...(target.label ? { label: target.label } : {}),
    ...(target.role ? { role: target.role } : {}),
    ...(target.text ? { text: target.text } : {}),
    ...(literalPoint ? { point: literalPoint } : {}),
    ...(expectedApp ? { expectedApp } : {}),
  };
  // An immediately preceding expect-screen already paid for and verified this
  // exact tree. Reuse it until the first mutation; fallback strategies still
  // take a fresh snapshot when the cached tree cannot resolve the target.
  let nodes = verifiedNodes?.length ? verifiedNodes : await snapshot(device);
  let namedOutcome = resolveNamedControlOutcome(nodes, namedTarget);
  let named = namedOutcome.status === "resolved" ? namedOutcome.resolution : undefined;
  if (
    !named &&
    selectedPlatform() === "android" &&
    (target.identifier || target.label || target.text)
  ) {
    // Compose can publish the destination shell before its actionable rows.
    // Wait for a few fresh accessibility generations; never convert absence
    // into an unreviewed coordinate tap.
    for (let attempt = 0; attempt < 5 && !named; attempt += 1) {
      await cooperativeCheckpoint();
      await sleep(250, device);
      nodes = await snapshot(device);
      namedOutcome = resolveNamedControlOutcome(nodes, namedTarget);
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
    };
  }
  if (
    selectedPlatform() === "android" &&
    nodes.length > 0 &&
    !target.point &&
    (target.identifier || target.label || target.text)
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
      if (isCancel(error)) throw error;
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
  runtimeBoundsCache,
  runVariableScript,
  scrollUp,
  tapRecordedTarget,
  targetPresent,
  waitForResponseCompletion,
};
