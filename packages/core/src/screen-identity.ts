import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import type {
  NormalizedSemanticNode,
  ScreenIdentityObservation,
  SemanticField,
  VolatileSemanticKind,
} from "@relay/protocol";
import type { SnapshotNode } from "./device.js";

export type {
  NormalizedSemanticNode,
  ScreenIdentityObservation,
  SemanticField,
  VolatileSemanticKind,
  VolatileSemanticSignal,
} from "@relay/protocol";

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

const SYSTEM_INPUT_IDENTIFIER =
  /^(?:systeminputassistantview|centerpageview|leftbuttonbar|assistant(?:paste:forevent:|undo|redo))$/iu;

function systemInputIndexes(nodes: readonly SnapshotNode[]): Set<number> {
  const indexed = new Map(
    nodes.flatMap((node, offset) =>
      node.index === undefined ? [] : [[node.index, { node, offset }] as const],
    ),
  );
  const children = new Map<number, number[]>();
  for (const node of nodes) {
    if (node.index === undefined || node.parentIndex === undefined) continue;
    const siblings = children.get(node.parentIndex) ?? [];
    siblings.push(node.index);
    children.set(node.parentIndex, siblings);
  }
  const roots = nodes.flatMap((node) =>
    node.index !== undefined &&
    (/^keyboard$/iu.test(node.type ?? node.role ?? "") ||
      SYSTEM_INPUT_IDENTIFIER.test(node.identifier ?? ""))
      ? [node.index]
      : [],
  );
  const ignored = new Set<number>();
  const visit = (index: number): void => {
    if (ignored.has(index)) return;
    ignored.add(index);
    for (const child of children.get(index) ?? []) visit(child);
  };
  for (const root of roots) {
    visit(root);
    // XCTest wraps the Keyboard in an unlabeled/generic container. Exclude
    // that wrapper only when the keyboard is its sole child.
    const parentIndex = indexed.get(root)?.node.parentIndex;
    const parent = parentIndex === undefined ? undefined : indexed.get(parentIndex)?.node;
    if (
      parentIndex !== undefined &&
      parent &&
      /^other$/iu.test(parent.type ?? parent.role ?? "") &&
      (children.get(parentIndex)?.length ?? 0) === 1
    ) {
      ignored.add(parentIndex);
    }
  }
  return ignored;
}

function withoutSystemInputObservation(
  observation: ScreenIdentityObservation,
): ScreenIdentityObservation {
  const hasSystemInput = observation.nodes.some(
    (node) =>
      /^(?:keyboard|key)$/u.test(node.role) ||
      SYSTEM_INPUT_IDENTIFIER.test(node.identifier ?? "") ||
      node.label === "typing predictions" ||
      node.label === "next keyboard",
  );
  if (!hasSystemInput) return observation;

  const retained = observation.nodes.flatMap((node, index) => {
    const systemRole = /^(?:keyboard|key)$/u.test(node.role);
    const systemIdentifier = SYSTEM_INPUT_IDENTIFIER.test(node.identifier ?? "");
    const systemLabel =
      node.label === "typing predictions" ||
      node.label === "next keyboard" ||
      (/^(?:other|button)$/u.test(node.role) && /^(?:undo|redo|paste)$/u.test(node.label ?? ""));
    return systemRole || systemIdentifier || systemLabel ? [] : [{ node, oldIndex: index }];
  });
  const indexByOld = new Map(retained.map((entry, index) => [entry.oldIndex, index]));
  const nodes = retained.map((entry) => entry.node);
  const volatileSignals = observation.volatileSignals.flatMap((item) => {
    const node = indexByOld.get(item.node);
    return node === undefined ? [] : [{ ...item, node }];
  });
  return {
    fingerprint: digest(`relay-screen-identity:v1:${nodes.map(canonicalNode).join("\n")}`),
    nodes,
    volatileSignals,
  };
}

/**
 * Produces a stable visual identity for screens that expose no useful native
 * semantics (custom canvases, games, system surfaces, or temporarily broken
 * accessibility bridges). A difference hash is deliberately used instead of
 * the PNG bytes: compression, colour shifts, and the clock should not turn the
 * same screen into a new node. The system bars are excluded because their
 * changing time, battery, and gesture hints describe the device, not the app.
 */
export function observeVisualScreenFingerprint(png: Uint8Array): string | undefined {
  let image: PNG;
  try {
    image = PNG.sync.read(Buffer.from(png));
  } catch {
    return undefined;
  }
  if (image.width < 17 || image.height < 20) return undefined;

  const left = 0;
  // Keep trailing page actions (Scan/Stop, Save, overflow menus) outside the
  // identity band. They often change while the user remains on one screen.
  const right = Math.max(1, Math.ceil(image.width * 0.42));
  const top = Math.floor(image.height * 0.06);
  // Screen chrome is far more stable than body content: lists reorder, feeds
  // refresh, and illustrations animate. The upper identity band retains the
  // title and leading icon while excluding those expected variations.
  const bottom = Math.max(top + 1, Math.ceil(image.height * 0.18));
  const luma = (sampleX: number, sampleY: number): number => {
    const x = Math.max(0, Math.min(image.width - 1, sampleX));
    const y = Math.max(0, Math.min(image.height - 1, sampleY));
    const offset = (y * image.width + x) * 4;
    const alpha = image.data[offset + 3]! / 255;
    const red = image.data[offset]! * alpha + 255 * (1 - alpha);
    const green = image.data[offset + 1]! * alpha + 255 * (1 - alpha);
    const blue = image.data[offset + 2]! * alpha + 255 * (1 - alpha);
    return red * 0.299 + green * 0.587 + blue * 0.114;
  };
  const sample = (column: number, row: number, columns: number, rows: number): number =>
    luma(
      Math.floor(left + ((column + 0.5) / columns) * (right - left)),
      Math.floor(top + ((row + 0.5) / rows) * (bottom - top)),
    );

  let bits = "";
  for (let row = 0; row < 16; row++) {
    for (let column = 0; column < 16; column++) {
      bits += sample(column, row, 17, 16) > sample(column + 1, row, 17, 16) ? "1" : "0";
    }
  }
  for (let row = 0; row < 16; row++) {
    for (let column = 0; column < 16; column++) {
      bits += sample(column, row, 16, 17) > sample(column, row + 1, 16, 17) ? "1" : "0";
    }
  }
  // A title alone is not unique: detail screens frequently share the same
  // back-button chrome. Add a coarse app-body signature so visually distinct
  // destinations cannot collapse into one node. This remains a fallback for
  // screens without stable native semantics, not a replacement for them.
  const bodyLeft = Math.floor(image.width * 0.04);
  const bodyRight = Math.max(bodyLeft + 1, Math.ceil(image.width * 0.96));
  const bodyTop = Math.floor(image.height * 0.2);
  const bodyBottom = Math.max(bodyTop + 1, Math.ceil(image.height * 0.9));
  const bodySample = (column: number, row: number, columns: number, rows: number): number =>
    luma(
      Math.floor(bodyLeft + ((column + 0.5) / columns) * (bodyRight - bodyLeft)),
      Math.floor(bodyTop + ((row + 0.5) / rows) * (bodyBottom - bodyTop)),
    );
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      bits += bodySample(column, row, 9, 8) > bodySample(column + 1, row, 9, 8) ? "1" : "0";
      bits += bodySample(column, row, 8, 9) > bodySample(column, row + 1, 8, 9) ? "1" : "0";
    }
  }
  return digest(`relay-screen-visual:v1:${bits}`);
}

/**
 * Converts a native accessibility snapshot into stable, visible semantics.
 * Geometry, references, traversal indexes, and screenshots are intentionally
 * excluded: they are observations of a screen, not its identity.
 */
export function observeScreenIdentity(nodes: readonly SnapshotNode[]): ScreenIdentityObservation {
  const ignoredSystemInput = systemInputIndexes(nodes);
  const applicationNodes = nodes.filter(
    (node) =>
      node.bundleId !== "com.android.systemui" &&
      !/^(?:com\.google\.android\.inputmethod\.latin|com\.samsung\.android\.honeyboard|com\.touchtype\.swiftkey)$/u.test(
        node.bundleId ?? "",
      ),
  );
  // Status bars, navigation bars, notifications, and keyboards are device
  // state, not application-screen identity. Preserve all nodes for providers
  // that do not expose package ownership.
  const identityNodes = applicationNodes.some((node) => node.bundleId) ? applicationNodes : nodes;
  const entries = nodes
    .filter((node) => identityNodes.includes(node))
    .filter((node) => node.index === undefined || !ignoredSystemInput.has(node.index))
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

const LOCALIZED_STRING_KEY = /^LocalizedStringKey\(key: "([^"]+)"/u;

/** Extract a SwiftUI LocalizedStringKey symbolic key when the a11y label carries one. */
export function stableLabelKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const key = LOCALIZED_STRING_KEY.exec(value)?.[1]?.trim();
  return key || undefined;
}

/**
 * Locale-stable structural identity for i18n corpus.
 * Uses role + accessibility identifier + LocalizedStringKey when present.
 * Visible localized labels and values are intentionally excluded so the same
 * Settings page collapses across languages.
 */
export function observeLocaleStableIdentity(
  nodes: readonly SnapshotNode[],
): ScreenIdentityObservation {
  const ignoredSystemInput = systemInputIndexes(nodes);
  const applicationNodes = nodes.filter(
    (node) =>
      node.bundleId !== "com.android.systemui" &&
      !/^(?:com\.google\.android\.inputmethod\.latin|com\.samsung\.android\.honeyboard|com\.touchtype\.swiftkey)$/u.test(
        node.bundleId ?? "",
      ),
  );
  const identityNodes = applicationNodes.some((node) => node.bundleId) ? applicationNodes : nodes;
  const entries = nodes
    .filter((node) => identityNodes.includes(node))
    .filter((node) => node.index === undefined || !ignoredSystemInput.has(node.index))
    .filter((node) => node.visibleToUser !== false)
    .flatMap((node) => {
      const role = normalizeText(node.role ?? node.type, "label").value;
      const identifier = normalizeText(node.identifier, "identifier").value;
      const key = stableLabelKey(node.label) ?? stableLabelKey(node.value);
      if (!role && !identifier && !key) return [];
      // Only keep nodes that contribute structural anchors. Pure localized copy
      // (label without id/key) is dropped so language changes do not re-key screens.
      if (!identifier && !key) return [];
      return [
        {
          node: {
            role,
            ...(identifier ? { identifier } : {}),
            ...(key ? { label: key } : {}),
            ...(node.enabled !== undefined ? { enabled: node.enabled } : {}),
            ...(node.selected !== undefined ? { selected: node.selected } : {}),
          } satisfies NormalizedSemanticNode,
        },
      ];
    })
    .sort((left, right) => canonicalNode(left.node).localeCompare(canonicalNode(right.node)));
  const normalized = entries.map((entry) => entry.node);
  return {
    fingerprint: digest(
      `relay-locale-stable-identity:v1:${normalized.map(canonicalNode).join("\n")}`,
    ),
    nodes: normalized,
    volatileSignals: [],
  };
}

/** Stable control key for one interactive node across locales. */
export function corpusControlStableKey(node: {
  identifier?: string;
  label?: string;
  value?: string;
  role?: string;
  type?: string;
}): string {
  const identifier = node.identifier?.trim();
  if (identifier) return `id:${identifier.toLocaleLowerCase()}`;
  const key = stableLabelKey(node.label) ?? stableLabelKey(node.value);
  if (key) return `key:${key.toLocaleLowerCase()}`;
  const role = (node.role ?? node.type ?? "control").trim().toLocaleLowerCase() || "control";
  const label = (node.label ?? node.value ?? "").trim().toLocaleLowerCase();
  // Last resort: role+label — locale-bound, but still useful within one pass.
  return `label:${role}:${label}`;
}

export function slugCorpusPathSegment(value: string): string {
  const key = stableLabelKey(value) ?? value;
  const slug = key
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "screen";
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
  left = withoutSystemInputObservation(left);
  right = withoutSystemInputObservation(right);
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
