/**
 * AI-assisted repair PROPOSALS for destination mismatches.
 *
 * When a run step arrives at a screen that does not match its
 * `expectedDestination`, this module asks the swappable Grounder to suggest
 * which App Map screen was actually observed. The output is strictly advisory:
 * it never mutates the App Map, never retries navigation, and never rewrites
 * steps. Proposals surface through the existing failure/proposal channel for
 * human or agent review.
 */
import type {
  AppMap,
  ScreenIdentityObservation,
} from "@relay/protocol";
import { StubVisionGrounder, type Grounder } from "./grounding.js";
import type { SnapshotNode } from "./device.js";
import {
  observeScreenIdentity,
  resolveScreenIdentity,
} from "./screen-identity.js";

/** Evidence captured by the failing step: what was expected and what was
 * actually observed. Mirrors the `destination-repair-hint` artifact data. */
export type DestinationRepairHint = {
  expectedScreenId: string;
  expectedScreenTitle?: string;
  expectedFingerprint?: string;
  observedFingerprint?: string;
  observedScreenTitle?: string;
  resolutionMethod?: string;
  /** Frozen evidence references for later human review. */
  evidence?: {
    framePath?: string;
    nodeCount?: number;
  };
};

/** Read-only access to fresh device observation evidence. Accessors stay
 * lazy so proposal generation never forces a capture the caller lacks. */
export type DeviceObservationAccess = {
  nodes?: () => Promise<SnapshotNode[] | undefined>;
  screenshotBase64?: () => Promise<string | undefined>;
};

/** The only App Map state proposal generation reads. Structural, so callers
 * can pass a full App Map or any read-only projection of one. */
export type RepairMapSource = Pick<AppMap, "screens" | "screenVariants">;

export type RepairProposalMethod = "fingerprint" | "semantic" | "vision";

/** One review-only suggestion. Nothing here is applied anywhere. */
export type RepairProposal = {
  candidateScreenId: string;
  /** 0..1 explainable match confidence; proposals arrive sorted descending. */
  confidence: number;
  rationale: string;
  method: RepairProposalMethod;
};

export type ProposeRepairResult =
  | { available: true; proposals: RepairProposal[] }
  | { available: false; proposals: []; reason: "grounding-unavailable" };

const MIN_SEMANTIC_CONFIDENCE = 0.3;

type ScreenFingerprints = Map<string, Set<string>>;

/**
 * Collect every approved fingerprint per screen id: the reviewed identity,
 * its aliases, and each Variant's normalized observation. Reads only; the
 * map object is never written.
 */
function screenFingerprints(
  map: RepairMapSource,
): ScreenFingerprints {
  const index: ScreenFingerprints = new Map();
  const add = (screenId: string, fingerprint: string | undefined): void => {
    if (!fingerprint) return;
    const known = index.get(screenId) ?? new Set<string>();
    known.add(fingerprint);
    index.set(screenId, known);
  };
  for (const screen of Object.values(map.screens)) {
    add(screen.id, screen.identity?.fingerprint);
    for (const alias of screen.identity?.aliases ?? []) add(screen.id, alias);
    for (const variantId of screen.variantIds) {
      add(screen.id, map.screenVariants[variantId]?.observation?.fingerprint);
    }
  }
  return index;
}

/** Exact fingerprint agreement is the strongest possible proposal. */
function fingerprintProposals(
  observedFingerprint: string | undefined,
  fingerprints: ScreenFingerprints,
): RepairProposal[] {
  if (!observedFingerprint) return [];
  const matches: RepairProposal[] = [];
  for (const [screenId, known] of [...fingerprints.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!known.has(observedFingerprint)) continue;
    matches.push({
      candidateScreenId: screenId,
      confidence: 1,
      method: "fingerprint",
      rationale: `The observed fingerprint matches a reviewed identity or variant of “${screenId}”.`,
    });
  }
  return matches;
}

/**
 * Explainable semantic ranking against every Variant observation. A screen
 * without any saved observation cannot participate in semantic matching; it
 * can still win through fingerprints or vision.
 */
function semanticProposals(
  map: RepairMapSource,
  observedNodes: SnapshotNode[],
): RepairProposal[] {
  if (!observedNodes.length) return [];
  const observed = observeScreenIdentity(observedNodes);
  const candidates = Object.values(map.screenVariants)
    .flatMap((variant) =>
      variant.observation && map.screens[variant.screenId]
        ? [{ id: variant.screenId, observation: variant.observation }]
        : [],
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!candidates.length) return [];
  const resolution = resolveScreenIdentity(observed, candidates);
  return resolution.ranked
    .filter((ranked) => ranked.comparison.confidence >= MIN_SEMANTIC_CONFIDENCE)
    .map((ranked) => ({
      candidateScreenId: ranked.candidate.id,
      confidence: ranked.comparison.confidence,
      method: "semantic" as const,
      rationale:
        ranked.comparison.signals.map((signal) => signal.detail).join(" ") ||
        `Semantic overlap with “${ranked.candidate.id}”.`,
    }));
}

/**
 * Ask the vision grounder which mapped screen title best matches the pixels.
 * Only invoked with a non-stub grounder; a miss or outage simply yields
 * nothing — never an error.
 */
async function visionProposals(
  grounder: Grounder,
  hint: DestinationRepairHint,
  map: RepairMapSource,
  access: DeviceObservationAccess,
  observedNodes: SnapshotNode[],
): Promise<RepairProposal[]> {
  const screenshotBase64 = await access.screenshotBase64?.().catch(() => undefined);
  if (!screenshotBase64) return [];
  const titles = [...new Set(Object.values(map.screens).map((screen) => screen.title))]
    .filter((title) => title.trim())
    .sort();
  if (!titles.length) return [];
  const candidates = observedNodes
    .filter((node) => node.label && node.visibleToUser !== false)
    .slice(0, 40)
    .map((node) => ({ label: node.label! }));
  try {
    const hit = await grounder.groundVision({
      target:
        `The device shows an unexpected screen instead of the expected ` +
        `“${hint.expectedScreenTitle ?? hint.expectedScreenId}”. ` +
        `Which of these App Map screen names does it look like: ${titles.join(", ")}?`,
      screenshotBase64,
      candidates,
    });
    const label =
      hit?.interaction.kind === "label"
        ? hit.interaction.label
        : hit?.interaction.kind === "identifier"
          ? hit.interaction.identifier
          : undefined;
    if (!hit || !label) return [];
    const normalized = label.trim().toLocaleLowerCase();
    const matched = Object.values(map.screens).find(
      (screen) => screen.title.trim().toLocaleLowerCase() === normalized,
    );
    if (!matched) return [];
    return [
      {
        candidateScreenId: matched.id,
        confidence: Math.min(Math.max(hit.confidence, 0), 1),
        method: "vision",
        rationale: `Vision identified the observed screen as “${matched.title}”.`,
      },
    ];
  } catch {
    // A vision outage must degrade to fewer proposals, never an error.
    return [];
  }
}

/**
 * Propose which mapped App Map screen the device actually showed when a run
 * step failed its expected destination. Proposal-only: this function performs
 * no App Map mutation, no navigation retry, and no step rewrite. A stub or
 * missing grounder yields zero proposals with reason "grounding-unavailable".
 */
export async function proposeRepair(input: {
  failure: DestinationRepairHint;
  map: RepairMapSource;
  grounder?: Grounder;
  observationAccess?: DeviceObservationAccess;
}): Promise<ProposeRepairResult> {
  const grounder = input.grounder;
  if (!grounder || grounder instanceof StubVisionGrounder) {
    return { available: false, proposals: [], reason: "grounding-unavailable" };
  }

  // Prefer already-captured evidence; fall back to one fresh semantic read.
  let observedNodes: SnapshotNode[] = [];
  try {
    observedNodes = (await input.observationAccess?.nodes?.()) ?? [];
  } catch {
    observedNodes = [];
  }

  const bestByScreen = new Map<string, RepairProposal>();
  const merge = (proposal: RepairProposal): void => {
    const existing = bestByScreen.get(proposal.candidateScreenId);
    if (!existing || existing.confidence < proposal.confidence) {
      bestByScreen.set(proposal.candidateScreenId, proposal);
    }
  };
  for (const proposal of fingerprintProposals(
    input.failure.observedFingerprint,
    screenFingerprints(input.map),
  ))
    merge(proposal);
  for (const proposal of semanticProposals(input.map, observedNodes)) merge(proposal);
  for (const proposal of await visionProposals(
    grounder,
    input.failure,
    input.map,
    input.observationAccess ?? {},
    observedNodes,
  ))
    merge(proposal);

  const proposals = [...bestByScreen.values()].sort(
    (left, right) =>
      right.confidence - left.confidence ||
      left.candidateScreenId.localeCompare(right.candidateScreenId) ||
      left.method.localeCompare(right.method),
  );
  return { available: true, proposals };
}
