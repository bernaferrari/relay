import { createHash } from "node:crypto";
import type { SnapshotNode } from "./device.js";
import { now } from "./events.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import type { RecipeStep } from "./recipes.js";
import { observeScreenIdentity, type ObserveScreenIdentityOptions } from "./screen-identity.js";

/** Retain the assessed tree before a later failure capture observes a different
 * keyboard/focus state. This records existing proof and performs no device read. */
export function retainScreenMismatch(
  ctx: RecipeStepContext,
  step: Extract<RecipeStep, { kind: "expect-screen" }>,
  observation: {
    nodes?: SnapshotNode[];
    observedAt?: number;
    fingerprint?: string;
  },
  identityOptions: ObserveScreenIdentityOptions,
): void {
  const nodes = observation.nodes;
  if (!nodes?.length) return;
  (ctx.job?.artifacts ?? ctx.artifacts)?.push({
    kind: "ui-tree",
    capturedAt: observation.observedAt ?? now(),
    data: {
      ...(step.id ? { recipeStepId: step.id } : {}),
      phase: "destination-mismatch",
      screenId: step.screenId,
      fingerprint: observation.fingerprint,
      unmaskedFingerprint: observeScreenIdentity(nodes, {
        ...identityOptions,
        ignoreRegions: [],
      }).fingerprint,
      nodesSha256: createHash("sha256").update(JSON.stringify(nodes)).digest("hex"),
      nodes: structuredClone(nodes),
    },
  });
}
