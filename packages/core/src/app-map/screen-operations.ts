import { appMapFail } from "./errors.js";
import type {
  AddScreenInput,
  AppMap,
  AppMapMutationContext,
  Proposal,
  UpdateScreenInput,
} from "./model.js";
import { mutateAppMap } from "./mutation.js";
import { actionOwners } from "./validation.js";
import { assertAddScreenInput, assertUpdateScreenInput, identifier } from "./validation-shapes.js";

function scopeFor(map: AppMap) {
  return { organizationId: map.organizationId, projectId: map.projectId, appMapId: map.id };
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
    draft.screenVariants[variant.id] = structuredClone(variant);
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
    draft.screenVariants[variant.id] = existing
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
          ...(variant.baseline === undefined && existing.baseline
            ? { baseline: structuredClone(existing.baseline) }
            : {}),
        }
      : structuredClone(variant);
    variantIds.add(variant.id);
  }
  screen.title = input.patch.title ?? screen.title;
  if (input.patch.description === null) delete screen.description;
  else if (input.patch.description !== undefined) screen.description = input.patch.description;
  if (input.patch.identity === null) delete screen.identity;
  else if (input.patch.identity !== undefined)
    screen.identity = structuredClone(input.patch.identity);
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
