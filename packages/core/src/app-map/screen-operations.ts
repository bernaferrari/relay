import { appMapFail } from "./errors.js";
import type {
  AddScreenInput,
  AppMap,
  AppMapMutationContext,
  Proposal,
  Screen,
  ScreenVariant,
  UpdateScreenInput,
} from "./model.js";
import { captureAppMapScreenVariant } from "./recording-operations.js";
import { mutateAppMap } from "./mutation.js";
import { actionOwners } from "./validation.js";
import { assertAddScreenInput, assertUpdateScreenInput, identifier } from "./validation-shapes.js";
import { hasCurrentAuthoringSemantics } from "../authoring-observation-proof.js";
import type { SnapshotNode } from "../device.js";
import { observeScreenIdentity } from "../screen-identity.js";
import type {
  AuthoringEvidence,
  AuthoringObservation,
  AuthoringTarget,
  TargetProfile,
} from "@relay/protocol";
import { recommendScrollSurfaceCapturePolicy } from "../scroll-surface-policy.js";

export type AppMapScreenVariantCaptureInput = {
  map: AppMap;
  screen: Screen;
  observation?: AuthoringObservation;
  target: AuthoringTarget;
  targetProfile?: TargetProfile;
  evidenceUrisById?: Record<string, string>;
  evidenceKindsById?: Record<string, "screenshot" | "snapshot" | "video">;
  evidenceById?: Record<string, AuthoringEvidence>;
  at: number;
};

function scopeFor(map: AppMap) {
  return { organizationId: map.organizationId, projectId: map.projectId, appMapId: map.id };
}

function withScrollCapturePolicy<T extends NonNullable<AddScreenInput["variants"]>[number]>(
  variant: T,
  title: string,
): T {
  if (variant.scrollCapturePolicy) return variant;
  return {
    ...variant,
    scrollCapturePolicy: recommendScrollSurfaceCapturePolicy({
      title,
      semanticLabels: variant.observation?.nodes.flatMap((node) => [
        ...(node.label ? [node.label] : []),
        ...(node.value ? [node.value] : []),
      ]),
      decidedAt: variant.updatedAt,
    }),
  };
}

export function putScreen(draft: AppMap, input: AddScreenInput): void {
  assertAddScreenInput(input, scopeFor(draft), "screen add input");
  if (draft.screens[input.screen.id]) {
    appMapFail("duplicate-id", `Screen ${input.screen.id} already exists`);
  }
  for (const variant of input.variants ?? []) {
    if (draft.screenVariants[variant.id]) {
      appMapFail("duplicate-id", `Screen variant ${variant.id} already exists`);
    }
  }
  draft.screens[input.screen.id] = structuredClone(input.screen);
  for (const variant of input.variants ?? []) {
    draft.screenVariants[variant.id] = structuredClone(
      withScrollCapturePolicy(variant, input.screen.title),
    );
  }
}

export function patchScreen(
  draft: AppMap,
  screenId: string,
  input: UpdateScreenInput,
  at: number,
): void {
  identifier(screenId, "screenId");
  const screen = draft.screens[screenId];
  if (!screen) appMapFail("missing-reference", `Screen ${screenId} does not exist`);
  assertUpdateScreenInput(input, scopeFor(draft), "screen update input");
  const variantIds = new Set(screen.variantIds);
  for (const variantId of input.removeVariantIds ?? []) {
    if (!variantIds.has(variantId)) {
      appMapFail("missing-reference", `Screen ${screenId} does not own variant ${variantId}`);
    }
    variantIds.delete(variantId);
    delete draft.screenVariants[variantId];
  }
  for (const variant of input.upsertVariants ?? []) {
    if (variant.screenId !== screenId) {
      appMapFail("scope-mismatch", `Variant ${variant.id} belongs to another screen`);
    }
    const existing = draft.screenVariants[variant.id];
    if (existing && existing.screenId !== screenId) {
      appMapFail("duplicate-id", `Variant ${variant.id} belongs to another screen`);
    }
    // A variant is an accumulating runtime record. Canvas projections and
    // agent patches may only know the fields they are changing, so replacing
    // the whole value here could silently discard its canonical preview,
    // baseline, or older evidence. Removing a variant remains the explicit
    // way to discard that record.
    const next = existing
      ? {
          ...structuredClone(existing),
          ...structuredClone(variant),
          evidenceIds: [...new Set([...existing.evidenceIds, ...variant.evidenceIds])],
          ...((existing.evidenceUris?.length || variant.evidenceUris?.length) && {
            evidenceUris: [
              ...new Set([...(existing.evidenceUris ?? []), ...(variant.evidenceUris ?? [])]),
            ],
          }),
          ...(variant.screenshotUri === undefined && existing.screenshotUri
            ? { screenshotUri: existing.screenshotUri }
            : {}),
          // A replacement normalized observation without its matching raw
          // snapshot is an explicit evidence gap, not permission to reuse
          // the old tree's geometry. Keep ordinary partial patches intact,
          // but make an observation refresh recapture-required until a fresh
          // immutable tree is supplied.
          ...(variant.observation !== undefined && variant.rawAccessibilityTree === undefined
            ? { rawAccessibilityTree: undefined }
            : {}),
          ...(variant.baseline === undefined && existing.baseline
            ? { baseline: structuredClone(existing.baseline) }
            : {}),
          ...((existing.scrollSurfaces?.length || variant.scrollSurfaces?.length) && {
            scrollSurfaces: [
              ...new Map(
                [...(existing.scrollSurfaces ?? []), ...(variant.scrollSurfaces ?? [])].map(
                  (surface) => [surface.captureId, structuredClone(surface)] as const,
                ),
              ).values(),
            ],
          }),
        }
      : structuredClone(variant);
    draft.screenVariants[variant.id] = withScrollCapturePolicy(
      next,
      input.patch.title ?? screen.title,
    );
    variantIds.add(variant.id);
  }
  screen.title = input.patch.title ?? screen.title;
  if (input.patch.description === null) delete screen.description;
  else if (input.patch.description !== undefined) screen.description = input.patch.description;
  if (input.patch.logicalStateBinding === null) delete screen.logicalStateBinding;
  else if (input.patch.logicalStateBinding !== undefined)
    screen.logicalStateBinding = structuredClone(input.patch.logicalStateBinding);
  if (input.patch.handoff === null) delete screen.handoff;
  else if (input.patch.handoff !== undefined) screen.handoff = structuredClone(input.patch.handoff);
  if (input.patch.identity === null) delete screen.identity;
  else if (input.patch.identity !== undefined)
    screen.identity = structuredClone(input.patch.identity);
  if (input.patch.evidenceSurface === null) delete screen.evidenceSurface;
  else if (input.patch.evidenceSurface !== undefined)
    screen.evidenceSurface = input.patch.evidenceSurface;
  if (input.patch.position === null) delete screen.position;
  else if (input.patch.position !== undefined)
    screen.position = structuredClone(input.patch.position);
  screen.variantIds = [...variantIds].sort();
  screen.updatedAt = at;
}

function proposalReferencesScreen(proposal: Proposal, screenId: string): boolean {
  return proposal.changes.some((change) => {
    if (
      (change.kind === "screen.update" || change.kind === "screen.remove") &&
      change.screenId === screenId
    )
      return true;
    if (change.kind === "screen.add" && change.input.screen.id === screenId) return true;
    const connection = change.kind === "connection.connect" ? change.connection : undefined;
    const patch = change.kind === "connection.update" ? change.patch : undefined;
    return (
      connection?.fromScreenId === screenId ||
      (connection?.destination.kind === "screen" && connection.destination.screenId === screenId) ||
      patch?.fromScreenId === screenId ||
      (patch?.destination?.kind === "screen" && patch.destination.screenId === screenId)
    );
  });
}

export function dropScreen(
  draft: AppMap,
  screenId: string,
  ignoreProposalId?: string,
  at = draft.updatedAt,
): void {
  identifier(screenId, "screenId");
  const screen = draft.screens[screenId];
  if (!screen) appMapFail("missing-reference", `Screen ${screenId} does not exist`);
  const connection = Object.values(draft.connections).find(
    (item) =>
      item.fromScreenId === screenId ||
      (item.destination.kind === "screen" && item.destination.screenId === screenId),
  );
  if (connection) {
    appMapFail("in-use", `Screen ${screenId} is used by connection ${connection.id}`);
  }
  const flow = Object.values(draft.flows).find((item) => item.startScreenId === screenId);
  if (flow) appMapFail("in-use", `Screen ${screenId} is the start of flow ${flow.id}`);
  const assertionOwner = actionOwners(draft).find((owner) =>
    owner.actions.some(
      (action) =>
        action.kind === "assertion" &&
        action.assertion.kind === "screen" &&
        action.assertion.screenId === screenId,
    ),
  );
  if (assertionOwner) {
    appMapFail(
      "in-use",
      `Screen ${screenId} is asserted by ${assertionOwner.ownerKind} ${assertionOwner.ownerId}`,
    );
  }
  const surfaceOwner = Object.values(draft.tests ?? {}).find(
    (test) =>
      test.kind === "scenario" &&
      test.surfaceBindings?.some((binding) => binding.screenId === screenId),
  );
  if (surfaceOwner) {
    appMapFail("in-use", `Screen ${screenId} is bound by Test ${surfaceOwner.id}`);
  }
  const proposal = Object.values(draft.proposals).find(
    (item) =>
      item.status === "pending" &&
      item.id !== ignoreProposalId &&
      proposalReferencesScreen(item, screenId),
  );
  if (proposal) {
    appMapFail("in-use", `Screen ${screenId} is referenced by pending proposal ${proposal.id}`);
  }
  for (const variantId of screen.variantIds) delete draft.screenVariants[variantId];
  for (const group of Object.values(draft.groups)) {
    if (!group.screenIds.includes(screenId)) continue;
    group.screenIds = group.screenIds.filter((id) => id !== screenId);
    group.updatedAt = at;
    if (group.screenIds.length === 0) delete draft.groups[group.id];
  }
  delete draft.screens[screenId];
}

export function addAppMapScreen(
  map: AppMap,
  input: AddScreenInput,
  context: AppMapMutationContext,
): AppMap {
  return mutateAppMap(
    map,
    context,
    {
      eventType: "screen.added",
      subject: { kind: "screen", id: input.screen.id },
      summary: `Added screen ${input.screen.title}`,
    },
    (draft) => putScreen(draft, input),
  );
}

export function updateAppMapScreen(
  map: AppMap,
  screenId: string,
  input: UpdateScreenInput,
  context: AppMapMutationContext,
): AppMap {
  const patch = (input as { patch?: unknown } | null | undefined)?.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    appMapFail(
      "invalid-map",
      'screen update expects --input {"expectedRevision":N,"input":{"patch":{...}}}',
    );
  }
  return mutateAppMap(
    map,
    context,
    {
      eventType: "screen.updated",
      subject: { kind: "screen", id: screenId },
      summary: `Updated screen ${screenId}`,
    },
    (draft) => patchScreen(draft, screenId, input, context.at),
  );
}

export function removeAppMapScreen(
  map: AppMap,
  screenId: string,
  context: AppMapMutationContext,
): AppMap {
  return mutateAppMap(
    map,
    context,
    {
      eventType: "screen.removed",
      subject: { kind: "screen", id: screenId },
      summary: `Removed screen ${screenId}`,
    },
    (draft) => dropScreen(draft, screenId, undefined, context.at),
  );
}

export type AppMapScreenAliasObservationResult = {
  appMap: AppMap;
  alias: { fingerprint: string; aliasesNow: string[] };
  variant?: ScreenVariant;
};

export type AppMapScreenAliasCapture = Omit<
  AppMapScreenVariantCaptureInput,
  "map" | "screen" | "observation" | "at"
>;

/**
 * Approve the target's current screen as the same semantic screen. Observes
 * it through the same capture path `screen capture` uses and appends the
 * observed fingerprint to the screen's identity aliases — the designed
 * mechanism for "approved as the same screen" (see `ScreenIdentity`). This is
 * the one-command recovery for a first run in a new locale that reports every
 * mapped screen as unknown: run-time matching compares the freshly observed
 * fingerprint against the identity fingerprint and its aliases.
 *
 * The primary fingerprint is never replaced, repeats deduplicate, a
 * fingerprint already owned by another screen is rejected, and an empty or
 * stale observation fails closed instead of guessing.
 */
export function observeAppMapScreenAlias(
  map: AppMap,
  screenId: string,
  observation: AuthoringObservation,
  context: AppMapMutationContext,
  capture?: AppMapScreenAliasCapture,
): AppMapScreenAliasObservationResult {
  identifier(screenId, "screenId");
  const screen = map.screens[screenId];
  if (!screen) appMapFail("missing-reference", `Screen ${screenId} does not exist`);
  if (observation.proof && !hasCurrentAuthoringSemantics(observation.proof)) {
    appMapFail(
      "invalid-map",
      `Screen ${screenId} alias observation is stale; recapture the target screen first`,
    );
  }
  const nodes = observation.nodes ?? [];
  if (!nodes.length) {
    appMapFail(
      "invalid-map",
      `Screen ${screenId} alias observation is empty; the target returned no accessibility tree`,
    );
  }
  const fingerprint = observeScreenIdentity(nodes.slice(0, 256) as SnapshotNode[]).fingerprint;
  let aliasesNow: string[] = [];
  let variant: ScreenVariant | undefined;
  const appMap = mutateAppMap(
    map,
    context,
    {
      eventType: "screen.updated",
      subject: { kind: "screen", id: screenId },
      summary: `Approved an observed alias for screen ${screen.title}`,
    },
    (draft) => {
      const target = draft.screens[screenId]!;
      const owner = Object.values(draft.screens).find(
        (candidate) =>
          candidate.id !== screenId &&
          (candidate.identity?.fingerprint === fingerprint ||
            candidate.identity?.aliases?.includes(fingerprint)),
      );
      if (owner) {
        appMapFail("in-use", `Observed fingerprint is already approved for screen ${owner.id}`);
      }
      if (!target.identity) {
        target.identity = { schemaVersion: 1, fingerprint };
      } else if (target.identity.fingerprint !== fingerprint) {
        target.identity.aliases = [
          ...new Set([...(target.identity.aliases ?? []), fingerprint]),
        ].sort();
      }
      if (capture) {
        if (
          capture.targetProfile &&
          (capture.targetProfile.targetId !== capture.target.targetId ||
            capture.targetProfile.platform !== capture.target.platform)
        ) {
          appMapFail(
            "scope-mismatch",
            `Screen ${screenId} alias target profile does not belong to ${capture.target.targetId}`,
          );
        }
        variant = captureAppMapScreenVariant({
          map: draft,
          screen: target,
          observation,
          at: context.at,
          ...capture,
        });
        if (!variant) {
          appMapFail(
            "invalid-map",
            `Screen ${screenId} alias observation could not produce a target variant`,
          );
        }
        draft.screenVariants[variant.id] = variant;
        target.variantIds = [...new Set([...target.variantIds, variant.id])].sort();
      }
      target.updatedAt = context.at;
      aliasesNow = target.identity.aliases ?? [];
    },
  );
  return { appMap, alias: { fingerprint, aliasesNow }, ...(variant ? { variant } : {}) };
}

/** Append reviewed evidence to exactly one screen without changing its identity or edges. */
export function refreshAppMapScreen(
  map: AppMap,
  screenId: string,
  variantId: string,
  capture: Omit<AppMapScreenVariantCaptureInput, "map" | "screen" | "at">,
  context: AppMapMutationContext,
): AppMap {
  return mutateAppMap(
    map,
    context,
    {
      eventType: "screen.updated",
      subject: { kind: "screen", id: screenId },
      summary: "Refreshed screen evidence",
      touched: [screenId, variantId],
    },
    (draft) => {
      const screen = draft.screens[screenId];
      if (!screen) appMapFail("missing-reference", `Screen ${screenId} does not exist`);
      if (draft.screenVariants[variantId])
        appMapFail("duplicate-id", `Variant ${variantId} exists`);
      // The shared capture builder learns aliases and reuses profile IDs. Isolate
      // those mutations and retain every previously approved variant unchanged.
      const captureScreen = { ...structuredClone(screen), variantIds: [] };
      const variant = captureAppMapScreenVariant({
        ...capture,
        map: draft,
        screen: captureScreen,
        at: context.at,
      });
      if (!variant?.screenshotUri)
        appMapFail("invalid-map", "Refresh requires captured screenshot evidence");
      variant.id = variantId;
      variant.refreshCapture = {
        captureId: variantId,
        capturedAt: capture.observation!.capturedAt,
      };
      draft.screenVariants[variantId] = variant;
      screen.variantIds = [...screen.variantIds, variantId];
      screen.updatedAt = context.at;
    },
  );
}
