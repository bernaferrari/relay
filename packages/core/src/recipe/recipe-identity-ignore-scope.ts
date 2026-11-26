/**
 * Identity-ignore is screen-identity matching only, scoped to the checkpoint
 * that authored or first consumed it. It is not a capture-review overlay and
 * not a VisualComparisonPolicy region. Looks correct does not write this.
 * Comparison masks stay on an explicit Use as baseline / policy update.
 */

export type RuntimeIdentityIgnoreRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
  /** Identity-ignore recipe step. Provenance only; not observation scope. */
  authoredStepId?: string;
  /** Bound identity checkpoint. Later checkpoints do not inherit this region. */
  stepId?: string;
  screenId?: string;
  checkpointId?: string;
  frameIndex?: number;
};

export type IdentityIgnoreObservation = {
  frameIndex: number;
  stepId?: string;
  screenId?: string;
  checkpointId?: string;
};

function identityIgnoreBoundKey(
  region: Pick<RuntimeIdentityIgnoreRegion, "checkpointId" | "stepId" | "screenId">,
): string | undefined {
  return region.checkpointId || region.stepId || region.screenId || undefined;
}

function identityIgnoreMatchesObservation(
  region: RuntimeIdentityIgnoreRegion,
  observation: IdentityIgnoreObservation,
): boolean {
  return (
    (region.checkpointId !== undefined && region.checkpointId === observation.checkpointId) ||
    (region.stepId !== undefined && region.stepId === observation.stepId) ||
    (region.screenId !== undefined && region.screenId === observation.screenId)
  );
}

/**
 * Apply identity-ignore to this observation only. A region bound to checkpoint
 * N does not apply to N+1 unless that later checkpoint re-authors it. Extra
 * rectangles on the current expect-screen always apply.
 */
export function identityIgnoreRegionsForObservation(input: {
  regions: readonly RuntimeIdentityIgnoreRegion[];
  extra?: readonly RuntimeIdentityIgnoreRegion[];
  observation: IdentityIgnoreObservation;
}): {
  applied: RuntimeIdentityIgnoreRegion[];
  next: RuntimeIdentityIgnoreRegion[];
} {
  const applied: RuntimeIdentityIgnoreRegion[] = [...(input.extra ?? [])];
  const next: RuntimeIdentityIgnoreRegion[] = [];
  const currentKey = identityIgnoreBoundKey(input.observation);

  for (const region of input.regions) {
    if (identityIgnoreBoundKey(region)) {
      if (identityIgnoreMatchesObservation(region, input.observation)) applied.push(region);
      next.push(region);
      continue;
    }
    const authoredFrame = region.frameIndex;
    const sameFrame = authoredFrame === undefined || authoredFrame === input.observation.frameIndex;
    if (!sameFrame) {
      next.push(region);
      continue;
    }
    const bound: RuntimeIdentityIgnoreRegion = currentKey
      ? {
          ...region,
          frameIndex: authoredFrame ?? input.observation.frameIndex,
          ...(input.observation.checkpointId
            ? { checkpointId: input.observation.checkpointId }
            : {}),
          ...(input.observation.stepId ? { stepId: input.observation.stepId } : {}),
          ...(input.observation.screenId ? { screenId: input.observation.screenId } : {}),
        }
      : region;
    applied.push(bound);
    next.push(bound);
  }
  return { applied, next };
}
