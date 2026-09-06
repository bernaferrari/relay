/**
 * First-viewport checks for plan-tab paywalls.
 *
 * A tab change can leave the card mid-crossfade: the tree may already show
 * the new plan while pixels still mix the previous one, or the tree itself
 * may list two plans' feature rows. Survey must not start from that state.
 */
import type { SnapshotNode } from "./device.js";
import type { SnapshotPayload } from "./workspace-capture.js";
import { isSystemSemantic, normalizedSemanticPart } from "./scrollable-survey-seams.js";

export const PAYWALL_PLANS = ["Lite", "SuperGrok", "Plus", "Heavy"] as const;
export type PaywallPlan = (typeof PAYWALL_PLANS)[number];

export type PaywallFirstFrameVerdict =
  | { kind: "ok"; plan: PaywallPlan }
  | { kind: "not-paywall" }
  | { kind: "mixed-plans"; plans: PaywallPlan[]; labels: string[] }
  | { kind: "plan-mismatch"; selected: PaywallPlan; featurePlan: PaywallPlan; labels: string[] };

export type SurveyPaywallFrameDecision =
  | { kind: "accept" }
  | { kind: "reject"; reason: "mixed-plan" | "wrong-plan" };

const TAB_BAND_MAX_Y = 640;
const TITLE_MAX_Y = 900;

const PLAN_FEATURE_MARKERS: Record<PaywallPlan, RegExp[]> = {
  Lite: [
    /\baccess to grok build\b/u,
    /\b2x longer conversations\b/u,
    /\bincreased limits at regular speed\b/u,
    /\btry out ai image\b/u,
    /^expert mode$/u,
    /\bkeep chatting with basic access\b/u,
    /تقدر تستخدم grok build/u,
    /حدود أعلى بنفس السرعة/u,
    /محادثات أطول بمرتين/u,
  ],
  SuperGrok: [
    /\beverything in lite\b/u,
    /\b5x longer conversations\b/u,
    /\bsmarter answers in expert mode\b/u,
    /\bmake stunning ai images\b/u,
    /\bgrok imagine\b/u,
    /world'?s smartest/u,
    /\blonger voice conversations\b/u,
    /\bfaster replies\b/u,
    /\bmore powerful coding tools\b/u,
  ],
  Plus: [
    /\beverything in supergrok\b(?! plus)/u,
    /\bcreate 1080p videos\b/u,
    /\bchat, imagine, voice/u,
    /\blightning-fast replies\b/u,
    /\bpriority access at peak times\b/u,
    /\bearly access to new features\b/u,
  ],
  Heavy: [
    /\beverything in supergrok plus\b/u,
    /\bhighest usage at the fastest speed\b/u,
    /\bsolve extremely hard problems\b/u,
    /\bmost powerful intelligence\b/u,
    /\bx premium\+/u,
    /\bearliest access to new products/u,
  ],
};

function labelOf(node: SnapshotNode): string {
  return node.label?.trim() ?? "";
}

function isPlanName(label: string): label is PaywallPlan {
  return (PAYWALL_PLANS as readonly string[]).includes(label);
}

function planFromTabLabel(label: string): PaywallPlan | undefined {
  const normalized = normalizedSemanticPart(label);
  if (normalized === "lite") return "Lite";
  if (normalized === "plus") return "Plus";
  if (normalized === "heavy") return "Heavy";
  if (/^super\s*grok$/u.test(normalized)) return "SuperGrok";
  return undefined;
}

function nodeContains(outer: SnapshotNode, inner: SnapshotNode): boolean {
  if (!outer.rect || !inner.rect || outer === inner) return false;
  return (
    outer.rect.x <= inner.rect.x + 2 &&
    outer.rect.y <= inner.rect.y + 2 &&
    outer.rect.x + outer.rect.width + 2 >= inner.rect.x + inner.rect.width &&
    outer.rect.y + outer.rect.height + 2 >= inner.rect.y + inner.rect.height
  );
}

export function surveyPaywallPlanTabs(
  snapshot: SnapshotPayload,
): Partial<Record<PaywallPlan, SnapshotNode>> {
  const found = new Map<PaywallPlan, SnapshotNode>();
  for (const node of snapshot.nodes) {
    if (!node.rect || node.visibleToUser === false || node.rect.y > TAB_BAND_MAX_Y) continue;
    const plan = planFromTabLabel(labelOf(node));
    if (!plan) continue;
    const prior = found.get(plan);
    if (!prior || (prior.rect && node.rect.y < prior.rect.y)) found.set(plan, node);
  }
  return Object.fromEntries(found) as Partial<Record<PaywallPlan, SnapshotNode>>;
}

export function surveyLooksLikePaywall(snapshot: SnapshotPayload): boolean {
  return Object.keys(surveyPaywallPlanTabs(snapshot)).length >= 2;
}

function selectedTabFromSelectedFlag(
  tabs: Partial<Record<PaywallPlan, SnapshotNode>>,
): PaywallPlan | undefined {
  const selected = PAYWALL_PLANS.filter((plan) => tabs[plan]?.selected === true);
  return selected.length === 1 ? selected[0] : undefined;
}

function selectedTabFromChips(
  snapshot: SnapshotPayload,
  tabs: Partial<Record<PaywallPlan, SnapshotNode>>,
): PaywallPlan | undefined {
  const present = PAYWALL_PLANS.filter((plan) => tabs[plan]);
  if (present.length < 2) return undefined;
  const withoutChip: PaywallPlan[] = [];
  for (const plan of present) {
    const tab = tabs[plan]!;
    const wrapped = snapshot.nodes.some(
      (node) =>
        node.hittable === true &&
        node.rect &&
        node.rect.height <= 180 &&
        node.rect.y < TAB_BAND_MAX_Y &&
        nodeContains(node, tab),
    );
    if (!wrapped) withoutChip.push(plan);
  }
  return withoutChip.length === 1 ? withoutChip[0] : undefined;
}

function selectedTabFromCardTitle(
  snapshot: SnapshotPayload,
  tabBottom: number,
): PaywallPlan | undefined {
  const titles = snapshot.nodes.filter((node) => {
    if (!node.rect || node.visibleToUser === false) return false;
    const label = labelOf(node);
    return (
      (label === "SuperGrok" || isPlanName(label)) &&
      node.rect.y > tabBottom + 40 &&
      node.rect.y < TITLE_MAX_Y
    );
  });
  const qualifier = titles.find(
    (node) => isPlanName(labelOf(node)) && labelOf(node) !== "SuperGrok",
  );
  const qualifierLabel = qualifier ? labelOf(qualifier) : "";
  if (qualifier && isPlanName(qualifierLabel)) return qualifierLabel;
  if (titles.some((node) => labelOf(node) === "SuperGrok")) return "SuperGrok";
  return undefined;
}

function selectedTabFromUpgrade(snapshot: SnapshotPayload): PaywallPlan | undefined {
  for (const node of snapshot.nodes) {
    const label = normalizedSemanticPart(node.label);
    if (!label) continue;
    if (/upgrade to heavy|إلى heavy/u.test(label)) return "Heavy";
    if (/upgrade to plus|إلى plus/u.test(label)) return "Plus";
    if (/upgrade to lite|إلى lite/u.test(label)) return "Lite";
    if (/upgrade to supergrok|claim limited-time offer/u.test(label)) return "SuperGrok";
  }
  return undefined;
}

export function surveySelectedPaywallPlan(snapshot: SnapshotPayload): PaywallPlan | undefined {
  const tabs = surveyPaywallPlanTabs(snapshot);
  const present = PAYWALL_PLANS.filter((plan) => tabs[plan]);
  if (present.length === 0) return undefined;
  const tabBottom = Math.max(
    ...present.map((plan) => (tabs[plan]!.rect?.y ?? 0) + (tabs[plan]!.rect?.height ?? 0)),
  );
  return (
    selectedTabFromSelectedFlag(tabs) ??
    selectedTabFromChips(snapshot, tabs) ??
    selectedTabFromCardTitle(snapshot, tabBottom) ??
    selectedTabFromUpgrade(snapshot)
  );
}

export function surveyPaywallFeatureLabels(snapshot: SnapshotPayload): string[] {
  const boundsHeight = snapshot.bounds?.height ?? 0;
  const headerCut = Math.max(280, boundsHeight * 0.28);
  const labels: string[] = [];
  for (const node of snapshot.nodes) {
    if (!node.rect || node.visibleToUser === false || isSystemSemantic(node)) continue;
    const label = labelOf(node);
    if (!label || node.rect.y < headerCut) continue;
    if (/^(back|home|recents|close)$/iu.test(label)) continue;
    if (planFromTabLabel(label) || isPlanName(label)) continue;
    if (/^upgrade to |^ترقية |^claim /iu.test(label)) continue;
    if (/privacy|terms|شروط|سياسة/u.test(normalizedSemanticPart(label))) continue;
    labels.push(label);
  }
  return labels;
}

export function surveyPlansForFeatureLabels(labels: readonly string[]): PaywallPlan[] {
  const hits = new Set<PaywallPlan>();
  for (const raw of labels) {
    const label = normalizedSemanticPart(raw);
    if (!label) continue;
    for (const plan of PAYWALL_PLANS) {
      if (PLAN_FEATURE_MARKERS[plan].some((marker) => marker.test(label))) hits.add(plan);
    }
  }
  return PAYWALL_PLANS.filter((plan) => hits.has(plan));
}

export function surveyPaywallFirstFrame(snapshot: SnapshotPayload): PaywallFirstFrameVerdict {
  const labels = surveyPaywallFeatureLabels(snapshot);
  const featurePlans = surveyPlansForFeatureLabels(labels);
  if (featurePlans.length > 1) {
    return { kind: "mixed-plans", plans: featurePlans, labels };
  }
  const selected = surveySelectedPaywallPlan(snapshot);
  if (!selected) return { kind: "not-paywall" };
  const featurePlan = featurePlans[0];
  if (featurePlan && featurePlan !== selected) {
    return { kind: "plan-mismatch", selected, featurePlan, labels };
  }
  return { kind: "ok", plan: selected };
}

export function surveyPaywallFrameDecision(snapshot: SnapshotPayload): SurveyPaywallFrameDecision {
  const verdict = surveyPaywallFirstFrame(snapshot);
  if (verdict.kind === "mixed-plans") return { kind: "reject", reason: "mixed-plan" };
  if (verdict.kind === "plan-mismatch") return { kind: "reject", reason: "wrong-plan" };
  return { kind: "accept" };
}

export function surveyFeatureLabelsSettled(
  previous: SnapshotPayload,
  current: SnapshotPayload,
): boolean {
  const before = surveyPaywallFeatureLabels(previous).map((label) => normalizedSemanticPart(label));
  const after = surveyPaywallFeatureLabels(current).map((label) => normalizedSemanticPart(label));
  if (before.length === 0 && after.length === 0) return false;
  if (before.length !== after.length) return false;
  const afterSet = new Set(after);
  return before.every((label) => afterSet.has(label));
}

export function surveyPaywallFirstFrameMessage(verdict: PaywallFirstFrameVerdict): string {
  if (verdict.kind === "mixed-plans") {
    return `Paywall card mixes ${verdict.plans.join(" and ")} feature rows; Relay did not start a survey from a crossfade.`;
  }
  if (verdict.kind === "plan-mismatch") {
    return `Selected ${verdict.selected} but the labeled rows belong to ${verdict.featurePlan}; Relay did not start a survey from a stale card.`;
  }
  return "The paywall card did not settle after the tab change; Relay did not start a survey.";
}
