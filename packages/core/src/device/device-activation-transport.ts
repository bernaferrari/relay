/**
 * Activation-transport evidence for native actions.
 *
 * Semantic resolution and physical actuation are separate facts. A control
 * can resolve by identifier and still be activated through coordinates
 * derived from the accessibility tree — on iOS the runner is even permitted
 * to coordinate-activate non-hittable controls behind an otherwise semantic
 * press. Cached-action replay safety depends on knowing which actuations
 * depended on geometry, so every native input helper records how its one
 * physical actuation was transported before this evidence is aggregated into
 * per-run metrics.
 *
 * The journal is an in-memory per-target ledger, never a global counter:
 * persisted evidence lives in run artifacts, written by the callers that own
 * a step boundary. Records are only ever appended after a dispatch succeeded;
 * a rejected or outcome-unknown actuation has no transport fact to claim.
 */
import { currentTargetContext, type TargetContext } from "../target/target-context.js";

/**
 * How one physical actuation was transported, classified by geometry
 * provenance — the axis cached replay safety depends on:
 *
 * - `native-selector`: the platform resolved and activated the control
 *   on-device from a semantic selector. Relay supplied no geometry, though
 *   an iOS runner may still coordinate-activate a non-hittable control (see
 *   `coordinateFallbackPermitted` on the record).
 * - `selector-point-assisted`: a semantic selector carried a snapshot-derived
 *   point contribution (`expectedTapPoint`) the runner could fall back to.
 *   Whether geometry actuated is unknowable from Relay's side; the honest
 *   classification is that it may have.
 * - `snapshot-point`: actuation through a coordinate Relay derived from
 *   accessibility-tree geometry.
 * - `explicit-point`: actuation through a caller-supplied coordinate.
 * - `direct`: no geometry participated (key presses, directional scrolls,
 *   text insertion at the caret).
 */
export type ActivationTransport =
  | "native-selector"
  | "selector-point-assisted"
  | "snapshot-point"
  | "explicit-point"
  | "direct";

/** The physical wire an actuation was dispatched over. */
export type ActivationChannel = "daemon" | "listener" | "hid" | "adb";

export type ActivationOperation =
  | "press"
  | "long-press"
  | "fill"
  | "type"
  | "swipe"
  | "scroll"
  | "key"
  | "find";

/** The semantic path that located the target, when one participated. */
export type ActivationResolutionPath =
  | "identifier"
  | "ref"
  | "label"
  | "text"
  | "relation"
  | "point";

export type ActivationTransportRecord = {
  /** Monotonic per-target token; callers diff it around one logical action. */
  sequence: number;
  operation: ActivationOperation;
  transport: ActivationTransport;
  platform: "android" | "ios" | "browser";
  channel: ActivationChannel;
  /** Relay-supplied geometry participated (or may have participated) in the actuation. */
  pointContribution: boolean;
  /** The runner was explicitly allowed to coordinate-activate despite the selector. */
  coordinateFallbackPermitted: boolean;
  resolutionMethod?: ActivationResolutionPath;
  /** The actuation recovered from a semantic collision (a same-key match
   * had to be re-ranked against a fresh tree before a coordinate tap). */
  collisionRecovery?: boolean;
  at: number;
};

/**
 * The transport evidence attached to one logical action's resolution or
 * execution record. `transport` is the most geometry-dependent transport
 * among the action's actuations: a focus tap that needed geometry is not
 * laundered by the caret insertion that followed it.
 */
export type ActivationTransportEvidence = {
  transport: ActivationTransport;
  channel: ActivationChannel;
  pointContribution: boolean;
  coordinateFallbackPermitted: boolean;
  /** Physical actuations the evidence aggregates. Almost always one. */
  actuations: number;
  collisionRecovery?: boolean;
};

/** Geometry-dependence ordering for evidence dominance. Every point-involving
 * transport outranks selector/direct; a selector that merely allowed a point
 * fallback outranks transports provably free of geometry. */
const TRANSPORT_GEOMETRY_RANK: Record<ActivationTransport, number> = {
  "snapshot-point": 3,
  "explicit-point": 3,
  "selector-point-assisted": 2,
  "native-selector": 1,
  direct: 0,
};

/** Cache-replay safety derivation: did any geometry participate (or possibly
 * participate) in the actuation? The future cache writer keys off this bit;
 * it intentionally treats `selector-point-assisted` as geometry-dependent. */
export function activationTransportHasPointContribution(transport: ActivationTransport): boolean {
  return TRANSPORT_GEOMETRY_RANK[transport] >= 2;
}

export function activationEvidenceHasPointContribution(
  evidence: ActivationTransportEvidence,
): boolean {
  return evidence.pointContribution;
}

const ACTIVATION_JOURNAL_LIMIT = 200;

type ActivationJournal = {
  sequence: number;
  records: ActivationTransportRecord[];
};

const journalsByTarget = new Map<string, ActivationJournal>();

function targetKey(context: TargetContext | undefined): string {
  if (!context) return "unknown";
  switch (context.kind) {
    case "device":
      return `${context.platform}:${context.serial}`;
    case "browser":
      return `browser:${context.targetId}`;
    case "cloud":
      return `${context.platform}:${context.sessionId}`;
  }
}

function activationPlatform(context: TargetContext | undefined): "android" | "ios" | "browser" {
  if (!context) return "android";
  if (context.kind === "browser") return "browser";
  return context.platform;
}

function currentContextKey(): { key: string; platform: "android" | "ios" | "browser" } {
  let context: TargetContext | undefined;
  try {
    context = currentTargetContext();
  } catch {
    context = undefined;
  }
  return { key: targetKey(context), platform: activationPlatform(context) };
}

function journalFor(key: string): ActivationJournal {
  const existing = journalsByTarget.get(key);
  if (existing) return existing;
  const created = { sequence: 0, records: [] };
  journalsByTarget.set(key, created);
  return created;
}

/**
 * Append one physical actuation to the ambient target's journal. Call this
 * only after the dispatch is known to have succeeded; an input whose outcome
 * is unknown must not claim a transport it may never have used.
 */
export function noteActivationTransport(input: {
  operation: ActivationOperation;
  transport: ActivationTransport;
  channel: ActivationChannel;
  resolutionMethod?: ActivationResolutionPath;
  pointContribution?: boolean;
  coordinateFallbackPermitted?: boolean;
  collisionRecovery?: boolean;
  at?: number;
}): void {
  const { key, platform } = currentContextKey();
  const journal = journalFor(key);
  journal.sequence += 1;
  const record: ActivationTransportRecord = {
    sequence: journal.sequence,
    operation: input.operation,
    transport: input.transport,
    platform,
    channel: input.channel,
    pointContribution:
      input.pointContribution ?? activationTransportHasPointContribution(input.transport),
    coordinateFallbackPermitted: input.coordinateFallbackPermitted ?? false,
    ...(input.resolutionMethod ? { resolutionMethod: input.resolutionMethod } : {}),
    ...(input.collisionRecovery ? { collisionRecovery: true } : {}),
    at: input.at ?? Date.now(),
  };
  journal.records = [...journal.records, record].slice(-ACTIVATION_JOURNAL_LIMIT);
}

/** The current journal sequence of the ambient target, for diffing one
 * logical action: read before dispatch, then collect what landed after. */
export function activationTransportSequence(): number {
  const { key } = currentContextKey();
  return journalsByTarget.get(key)?.sequence ?? 0;
}

/**
 * Record a daemon selector actuation whose payload was built with the
 * non-hittable coordinate allowance (`iosNonHittablePressFields`). That helper
 * only attaches the allowance — and any snapshot-derived `expectedTapPoint` —
 * on iOS, so this recorder applies the same gate: on Android and browser
 * targets the selector travels alone no matter what was resolved locally.
 */
export function noteDaemonSelectorActuation(input: {
  operation: ActivationOperation;
  resolutionMethod?: ActivationResolutionPath;
  snapshotPoint?: { x: number; y: number };
}): void {
  const { platform } = currentContextKey();
  const ios = platform === "ios";
  noteActivationTransport({
    operation: input.operation,
    transport: ios && input.snapshotPoint ? "selector-point-assisted" : "native-selector",
    channel: "daemon",
    ...(input.resolutionMethod ? { resolutionMethod: input.resolutionMethod } : {}),
    coordinateFallbackPermitted: ios,
  });
}

/** Record one coordinate actuation with its provenance. `operation` widens
 * beyond presses for pans and long-presses; the provenance answer never changes. */
export function noteCoordinateActuation(input: {
  operation: ActivationOperation;
  provenance: "explicit-point" | "snapshot-point";
  channel: ActivationChannel;
  resolutionMethod?: ActivationResolutionPath;
  collisionRecovery?: boolean;
}): void {
  noteActivationTransport({
    operation: input.operation,
    transport: input.provenance,
    channel: input.channel,
    ...(input.resolutionMethod ? { resolutionMethod: input.resolutionMethod } : {}),
    ...(input.collisionRecovery ? { collisionRecovery: true } : {}),
  });
}

/** Record one geometry-free actuation: key presses, directional scrolls, and
 * caret text insertion never involve a coordinate. */
export function noteDirectActuation(
  operation: ActivationOperation,
  channel: ActivationChannel,
): void {
  noteActivationTransport({ operation, transport: "direct", channel });
}

/** Every actuation recorded on the ambient target after `sequence`. */
export function activationTransportsSince(sequence: number): ActivationTransportRecord[] {
  const { key } = currentContextKey();
  const journal = journalsByTarget.get(key);
  if (!journal) return [];
  return journal.records.filter((record) => record.sequence > sequence);
}

/** Aggregate one logical action's actuations into its transport evidence.
 * Defaults to the ambient target's whole journal. */
export function activationTransportEvidence(
  records: readonly ActivationTransportRecord[] = activationTransportsSince(0),
): ActivationTransportEvidence | undefined {
  if (records.length === 0) return undefined;
  const dominant = [...records].sort(
    (left, right) =>
      TRANSPORT_GEOMETRY_RANK[right.transport] - TRANSPORT_GEOMETRY_RANK[left.transport] ||
      left.sequence - right.sequence,
  )[0]!;
  return {
    transport: dominant.transport,
    channel: dominant.channel,
    pointContribution: records.some((record) => record.pointContribution),
    coordinateFallbackPermitted: records.some((record) => record.coordinateFallbackPermitted),
    actuations: records.length,
    ...(records.some((record) => record.collisionRecovery) ? { collisionRecovery: true } : {}),
  };
}

/** Diff helper for actuation boundaries: evidence for everything the ambient
 * target actuated after `sequence`, when anything landed at all. */
export function activationTransportEvidenceSince(
  sequence: number,
): ActivationTransportEvidence | undefined {
  return activationTransportEvidence(activationTransportsSince(sequence));
}

/** Test-only reset so journal assertions never leak across suites. */
export function resetActivationTransportJournalsForTests(): void {
  journalsByTarget.clear();
}
