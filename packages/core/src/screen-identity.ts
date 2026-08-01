import { createHash } from "node:crypto";
import type { SnapshotNode } from "./device.js";

export type VolatileSemanticKind =
  | "clock"
  | "counter"
  | "date"
  | "percentage"
  | "relative-time"
  | "uuid";

export type SemanticField = "identifier" | "label" | "value";

export type VolatileSemanticSignal = {
  kind: VolatileSemanticKind;
  field: SemanticField;
  node: number;
};

export type NormalizedSemanticNode = {
  role: string;
  label?: string;
  value?: string;
  identifier?: string;
  enabled?: boolean;
  selected?: boolean;
  focused?: boolean;
  hittable?: boolean;
  depth?: number;
};

export type ScreenIdentityObservation = {
  fingerprint: string;
  nodes: NormalizedSemanticNode[];
  volatileSignals: VolatileSemanticSignal[];
};

export type ScreenIdentitySignalKind =
  | "exact-fingerprint"
  | "stable-identifier-overlap"
  | "role-label-overlap"
  | "semantic-overlap"
  | "structural-overlap"
  | "volatile-content-normalized"
  | "semantic-conflict"
  | "empty-observation"
  | "insufficient-evidence";

export type ScreenIdentitySignal = {
  kind: ScreenIdentitySignalKind;
  impact: "positive" | "negative" | "neutral";
  strength: number;
  detail: string;
};

export type ScreenIdentityComparison = {
  confidence: number;
  decision: "match" | "possible" | "different" | "insufficient";
  signals: ScreenIdentitySignal[];
};

export type ScreenIdentityCandidate = {
  id: string;
  observation: ScreenIdentityObservation;
};

export type RankedScreenIdentityCandidate<T extends ScreenIdentityCandidate> = {
  candidate: T;
  comparison: ScreenIdentityComparison;
};

export type ScreenIdentityResolution<T extends ScreenIdentityCandidate> =
  | {
      kind: "existing";
      match: RankedScreenIdentityCandidate<T>;
      ranked: RankedScreenIdentityCandidate<T>[];
      reasons: ScreenIdentitySignal[];
    }
  | {
      kind: "ambiguous";
      ranked: RankedScreenIdentityCandidate<T>[];
      reasons: ScreenIdentitySignal[];
    }
  | {
      kind: "new";
      ranked: RankedScreenIdentityCandidate<T>[];
      reasons: ScreenIdentitySignal[];
    };

export type ScreenIdentityResolutionOptions = {
  matchThreshold?: number;
  ambiguityMargin?: number;
};

const CLOCK = /\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\s*[ap]\.?m\.?)?\b/giu;
const ISO_DATE = /\b(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])\b/gu;
const NUMERIC_DATE =
  /\b(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.](?:\d{2}|(?:19|20)\d{2})\b/gu;
const NAMED_DATE =
  /\b(?:(?:mon|tue(?:s)?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\s*,?\s*)?(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*(?:19|20)\d{2})?)\b/giu;
const PERCENTAGE = /\b\d+(?:[.,]\d+)?\s*%/gu;
const UUID =
  /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{32})\b/giu;
const RELATIVE_TIME =
  /\b(?:\d+\s*(?:s|sec(?:ond)?s?|m|min(?:ute)?s?|h|hr(?:our)?s?|d|day?s?|w|week?s?)\s*(?:ago)?|yesterday|today)\b/giu;
const COUNT_NOUN =
  "alerts?|badges?|comments?|followers?|items?|likes?|messages?|notifications?|results?|tasks?|unread";
const LEADING_COUNTER = new RegExp(`\\b\\d+(?:[.,]\\d+)?\\s+(${COUNT_NOUN})\\b`, "giu");
const TRAILING_COUNTER = new RegExp(
  `\\b(${COUNT_NOUN})\\s*[:(]?\\s*\\d+(?:[.,]\\d+)?\\)?\\b`,
  "giu",
);
const PAGE_COUNTER = /\b(page|step)\s+\d+\s+(of)\s+\d+\b/giu;
const PURE_COUNTER = /^\s*\d+(?:[.,]\d+)?\s*$/u;

type MutableNormalization = {
  value: string;
  kinds: Set<VolatileSemanticKind>;
};

function replaceVolatile(
  state: MutableNormalization,
  pattern: RegExp,
  replacement: string,
  kind: VolatileSemanticKind,
): void {
  pattern.lastIndex = 0;
  if (!pattern.test(state.value)) return;
  pattern.lastIndex = 0;
  state.value = state.value.replace(pattern, replacement);
  state.kinds.add(kind);
}

function normalizeText(value: string | undefined, field: SemanticField): MutableNormalization {
  const state: MutableNormalization = {
    value: (value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US"),
    kinds: new Set(),
  };
  if (!state.value) return state;

  replaceVolatile(state, UUID, "<uuid>", "uuid");
  if (field !== "identifier") {
    replaceVolatile(state, CLOCK, "<clock>", "clock");
    replaceVolatile(state, ISO_DATE, "<date>", "date");
    replaceVolatile(state, NUMERIC_DATE, "<date>", "date");
    replaceVolatile(state, NAMED_DATE, "<date>", "date");
    replaceVolatile(state, PERCENTAGE, "<percentage>", "percentage");
    replaceVolatile(state, RELATIVE_TIME, "<relative-time>", "relative-time");
    replaceVolatile(state, PAGE_COUNTER, "$1 <count> $2 <count>", "counter");
    replaceVolatile(state, LEADING_COUNTER, "<count> $1", "counter");
    replaceVolatile(state, TRAILING_COUNTER, "$1 <count>", "counter");
    if (PURE_COUNTER.test(state.value)) {
      state.value = "<count>";
      state.kinds.add("counter");
    }
  }

  state.value = state.value.trim().replace(/\s+/gu, " ");
  return state;
}

function canonicalNode(node: NormalizedSemanticNode): string {
  return JSON.stringify([
    node.role,
    node.identifier ?? "",
    node.label ?? "",
    node.value ?? "",
    node.enabled ?? null,
    node.selected ?? null,
  ]);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Converts a native accessibility snapshot into stable, visible semantics.
 * Geometry, references, traversal indexes, and screenshots are intentionally
 * excluded: they are observations of a screen, not its identity.
 */
export function observeScreenIdentity(nodes: readonly SnapshotNode[]): ScreenIdentityObservation {
  const entries = nodes
    .filter((node) => node.visibleToUser !== false)
    .flatMap((node) => {
      const label = normalizeText(node.label, "label");
      const value = normalizeText(node.value, "value");
      const identifier = normalizeText(node.identifier, "identifier");
      const role = normalizeText(node.role ?? node.type, "label").value;
      if (!role && !label.value && !value.value && !identifier.value) return [];
      return [
        {
          node: {
            role,
            ...(label.value ? { label: label.value } : {}),
            ...(value.value ? { value: value.value } : {}),
            ...(identifier.value ? { identifier: identifier.value } : {}),
            ...(node.enabled !== undefined ? { enabled: node.enabled } : {}),
            ...(node.selected !== undefined ? { selected: node.selected } : {}),
            ...(node.focused !== undefined ? { focused: node.focused } : {}),
            ...(node.hittable !== undefined ? { hittable: node.hittable } : {}),
            ...(node.depth !== undefined ? { depth: node.depth } : {}),
          } satisfies NormalizedSemanticNode,
          volatility: { label: label.kinds, value: value.kinds, identifier: identifier.kinds },
        },
      ];
    })
    .sort((left, right) => canonicalNode(left.node).localeCompare(canonicalNode(right.node)));
  const normalized = entries.map((entry) => entry.node);
  const volatileSignals = entries.flatMap((entry, node) =>
    (["label", "value", "identifier"] as const).flatMap((field) =>
      [...entry.volatility[field]].map((kind) => ({ kind, field, node })),
    ),
  );
  volatileSignals.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.field.localeCompare(right.field) ||
      left.node - right.node,
  );
  return {
    fingerprint: digest(`relay-screen-identity:v1:${normalized.map(canonicalNode).join("\n")}`),
    nodes: normalized,
    volatileSignals,
  };
}

type FeatureMap = Map<string, number>;

function addFeature(features: FeatureMap, key: string, weight = 1): void {
  features.set(key, (features.get(key) ?? 0) + weight);
}

function featureMap(
  observation: ScreenIdentityObservation,
  family: "identifier" | "role-label" | "semantic" | "role",
): FeatureMap {
  const features: FeatureMap = new Map();
  for (const node of observation.nodes) {
    if (family === "identifier" && node.identifier) addFeature(features, node.identifier);
    if (family === "role-label" && node.label)
      addFeature(features, `${node.role}\u0000${node.label}`);
    if (family === "semantic") {
      if (node.label) addFeature(features, `label:${node.label}`, 2);
      if (node.value) addFeature(features, `value:${node.role}\u0000${node.value}`);
      if (node.identifier) addFeature(features, `identifier:${node.identifier}`, 3);
    }
    if (family === "role" && node.role) addFeature(features, node.role);
  }
  return features;
}

function weightedJaccard(left: FeatureMap, right: FeatureMap): number | null {
  const keys = new Set([...left.keys(), ...right.keys()]);
  if (keys.size === 0) return null;
  let intersection = 0;
  let union = 0;
  for (const key of keys) {
    const a = left.get(key) ?? 0;
    const b = right.get(key) ?? 0;
    intersection += Math.min(a, b);
    union += Math.max(a, b);
  }
  return union === 0 ? null : intersection / union;
}

function rounded(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}

function signal(
  kind: ScreenIdentitySignalKind,
  impact: ScreenIdentitySignal["impact"],
  strength: number,
  detail: string,
): ScreenIdentitySignal {
  return { kind, impact, strength: rounded(strength), detail };
}

/** Compare two normalized observations using explainable semantic evidence. */
export function compareScreenIdentity(
  left: ScreenIdentityObservation,
  right: ScreenIdentityObservation,
): ScreenIdentityComparison {
  if (left.nodes.length === 0 || right.nodes.length === 0) {
    return {
      confidence: 0,
      decision: "insufficient",
      signals: [
        signal(
          "empty-observation",
          "negative",
          1,
          "At least one observation has no visible semantics.",
        ),
        signal(
          "insufficient-evidence",
          "neutral",
          1,
          "Empty accessibility trees are not treated as proof that two screens are the same.",
        ),
      ],
    };
  }

  if (left.fingerprint === right.fingerprint) {
    const signals = [
      signal("exact-fingerprint", "positive", 1, "All normalized visible semantics match."),
    ];
    if (left.volatileSignals.length > 0 || right.volatileSignals.length > 0) {
      signals.push(
        signal(
          "volatile-content-normalized",
          "neutral",
          1,
          "Volatile values were reduced to typed placeholders before comparison.",
        ),
      );
    }
    return { confidence: 1, decision: "match", signals };
  }

  const identifier = weightedJaccard(
    featureMap(left, "identifier"),
    featureMap(right, "identifier"),
  );
  const roleLabel = weightedJaccard(
    featureMap(left, "role-label"),
    featureMap(right, "role-label"),
  );
  const semantic = weightedJaccard(featureMap(left, "semantic"), featureMap(right, "semantic"));
  const structural = weightedJaccard(featureMap(left, "role"), featureMap(right, "role")) ?? 0;
  const weighted: Array<[number | null, number]> = [
    [identifier, 0.3],
    [roleLabel, 0.35],
    [semantic, 0.25],
    [structural, 0.1],
  ];
  let total = 0;
  let weight = 0;
  for (const [value, contribution] of weighted) {
    if (value === null) continue;
    total += value * contribution;
    weight += contribution;
  }
  let confidence = weight ? total / weight : 0;
  const stableAnchorConflict =
    ((identifier !== null && identifier === 0) || (roleLabel !== null && roleLabel === 0)) &&
    (identifier === 0 || roleLabel === 0);
  if (stableAnchorConflict) confidence = Math.min(confidence, 0.45);
  confidence = rounded(confidence);

  const signals: ScreenIdentitySignal[] = [];
  if (identifier !== null)
    signals.push(
      signal(
        "stable-identifier-overlap",
        identifier > 0 ? "positive" : "negative",
        identifier,
        `${Math.round(identifier * 100)}% of stable identifier evidence overlaps.`,
      ),
    );
  if (roleLabel !== null)
    signals.push(
      signal(
        "role-label-overlap",
        roleLabel > 0 ? "positive" : "negative",
        roleLabel,
        `${Math.round(roleLabel * 100)}% of role-and-label evidence overlaps.`,
      ),
    );
  if (semantic !== null)
    signals.push(
      signal(
        "semantic-overlap",
        semantic > 0 ? "positive" : "negative",
        semantic,
        `${Math.round(semantic * 100)}% of weighted visible semantics overlaps.`,
      ),
    );
  signals.push(
    signal(
      "structural-overlap",
      structural > 0 ? "positive" : "neutral",
      structural,
      `${Math.round(structural * 100)}% of visible role structure overlaps.`,
    ),
  );
  if (left.volatileSignals.length > 0 || right.volatileSignals.length > 0)
    signals.push(
      signal(
        "volatile-content-normalized",
        "neutral",
        1,
        "Volatile values were reduced to typed placeholders before comparison.",
      ),
    );
  if (stableAnchorConflict)
    signals.push(
      signal(
        "semantic-conflict",
        "negative",
        1 - confidence,
        "Stable identifiers or role-and-label anchors conflict.",
      ),
    );

  return {
    confidence,
    decision: confidence >= 0.72 ? "match" : confidence >= 0.52 ? "possible" : "different",
    signals,
  };
}

/** Rank known screens and decide whether an observation is existing, ambiguous, or new. */
export function resolveScreenIdentity<T extends ScreenIdentityCandidate>(
  observation: ScreenIdentityObservation,
  candidates: readonly T[],
  options: ScreenIdentityResolutionOptions = {},
): ScreenIdentityResolution<T> {
  const threshold = options.matchThreshold ?? 0.72;
  const ambiguityMargin = options.ambiguityMargin ?? 0.08;
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      comparison: compareScreenIdentity(observation, candidate.observation),
    }))
    .sort(
      (left, right) =>
        right.comparison.confidence - left.comparison.confidence ||
        left.candidate.id.localeCompare(right.candidate.id),
    );

  if (observation.nodes.length === 0) {
    return {
      kind: "new",
      ranked,
      reasons: [
        signal(
          "insufficient-evidence",
          "neutral",
          1,
          "The new observation has no visible semantics, so no existing screen can be selected safely.",
        ),
      ],
    };
  }
  const best = ranked[0];
  if (!best || best.comparison.confidence < threshold) {
    return {
      kind: "new",
      ranked,
      reasons: [
        signal(
          "semantic-conflict",
          "negative",
          best ? 1 - best.comparison.confidence : 1,
          best
            ? `No candidate reached the ${Math.round(threshold * 100)}% match threshold.`
            : "There are no existing screen candidates.",
        ),
      ],
    };
  }
  const second = ranked[1];
  if (
    second &&
    second.comparison.confidence >= threshold &&
    best.comparison.confidence - second.comparison.confidence < ambiguityMargin
  ) {
    return {
      kind: "ambiguous",
      ranked,
      reasons: [
        signal(
          "insufficient-evidence",
          "neutral",
          1,
          "Multiple existing screens are equally plausible; selecting one automatically would be unsafe.",
        ),
      ],
    };
  }
  return {
    kind: "existing",
    match: best,
    ranked,
    reasons: best.comparison.signals,
  };
}
