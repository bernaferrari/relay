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
 * - `native-selector`: the control was resolved semantically at execution
 *   time and any actuation geometry was derived fresh during that execution;
 *   no geometry Relay captured earlier participated. This is intentionally
 *   not a claim about literal platform element actuation, which barely
 *   exists: the vendored daemon resolves selectors against its own fresh
 *   accessibility capture and taps the resulting point, the adopted iOS
 *   runner synthesizes touch at the live element frame, and even XCTest's
 *   element tap is an element-anchored coordinate. For replay safety those
 *   are equivalent — the resolution happens at execution time, so a changed
 *   screen resolves differently rather than hitting frozen geometry.
 * - `selector-point-assisted`: legacy classification, no longer produced.
 *   It was recorded when a selector dispatch carried a snapshot-derived
 *   `expectedTapPoint`, but the vendored daemon never reads that field on
 *   the press/fill paths Relay exercises — it is consumed only by the
 *   click-only direct-iOS runner route Relay does not use (verified against
 *   pinned vendor 0.21.45). The point could never actuate, so the "may
 *   have" classification was a knowable falsehood. The variant remains in
 *   the type only so artifacts persisted before the correction still parse.
 * - `snapshot-point`: actuation through a coordinate Relay derived from
 *   accessibility-tree geometry before dispatch.
 * - `explicit-point`: actuation through a caller-supplied coordinate.
 * - `direct`: no geometry participated (key presses, directional scrolls,
 *   text insertion at the caret).
 * - `unobserved`: an actuation happened but nothing evidences how it was
 *   transported — the daemon did not report an actuation outcome (older or
 *   skewed peer), or the report's geometry fact was itself unknown. Never
 *   reads as a purer classification: for replay safety it ranks with the
 *   "may have participated" middle.
 */
export type ActivationTransport =
  | "native-selector"
  | "selector-point-assisted"
  | "snapshot-point"
  | "explicit-point"
  | "direct"
  | "unobserved";

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
  /** The dispatch carried the non-hittable coordinate allowance: the daemon may
   * actuate the resolved point for a control its probe marks non-hittable (SwiftUI
   * rows) instead of refusing. On the daemon path actuation is always coordinate
   * actuation; this bit records that the hittability refusal was relaxed. */
  coordinateFallbackPermitted: boolean;
  resolutionMethod?: ActivationResolutionPath;
  /** The actuation recovered from a semantic collision (a same-key match
   * had to be re-ranked against a fresh tree before a coordinate tap). */
  collisionRecovery?: boolean;
  /** The daemon-reported actuation outcome facts, when the peer reported
   * them (actuation-outcome reporting, vendored `actuation` object). Raw
   * axes are preserved verbatim; the transport classification above is the
   * conservative derivation replay safety reads. */
  actuationTargeting?: string;
  actuationGeometry?: string;
  actuationExecutor?: string;
  actuationExecutorDetail?: string;
  actuationCoordinateFallbackReason?: string;
  actuationCoordinateFallbackDetail?: string;
  actuationMechanismFallbackReason?: string;
  actuationMechanismFallbackDetail?: string;
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
  unobserved: 2,
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
  actuationTargeting?: string;
  actuationGeometry?: string;
  actuationExecutor?: string;
  actuationExecutorDetail?: string;
  actuationCoordinateFallbackReason?: string;
  actuationCoordinateFallbackDetail?: string;
  actuationMechanismFallbackReason?: string;
  actuationMechanismFallbackDetail?: string;
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
    ...(input.actuationTargeting ? { actuationTargeting: input.actuationTargeting } : {}),
    ...(input.actuationGeometry ? { actuationGeometry: input.actuationGeometry } : {}),
    ...(input.actuationExecutor ? { actuationExecutor: input.actuationExecutor } : {}),
    ...(input.actuationExecutorDetail
      ? { actuationExecutorDetail: input.actuationExecutorDetail }
      : {}),
    ...(input.actuationCoordinateFallbackReason
      ? { actuationCoordinateFallbackReason: input.actuationCoordinateFallbackReason }
      : {}),
    ...(input.actuationCoordinateFallbackDetail
      ? { actuationCoordinateFallbackDetail: input.actuationCoordinateFallbackDetail }
      : {}),
    ...(input.actuationMechanismFallbackReason
      ? { actuationMechanismFallbackReason: input.actuationMechanismFallbackReason }
      : {}),
    ...(input.actuationMechanismFallbackDetail
      ? { actuationMechanismFallbackDetail: input.actuationMechanismFallbackDetail }
      : {}),
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
 * The daemon's actuation outcome report, parsed defensively off a press/fill
 * success response. Anything malformed or absent reads as unreported — skew
 * in either direction must never throw and never upgrade purity.
 */
export type DaemonActuationReport = {
  targeting?: string;
  geometry?: string;
  executor?: string;
  executorDetail?: string;
  coordinateFallbackReason?: string;
  coordinateFallbackDetail?: string;
  mechanismFallbackReason?: string;
  mechanismFallbackDetail?: string;
};

/** Parse the additive `actuation` object off a daemon interaction response.
 * Unknown future versions still parse their v1-shaped fields; fields that
 * are missing or mistyped are simply absent. */
export function parseDaemonActuationReport(value: unknown): DaemonActuationReport | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const readFallback = (raw: unknown): { reason: string; detail?: string } | undefined => {
    if (!raw || typeof raw !== "object") return undefined;
    const fallback = raw as Record<string, unknown>;
    const reason = fallback.reason;
    if (typeof reason !== "string" || reason.length === 0) return undefined;
    const detail = fallback.detail;
    return {
      reason,
      ...(typeof detail === "string" && detail.length > 0 ? { detail } : {}),
    };
  };
  const readAxis = (raw: unknown): string | undefined =>
    typeof raw === "string" && raw.length > 0 ? raw : undefined;
  const targeting = readAxis(candidate.targeting);
  const geometry = readAxis(candidate.geometry);
  const executor = readAxis(candidate.executor);
  const executorDetail = readAxis(candidate.executorDetail);
  const coordinateFallback = readFallback(candidate.coordinateFallback);
  const mechanismFallback = readFallback(candidate.mechanismFallback);
  const report: DaemonActuationReport = {
    ...(targeting ? { targeting } : {}),
    ...(geometry ? { geometry } : {}),
    ...(executor ? { executor } : {}),
    ...(executorDetail ? { executorDetail } : {}),
    ...(coordinateFallback
      ? {
          coordinateFallbackReason: coordinateFallback.reason,
          ...(coordinateFallback.detail
            ? { coordinateFallbackDetail: coordinateFallback.detail }
            : {}),
        }
      : {}),
    ...(mechanismFallback
      ? {
          mechanismFallbackReason: mechanismFallback.reason,
          ...(mechanismFallback.detail
            ? { mechanismFallbackDetail: mechanismFallback.detail }
            : {}),
        }
      : {}),
  };
  return Object.keys(report).length > 0 ? report : undefined;
}

/**
 * Map the reported axes into the transport taxonomy. Only execution-time
 * geometry earns `native-selector`; externally frozen geometry is the point
 * transport its provenance describes; anything unknown stays unobserved.
 */
function transportForDaemonActuation(report: DaemonActuationReport): ActivationTransport {
  if (report.targeting === "direct" && report.geometry === "none") return "direct";
  if (report.targeting === "element") {
    switch (report.geometry) {
      case "daemon-snapshot":
      case "runner-element-frame":
      case "provider-element":
      case "none":
        return "native-selector";
      case "relay-snapshot":
      case "runner-expected-point":
        return "snapshot-point";
      case "caller-point":
        return "explicit-point";
      default:
        return "unobserved";
    }
  }
  if (report.targeting === "point") {
    // A numeric input fully involved its geometry; Relay cannot tell its own
    // derived points from caller-supplied ones on this axis, so the answer is
    // the geometry-dependent classification either way.
    return report.geometry === "caller-point" || report.geometry === "relay-snapshot"
      ? "snapshot-point"
      : "unobserved";
  }
  return "unobserved";
}

/** The raw actuation fields a journal record preserves; no classification happens here. */
function actuationReportFields(report: DaemonActuationReport | undefined): Partial<{
  actuationTargeting: string;
  actuationGeometry: string;
  actuationExecutor: string;
  actuationExecutorDetail: string;
  actuationCoordinateFallbackReason: string;
  actuationCoordinateFallbackDetail: string;
  actuationMechanismFallbackReason: string;
  actuationMechanismFallbackDetail: string;
}> {
  if (!report) return {};
  return {
    ...(report.targeting ? { actuationTargeting: report.targeting } : {}),
    ...(report.geometry ? { actuationGeometry: report.geometry } : {}),
    ...(report.executor ? { actuationExecutor: report.executor } : {}),
    ...(report.executorDetail ? { actuationExecutorDetail: report.executorDetail } : {}),
    ...(report.coordinateFallbackReason
      ? { actuationCoordinateFallbackReason: report.coordinateFallbackReason }
      : {}),
    ...(report.coordinateFallbackDetail
      ? { actuationCoordinateFallbackDetail: report.coordinateFallbackDetail }
      : {}),
    ...(report.mechanismFallbackReason
      ? { actuationMechanismFallbackReason: report.mechanismFallbackReason }
      : {}),
    ...(report.mechanismFallbackDetail
      ? { actuationMechanismFallbackDetail: report.mechanismFallbackDetail }
      : {}),
  };
}

/**
 * Record a daemon-mediated selector actuation whose payload was built with
 * the non-hittable coordinate allowance (`iosNonHittablePressFields`). When
 * the daemon reported its actuation outcome (the additive `actuation` object
 * on the success response), the reported axes decide the transport:
 * execution-time geometry (`daemon-snapshot` and kin) is `native-selector`,
 * externally frozen geometry is the point transport its provenance describes.
 * An absent or geometry-unknown report records `unobserved` — never a purer
 * classification than the evidence earns.
 */
export function noteDaemonSelectorActuation(input: {
  operation: ActivationOperation;
  resolutionMethod?: ActivationResolutionPath;
  /** The raw `actuation` value off the daemon success response, when one came back. */
  actuation?: unknown;
  /** Whether the dispatch carried the non-hittable coordinate allowance. The
   * legacy press/fill callers do, so the default preserves that existing fact. */
  coordinateFallbackPermitted?: boolean;
}): void {
  noteReportedSelectorActuation({ ...input, channel: "daemon" });
}

/**
 * Record a selector actuation dispatched through the adopted Apple runner
 * listener. The same daemon report parser is intentional: the listener speaks
 * the runner response shape directly, and an old runner that omits the object
 * is skew evidence for `unobserved`, never proof that a semantic element
 * mechanism ran.
 */
export function noteListenerSelectorActuation(input: {
  operation: ActivationOperation;
  resolutionMethod?: ActivationResolutionPath;
  /** The raw `actuation` value off the runner success payload, when one came back. */
  actuation?: unknown;
  coordinateFallbackPermitted?: boolean;
}): void {
  noteReportedSelectorActuation({ ...input, channel: "listener" });
}

function noteReportedSelectorActuation(input: {
  operation: ActivationOperation;
  resolutionMethod?: ActivationResolutionPath;
  actuation?: unknown;
  coordinateFallbackPermitted?: boolean;
  channel: "daemon" | "listener";
}): void {
  const { platform } = currentContextKey();
  const report = parseDaemonActuationReport(input.actuation);
  // Relay owns the fact that this dispatch was selector-targeted. A skewed peer
  // must not retarget it as direct/numeric and thereby launder geometry away;
  // contradiction reads as unobserved while the raw axes remain on the record.
  const contradictsSelectorTargeting =
    report?.targeting !== undefined && report.targeting !== "element";
  noteActivationTransport({
    operation: input.operation,
    transport:
      report && !contradictsSelectorTargeting ? transportForDaemonActuation(report) : "unobserved",
    channel: input.channel,
    ...(input.resolutionMethod ? { resolutionMethod: input.resolutionMethod } : {}),
    coordinateFallbackPermitted: input.coordinateFallbackPermitted ?? platform === "ios",
    ...actuationReportFields(report),
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
  coordinateFallbackPermitted?: boolean;
  /** The raw actuation outcome report the executor returned, when one came back. */
  actuation?: unknown;
}): void {
  const report = parseDaemonActuationReport(input.actuation);
  noteActivationTransport({
    operation: input.operation,
    transport: input.provenance,
    channel: input.channel,
    ...(input.resolutionMethod ? { resolutionMethod: input.resolutionMethod } : {}),
    ...(input.collisionRecovery ? { collisionRecovery: true } : {}),
    coordinateFallbackPermitted: input.coordinateFallbackPermitted ?? false,
    ...actuationReportFields(report),
  });
}

/** Record one geometry-free actuation: key presses, directional scrolls, and
 * caret text insertion never involve a coordinate. */
export function noteDirectActuation(
  operation: ActivationOperation,
  channel: ActivationChannel,
  actuation?: unknown,
): void {
  const report = parseDaemonActuationReport(actuation);
  noteActivationTransport({
    operation,
    transport: "direct",
    channel,
    ...actuationReportFields(report),
  });
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
