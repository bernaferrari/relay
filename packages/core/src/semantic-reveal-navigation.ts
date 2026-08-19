import type { SemanticRevealPlan } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { semanticTargetKey } from "./scroll-surface-semantic-index.js";

export type RevealDirection = "up" | "down";

export type SemanticRevealEstimate = {
  surfaceId: string;
  direction: RevealDirection;
  amount: number;
  viewportTop: number;
  remaining: number;
  overlap: number;
  dispersion: number;
  viewportHeight: number;
};

export type SemanticRevealProgress = {
  direction?: RevealDirection;
  directionChanges: number;
  lastViewportTop?: number;
  bestRemaining: number;
  stalls: number;
};

export type SemanticRevealDecision =
  | { status: "move"; movement: SemanticRevealEstimate; progress: SemanticRevealProgress }
  | { status: "unsafe"; reason: string; progress: SemanticRevealProgress };

function liveSemanticKeys(node: SnapshotNode): string[] {
  return [
    node.identifier ? semanticTargetKey({ identifier: node.identifier }) : undefined,
    node.ref ? semanticTargetKey({ ref: node.ref }) : undefined,
    node.label ? semanticTargetKey({ label: node.label }) : undefined,
    node.value ? semanticTargetKey({ text: node.value }) : undefined,
  ].flatMap((key) => (key ? [key] : []));
}

/** Estimate the live document position by aligning every unique visible row
 * with the immutable full-surface semantic index. The median tolerates one
 * translated/stale Android node; dispersion is retained so the runner can
 * distinguish a real target crossing from noisy accessibility geometry. */
export function estimateSemanticRevealMovement(
  nodes: SnapshotNode[],
  plans: SemanticRevealPlan[],
): SemanticRevealEstimate | undefined {
  const candidates = plans.flatMap((plan) => {
    const byKey = new Map(
      plan.anchors.flatMap((anchor) => {
        const key = semanticTargetKey(anchor.target);
        return key ? [[key, anchor] as const] : [];
      }),
    );
    const estimates: number[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      if (!node.rect || node.visibleToUser === false) continue;
      for (const key of liveSemanticKeys(node)) {
        const anchor = byKey.get(key);
        if (!anchor || seen.has(key)) continue;
        seen.add(key);
        estimates.push(anchor.documentY - (node.rect.y + node.rect.height / 2));
        break;
      }
    }
    if (estimates.length === 0) return [];
    estimates.sort((left, right) => left - right);
    const viewportTop = estimates[Math.floor(estimates.length / 2)]!;
    const deviations = estimates
      .map((estimate) => Math.abs(estimate - viewportTop))
      .sort((left, right) => left - right);
    const dispersion = deviations[Math.floor(deviations.length / 2)] ?? 0;
    const delta = plan.targetDocumentY - (viewportTop + plan.viewportHeight / 2);
    return [
      {
        surfaceId: plan.surfaceId,
        direction: delta < 0 ? ("up" as const) : ("down" as const),
        // Large semantic jumps caused the Android list to overshoot and then
        // chase alternating AX geometry. Approach the target in bounded steps.
        amount: Math.max(0.18, Math.min(0.45, Math.abs(delta) / plan.viewportHeight)),
        viewportTop,
        remaining: Math.abs(delta),
        overlap: estimates.length,
        dispersion,
        viewportHeight: plan.viewportHeight,
      },
    ];
  });
  return candidates.sort(
    (left, right) =>
      right.overlap - left.overlap ||
      left.dispersion - right.dispersion ||
      left.remaining - right.remaining,
  )[0];
}

export function initialSemanticRevealProgress(): SemanticRevealProgress {
  return { directionChanges: 0, bestRemaining: Number.POSITIVE_INFINITY, stalls: 0 };
}

/** Maintain one monotonic search trajectory. A direction reversal is accepted
 * only after multiple agreeing anchors prove that the target was crossed by a
 * meaningful distance. At most one corrective reversal is allowed; subsequent
 * disagreement is evidence drift and becomes an inspectable repair instead of
 * an up/down loop. */
export function advanceSemanticRevealNavigation(
  progress: SemanticRevealProgress,
  estimate: SemanticRevealEstimate,
  authoredDirection?: RevealDirection,
): SemanticRevealDecision {
  const direction = authoredDirection ?? progress.direction ?? estimate.direction;
  const positionDelta =
    progress.lastViewportTop === undefined
      ? undefined
      : estimate.viewportTop - progress.lastViewportTop;
  const signedProgress =
    positionDelta === undefined ? undefined : direction === "down" ? positionDelta : -positionDelta;
  const tolerance = estimate.viewportHeight * 0.08;

  if (signedProgress !== undefined && signedProgress < -tolerance) {
    return {
      status: "unsafe",
      reason: `semantic position regressed ${Math.round(Math.abs(signedProgress))}px while moving ${direction}`,
      progress,
    };
  }

  const requestedReversal = estimate.direction !== direction;
  if (authoredDirection && requestedReversal) {
    return {
      status: "unsafe",
      reason: `full-surface index requests ${estimate.direction}, against authored ${authoredDirection} direction`,
      progress,
    };
  }
  if (requestedReversal) {
    const crossedWithStrongEvidence =
      progress.direction !== undefined &&
      progress.directionChanges === 0 &&
      estimate.overlap >= 2 &&
      estimate.dispersion <= estimate.viewportHeight * 0.18 &&
      signedProgress !== undefined &&
      signedProgress >= estimate.viewportHeight * 0.12 &&
      estimate.remaining >= estimate.viewportHeight * 0.08;
    if (!crossedWithStrongEvidence) {
      return {
        status: "unsafe",
        reason:
          progress.directionChanges > 0
            ? "semantic index requested a second direction reversal"
            : `direction reversal lacks strong anchor evidence (${estimate.overlap} overlap, ${Math.round(estimate.dispersion)}px dispersion)`,
        progress,
      };
    }
  }

  const nextDirection = requestedReversal ? estimate.direction : direction;
  const stalls =
    signedProgress !== undefined && signedProgress < tolerance * 0.25 ? progress.stalls + 1 : 0;
  if (stalls >= 2) {
    return {
      status: "unsafe",
      reason: `semantic position stopped progressing while moving ${nextDirection}`,
      progress: { ...progress, stalls },
    };
  }
  if (estimate.remaining > progress.bestRemaining + estimate.viewportHeight * 0.2) {
    return {
      status: "unsafe",
      reason: "semantic distance increased instead of converging on the target",
      progress,
    };
  }

  const nextProgress: SemanticRevealProgress = {
    direction: nextDirection,
    directionChanges: progress.directionChanges + (requestedReversal ? 1 : 0),
    lastViewportTop: estimate.viewportTop,
    bestRemaining: Math.min(progress.bestRemaining, estimate.remaining),
    stalls,
  };
  return {
    status: "move",
    movement: {
      ...estimate,
      direction: nextDirection,
      // A proven crossing gets one small corrective nudge, never another full
      // viewport jump that can create a limit cycle.
      amount: requestedReversal ? 0.18 : estimate.amount,
    },
    progress: nextProgress,
  };
}
