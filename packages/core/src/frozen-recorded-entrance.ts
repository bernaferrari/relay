import { canonicalSha256 } from "./canonical-json.js";
import { createHash } from "node:crypto";
import type {
  AppMapCompiledTest,
  AuthoringObservation,
  RecipeStep,
  RecordedEntrance,
} from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import type {
  OfflineTestPreflightEvidence,
  OfflineTestPreflightRawSource,
} from "./offline-test-preflight-raw.js";
import {
  observedIosApplication,
  currentSelectorEntrance,
  matchesEntranceStep,
  requestedNativeTap,
} from "./recorded-entrance-proof.js";

export function recordedEntranceStepKey(recipeId: string, step: RecipeStep): string {
  return `${recipeId}\u0000${step.id ?? ""}`;
}
type Captured = Extract<RecordedEntrance, { status: "captured" }>;
function sourceMetadata(entrance: Captured): OfflineTestPreflightRawSource["source"] {
  const { profile, rawTree } = entrance;
  return {
    reference: rawTree.uri,
    evidenceId: rawTree.id,
    sha256: rawTree.sha256,
    recordedEntrance: {
      actionId: entrance.actionId,
      observationId: entrance.observationId,
      scope: entrance.scope,
    },
    variant: {
      id: `entrance-${entrance.actionId}`,
      targetProfileId: profile.id,
      targetId: profile.targetId,
      platform: "ios",
      viewport: profile.viewport,
      capabilities: profile.capabilities,
      ...(profile.model ? { model: profile.model } : {}),
      ...(profile.osVersion ? { osVersion: profile.osVersion } : {}),
    },
  };
}
async function readEntrance(
  step: RecipeStep,
  entrance: Captured,
  readEvidence: (sha256: string) => Promise<Buffer | null>,
): Promise<OfflineTestPreflightRawSource> {
  const result: OfflineTestPreflightRawSource = { source: sourceMetadata(entrance) };
  const ref = entrance.rawTree;
  if (
    !matchesEntranceStep(step, entrance) ||
    ref.uri !== `relay-evidence://${ref.sha256}` ||
    entrance.actionStartedAt > entrance.capturedAt ||
    entrance.capturedAt > entrance.actionFinishedAt
  )
    return result;
  try {
    const bytes = await readEvidence(ref.sha256);
    if (
      !bytes ||
      bytes.length !== ref.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== ref.sha256
    )
      return result;
    const raw: unknown = JSON.parse(bytes.toString("utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
    const snapshot = raw as Record<string, unknown>;
    if (
      snapshot.observationId !== entrance.observationId ||
      snapshot.targetId !== entrance.targetId ||
      snapshot.observationCapturedAt !== entrance.capturedAt ||
      !Array.isArray(snapshot.nodes) ||
      !snapshot.nodes.length ||
      snapshot.nodes.some((node) => !node || typeof node !== "object" || Array.isArray(node))
    )
      return result;
    const nodes = snapshot.nodes as SnapshotNode[];
    const observation = {
      id: entrance.observationId,
      capturedAt: snapshot.observationCapturedAt,
      bounds: snapshot.bounds,
      capture: snapshot.capture,
      proof: snapshot.proof,
    } as AuthoringObservation;
    const request = requestedNativeTap(step);
    if (
      !request ||
      !currentSelectorEntrance(
        observation,
        entrance.targetId,
        entrance.originApplication,
        request,
      ) ||
      canonicalSha256(observation.capture!.selectorEntrance!.profile) !==
        canonicalSha256(entrance.profile) ||
      observation.proof!.pixels.capturedAt! < entrance.actionStartedAt
    )
      return result;
    const root = nodes.find((node) => node.type === "Application" && node.depth === 0);
    if (
      observedIosApplication(nodes) !== entrance.originApplication ||
      !root?.rect ||
      root.rect.width !== entrance.profile.viewport.width ||
      root.rect.height !== entrance.profile.viewport.height ||
      root.logicalCoordinates === false ||
      nodes.some((node) => node.bundleId && node.bundleId !== entrance.originApplication)
    )
      return result;
    return { ...result, nodes };
  } catch {
    return result;
  }
}
/** Only exact frozen step sources participate; absent modern proof never falls back to a Screen Variant. */
export async function loadFrozenRecordedEntrances(
  plan: AppMapCompiledTest,
  readEvidence: (sha256: string) => Promise<Buffer | null>,
): Promise<OfflineTestPreflightEvidence["rawEntrancesByStepKey"]> {
  const entries: NonNullable<OfflineTestPreflightEvidence["rawEntrancesByStepKey"]> = {};
  for (const recipe of Object.values(plan.recipes))
    for (const step of recipe.steps) {
      const entrance = step.recordedEntrance;
      if (!entrance) continue;
      if (entrance.status !== "captured") {
        entries[recordedEntranceStepKey(recipe.id, step)] = { sources: [], status: "unbound" };
        continue;
      }
      const source = await readEntrance(step, entrance, readEvidence);
      entries[recordedEntranceStepKey(recipe.id, step)] = {
        sources: [source],
        ...(source.nodes ? {} : { status: "unbound" as const }),
      };
    }
  return entries;
}
