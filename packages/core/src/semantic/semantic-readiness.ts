/**
 * Bounded snapshot poll until expected semantic labels are present.
 * Locale relaunch uses this instead of an unbounded or fixed sleep.
 */
import { createHash } from "node:crypto";

export const DEFAULT_SEMANTIC_READINESS_TIMEOUT_MS = 12_000;

export type SemanticReadinessNode = {
  label?: string;
  text?: string;
  value?: string;
};

export type SemanticReadinessSnapshot = {
  labels?: readonly string[];
  nodes?: readonly SemanticReadinessNode[];
  screenshotPath?: string;
  digest?: string;
};

export type SemanticReadinessRetry = {
  delayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  maxAttempts?: number;
};

export type AwaitSemanticReadinessInput = {
  captureSnapshot: () => Promise<SemanticReadinessSnapshot>;
  expectedLabels: readonly string[];
  timeoutMs?: number;
  retry?: SemanticReadinessRetry;
  /** Default `all`: every expected label must appear. `any` succeeds on the first match. */
  match?: "all" | "any";
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type SemanticReadinessSuccess = {
  ready: true;
  attempts: number;
  elapsedMs: number;
  matchedLabels: string[];
  lastLabels: string[];
  digest?: string;
  screenshotPath?: string;
};

export class SemanticReadinessTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly expectedLabels: string[];
  readonly missingLabels: string[];
  readonly lastLabels: string[];
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly digest?: string;
  readonly screenshotPath?: string;

  constructor(input: {
    timeoutMs: number;
    expectedLabels: string[];
    missingLabels: string[];
    lastLabels: string[];
    attempts: number;
    elapsedMs: number;
    digest?: string;
    screenshotPath?: string;
  }) {
    const missing = input.missingLabels.length ? input.missingLabels.join(", ") : "none";
    const last = input.lastLabels.length ? input.lastLabels.join(", ") : "none";
    const extras = [
      input.digest ? `digest: ${input.digest}` : undefined,
      input.screenshotPath ? `screenshot: ${input.screenshotPath}` : undefined,
    ].filter((part): part is string => Boolean(part));
    super(
      `semantic readiness: timed out after ${input.timeoutMs}ms waiting for ${
        input.expectedLabels.join(", ") || "(none)"
      } (missing: ${missing}; last: ${last}${extras.length ? `; ${extras.join("; ")}` : ""})`,
    );
    this.name = "SemanticReadinessTimeoutError";
    this.timeoutMs = input.timeoutMs;
    this.expectedLabels = input.expectedLabels;
    this.missingLabels = input.missingLabels;
    this.lastLabels = input.lastLabels;
    this.attempts = input.attempts;
    this.elapsedMs = input.elapsedMs;
    this.digest = input.digest;
    this.screenshotPath = input.screenshotPath;
  }
}

export function normalizeSemanticLabels(values: readonly (string | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || trimmed === "-") continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function labelsFromSemanticSnapshot(snapshot: SemanticReadinessSnapshot): string[] {
  return normalizeSemanticLabels([
    ...(snapshot.labels ?? []),
    ...(snapshot.nodes ?? []).flatMap((node) => [node.label, node.text, node.value]),
  ]);
}

export function semanticSnapshotDigest(labels: readonly string[]): string {
  return createHash("sha256")
    .update([...labels].sort().join("\n"))
    .digest("hex")
    .slice(0, 16);
}

export function collectExpectedSemanticLabels(input: {
  screenTitle?: string;
  observationLabels?: readonly (string | undefined)[];
  optionLabels?: readonly (string | undefined)[];
}): string[] {
  return normalizeSemanticLabels([
    input.screenTitle,
    ...(input.observationLabels ?? []),
    ...(input.optionLabels ?? []),
  ]).slice(0, 8);
}

export function appStepExpectedLabels(step: unknown): string[] {
  if (!step || typeof step !== "object" || !("expectedLabels" in step)) return [];
  const labels = (step as { expectedLabels?: unknown }).expectedLabels;
  return Array.isArray(labels) ? normalizeSemanticLabels(labels.map((value) => String(value))) : [];
}

export function attachExpectedLabels<T extends object>(
  step: T,
  labels: readonly string[] | undefined,
): T {
  const expectedLabels = normalizeSemanticLabels(labels ?? []);
  if (!expectedLabels.length) return step;
  return Object.assign(step, { expectedLabels });
}

function missingExpectedLabels(expected: readonly string[], observed: readonly string[]): string[] {
  const have = new Set(observed);
  return expected.filter((label) => !have.has(label));
}

function snapshotIsReady(
  match: "all" | "any",
  expected: readonly string[],
  observed: readonly string[],
): boolean {
  if (!expected.length) return true;
  const missing = missingExpectedLabels(expected, observed);
  return match === "any" ? missing.length < expected.length : missing.length === 0;
}

export async function awaitSemanticReadiness(
  input: AwaitSemanticReadinessInput,
): Promise<SemanticReadinessSuccess> {
  const expectedLabels = normalizeSemanticLabels(input.expectedLabels);
  const timeoutMs = Math.max(0, input.timeoutMs ?? DEFAULT_SEMANTIC_READINESS_TIMEOUT_MS);
  const match = input.match ?? "all";
  const delayMs = Math.max(1, input.retry?.delayMs ?? 250);
  const maxDelayMs = Math.max(delayMs, input.retry?.maxDelayMs ?? 1_500);
  const factor = Number.isFinite(input.retry?.factor) ? Math.max(1, input.retry!.factor!) : 2;
  const now = input.now ?? Date.now;
  const sleep =
    input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  const attemptBudget = Math.max(
    1,
    input.retry?.maxAttempts ?? Math.min(64, Math.floor(timeoutMs / delayMs) + 1),
  );

  if (!expectedLabels.length) {
    return {
      ready: true,
      attempts: 0,
      elapsedMs: 0,
      matchedLabels: [],
      lastLabels: [],
    };
  }

  let attempts = 0;
  let delay = delayMs;
  let last: SemanticReadinessSnapshot = {};
  let lastLabels: string[] = [];

  while (attempts < attemptBudget) {
    attempts += 1;
    last = await input.captureSnapshot();
    lastLabels = labelsFromSemanticSnapshot(last);
    const digest = last.digest ?? semanticSnapshotDigest(lastLabels);
    if (snapshotIsReady(match, expectedLabels, lastLabels)) {
      return {
        ready: true,
        attempts,
        elapsedMs: Math.max(0, now() - startedAt),
        matchedLabels: expectedLabels.filter((label) => lastLabels.includes(label)),
        lastLabels,
        digest,
        ...(last.screenshotPath ? { screenshotPath: last.screenshotPath } : {}),
      };
    }
    if (attempts >= attemptBudget) break;
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const waitMs = Math.min(delay, maxDelayMs, remaining);
    if (waitMs <= 0) break;
    await sleep(waitMs);
    delay = Math.min(maxDelayMs, delay * factor);
  }

  throw new SemanticReadinessTimeoutError({
    timeoutMs,
    expectedLabels,
    missingLabels: missingExpectedLabels(expectedLabels, lastLabels),
    lastLabels,
    attempts,
    elapsedMs: Math.max(0, now() - startedAt),
    digest: last.digest ?? (lastLabels.length ? semanticSnapshotDigest(lastLabels) : undefined),
    ...(last.screenshotPath ? { screenshotPath: last.screenshotPath } : {}),
  });
}
