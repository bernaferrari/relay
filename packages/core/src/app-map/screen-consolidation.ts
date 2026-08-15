import type { ScreenConsolidationPreview, StepTarget } from "@relay/protocol";
import { appMapFail } from "./errors.js";
import type {
  ActionSpec,
  AppMap,
  AppMapMutationContext,
  AppMapScenarioTestStep,
  Connection,
  ScreenVariant,
} from "./model.js";
import { mutateAppMap } from "./mutation.js";
import { identifier } from "./validation-shapes.js";

export type ConsolidateScreensInput = {
  targetScreenId: string;
  sourceScreenIds: string[];
};

function semanticTarget(connection: Connection): StepTarget | undefined {
  for (const action of connection.actions) {
    if (action.kind === "passive" || action.kind === "wait") continue;
    if (action.kind === "tap") {
      const target = action.target;
      return target.identifier || target.ref || target.label || target.text
        ? structuredClone(target)
        : undefined;
    }
    if (action.kind === "recorded" || action.kind === "steps") {
      const first = action.steps.find((step) => step.kind !== "sleep");
      if (first?.kind !== "tap") return undefined;
      return first.target.identifier || first.target.ref || first.target.label || first.target.text
        ? structuredClone(first.target)
        : undefined;
    }
    return undefined;
  }
  return undefined;
}

function targetAmbiguousInEvidence(map: AppMap, screenId: string, target: StepTarget): boolean {
  const key = target.identifier
    ? "identifier"
    : target.label
      ? "label"
      : target.text
        ? "value"
        : undefined;
  const value = target.identifier ?? target.label ?? target.text;
  if (!key || !value) return false;
  const normalized = value.trim().toLocaleLowerCase();
  const interactiveRoles = new Set([
    "button",
    "cell",
    "checkbox",
    "link",
    "slider",
    "switch",
    "textfield",
    "textview",
  ]);
  for (const variantId of map.screens[screenId]?.variantIds ?? []) {
    const matches = (map.screenVariants[variantId]?.observation?.nodes ?? []).filter(
      (node) =>
        node[key]?.trim().toLocaleLowerCase() === normalized &&
        node.hittable !== false &&
        (node.hittable === true || interactiveRoles.has(node.role.trim().toLocaleLowerCase())),
    );
    if (matches.length > 1) return true;
  }
  return false;
}

function connectionKey(connection: Connection): string {
  const destination =
    connection.destination.kind === "screen" ? connection.destination.screenId : "<end>";
  return `${connection.fromScreenId}\u0000${destination}\u0000${connection.label ?? ""}`;
}

function referencesSourceInPendingProposal(map: AppMap, sources: Set<string>): string[] {
  return Object.values(map.proposals)
    .filter((proposal) => proposal.status === "pending")
    .filter((proposal) =>
      proposal.changes.some((change) => {
        if (
          (change.kind === "screen.update" || change.kind === "screen.remove") &&
          sources.has(change.screenId)
        )
          return true;
        if (change.kind === "screen.add" && sources.has(change.input.screen.id)) return true;
        if (change.kind === "connection.connect") {
          return (
            sources.has(change.connection.fromScreenId) ||
            (change.connection.destination.kind === "screen" &&
              sources.has(change.connection.destination.screenId))
          );
        }
        if (change.kind === "connection.update") {
          return (
            (change.patch.fromScreenId ? sources.has(change.patch.fromScreenId) : false) ||
            (change.patch.destination?.kind === "screen" &&
              sources.has(change.patch.destination.screenId))
          );
        }
        return false;
      }),
    )
    .map((proposal) => proposal.id)
    .sort();
}

function mapScenarioSteps(
  steps: AppMapScenarioTestStep[],
  sources: Set<string>,
  target: string,
): boolean {
  let changed = false;
  for (const step of steps) {
    if (
      step.kind === "validation" &&
      step.binding.status === "resolved" &&
      step.binding.kind === "assertion" &&
      step.binding.assertion.kind === "screen" &&
      sources.has(step.binding.assertion.screenId)
    ) {
      step.binding.assertion.screenId = target;
      changed = true;
    }
    if (step.binding.status === "unresolved" && step.binding.candidates) {
      for (const candidate of step.binding.candidates) {
        if (candidate.kind === "screen" && sources.has(candidate.id)) {
          candidate.id = target;
          changed = true;
        }
      }
    }
    if (step.kind === "decision") {
      changed = mapScenarioSteps(step.thenSteps, sources, target) || changed;
      if (step.elseSteps) changed = mapScenarioSteps(step.elseSteps, sources, target) || changed;
    } else if (step.kind === "loop")
      changed = mapScenarioSteps(step.steps, sources, target) || changed;
  }
  return changed;
}

export function previewScreenConsolidation(
  map: AppMap,
  input: ConsolidateScreensInput,
): ScreenConsolidationPreview {
  identifier(input.targetScreenId, "screen consolidation targetScreenId");
  if (!map.screens[input.targetScreenId])
    appMapFail("missing-reference", `Screen ${input.targetScreenId} does not exist`);
  const sourceScreenIds = [...new Set(input.sourceScreenIds)].sort();
  if (!sourceScreenIds.length)
    appMapFail("invalid-map", "Screen consolidation requires at least one source screen");
  if (sourceScreenIds.includes(input.targetScreenId))
    appMapFail("invalid-map", "The target screen cannot also be a source screen");
  for (const id of sourceScreenIds) {
    identifier(id, "screen consolidation sourceScreenId");
    if (!map.screens[id]) appMapFail("missing-reference", `Screen ${id} does not exist`);
  }
  const sources = new Set(sourceScreenIds);
  const all = new Set([input.targetScreenId, ...sourceScreenIds]);
  const targetProfiles = new Map(
    map.screens[input.targetScreenId]!.variantIds.map((id) => [
      map.screenVariants[id]!.targetProfile.id,
      id,
    ]),
  );
  const movedVariantIds: string[] = [];
  const mergedVariantIds: ScreenConsolidationPreview["mergedVariantIds"] = [];
  for (const sourceId of sourceScreenIds) {
    for (const variantId of map.screens[sourceId]!.variantIds) {
      const existing = targetProfiles.get(map.screenVariants[variantId]!.targetProfile.id);
      if (existing)
        mergedVariantIds.push({ sourceVariantId: variantId, targetVariantId: existing });
      else {
        movedVariantIds.push(variantId);
        targetProfiles.set(map.screenVariants[variantId]!.targetProfile.id, variantId);
      }
    }
  }
  const removedSelfLoopConnectionIds: string[] = [];
  const rewiredConnectionIds: string[] = [];
  const semanticRevealConnectionIds: string[] = [];
  const blockers: ScreenConsolidationPreview["blockers"] = [];
  const projected: Connection[] = [];
  for (const connection of Object.values(map.connections)) {
    const fromMerged = all.has(connection.fromScreenId);
    const toMerged =
      connection.destination.kind === "screen" && all.has(connection.destination.screenId);
    if (fromMerged && toMerged) {
      removedSelfLoopConnectionIds.push(connection.id);
      continue;
    }
    const clone = structuredClone(connection);
    if (all.has(clone.fromScreenId)) {
      const originalFromScreenId = clone.fromScreenId;
      if (sources.has(clone.fromScreenId)) clone.fromScreenId = input.targetScreenId;
      const target = semanticTarget(connection);
      if (!target)
        blockers.push({
          code: "semantic-reveal-required",
          message: `Connection ${connection.id} cannot be made viewport-independent because its first interaction has no semantic tap target`,
          entityIds: [connection.id],
        });
      else if (targetAmbiguousInEvidence(map, originalFromScreenId, target))
        blockers.push({
          code: "semantic-reveal-ambiguous",
          message: `Connection ${connection.id} has an ambiguous semantic target in its saved accessibility evidence`,
          entityIds: [connection.id],
        });
      else semanticRevealConnectionIds.push(connection.id);
      rewiredConnectionIds.push(connection.id);
    }
    if (clone.destination.kind === "screen" && sources.has(clone.destination.screenId)) {
      clone.destination.screenId = input.targetScreenId;
      rewiredConnectionIds.push(connection.id);
    }
    projected.push(clone);
  }
  const groups = new Map<string, string[]>();
  for (const connection of projected) {
    const key = connectionKey(connection);
    groups.set(key, [...(groups.get(key) ?? []), connection.id]);
  }
  const pending = referencesSourceInPendingProposal(map, sources);
  if (pending.length)
    blockers.push({
      code: "pending-proposal",
      message: "Pending proposals reference source screens and must be resolved first",
      entityIds: pending,
    });
  return {
    targetScreenId: input.targetScreenId,
    sourceScreenIds,
    movedVariantIds: movedVariantIds.sort(),
    mergedVariantIds: mergedVariantIds.sort((a, b) =>
      a.sourceVariantId.localeCompare(b.sourceVariantId),
    ),
    rewiredConnectionIds: [...new Set(rewiredConnectionIds)].sort(),
    removedSelfLoopConnectionIds: removedSelfLoopConnectionIds.sort(),
    connectionCollisions: [...groups.values()]
      .filter((ids) => ids.length > 1)
      .map((connectionIds) => ({ connectionIds: connectionIds.sort() })),
    rewiredFlowIds: Object.values(map.flows)
      .filter(
        (flow) =>
          sources.has(flow.startScreenId) ||
          flow.connectionIds.some((id) => removedSelfLoopConnectionIds.includes(id)),
      )
      .map((flow) => flow.id)
      .sort(),
    rewiredTestIds: Object.values(map.tests)
      .filter(
        (test) =>
          test.surfaceBindings?.some((binding) => sources.has(binding.screenId)) ||
          (test.capture?.mode === "checkpoints" &&
            test.capture.screenIds.some((id) => sources.has(id))),
      )
      .map((test) => test.id)
      .sort(),
    rewiredVariableIds: Object.values(map.variables)
      .filter(
        (variable) =>
          variable.apply.kind === "list" &&
          variable.apply.listScreenId &&
          sources.has(variable.apply.listScreenId),
      )
      .map((variable) => variable.id)
      .sort(),
    rewiredGroupIds: Object.values(map.groups)
      .filter((group) => group.screenIds.some((id) => sources.has(id)))
      .map((group) => group.id)
      .sort(),
    semanticRevealConnectionIds: semanticRevealConnectionIds.sort(),
    blockers,
  };
}

function mergeVariant(target: ScreenVariant, source: ScreenVariant, at: number): void {
  target.evidenceIds = [...new Set([...target.evidenceIds, ...source.evidenceIds])];
  target.evidenceUris = [
    ...new Set([...(target.evidenceUris ?? []), ...(source.evidenceUris ?? [])]),
  ];
  target.scrollSurfaces = [
    ...new Map(
      [...(target.scrollSurfaces ?? []), ...(source.scrollSurfaces ?? [])].map(
        (surface) => [surface.captureId, structuredClone(surface)] as const,
      ),
    ).values(),
  ];
  target.updatedAt = at;
}

function rewriteActionAssertions(
  actions: ActionSpec[],
  sources: Set<string>,
  target: string,
): void {
  for (const action of actions)
    if (
      action.kind === "assertion" &&
      action.assertion.kind === "screen" &&
      sources.has(action.assertion.screenId)
    )
      action.assertion.screenId = target;
}

export function consolidateAppMapScreens(
  map: AppMap,
  input: ConsolidateScreensInput,
  context: AppMapMutationContext,
): AppMap {
  const preview = previewScreenConsolidation(map, input);
  if (preview.blockers.length)
    appMapFail("in-use", preview.blockers.map((issue) => issue.message).join("; "));
  const sources = new Set(preview.sourceScreenIds);
  const all = new Set([input.targetScreenId, ...preview.sourceScreenIds]);
  return mutateAppMap(
    map,
    context,
    {
      eventType: "screen.consolidated",
      subject: { kind: "screen", id: input.targetScreenId },
      touched: [
        input.targetScreenId,
        ...preview.sourceScreenIds,
        ...preview.rewiredConnectionIds,
        ...preview.rewiredFlowIds,
        ...preview.rewiredTestIds,
      ],
      summary: `Consolidated ${preview.sourceScreenIds.length} viewport screen${preview.sourceScreenIds.length === 1 ? "" : "s"} into ${input.targetScreenId}`,
    },
    (draft) => {
      const variantReplacements = new Map(
        preview.mergedVariantIds.map(({ sourceVariantId, targetVariantId }) => [
          sourceVariantId,
          targetVariantId,
        ]),
      );
      const targetScreen = draft.screens[input.targetScreenId]!;
      targetScreen.consolidations = [
        ...(targetScreen.consolidations ?? []),
        {
          eventId: context.eventId,
          actorId: context.actorId,
          at: context.at,
          sourceScreens: preview.sourceScreenIds.map((id) => structuredClone(draft.screens[id]!)),
          sourceVariants: preview.sourceScreenIds.flatMap((id) =>
            draft.screens[id]!.variantIds.map((variantId) =>
              structuredClone(draft.screenVariants[variantId]!),
            ),
          ),
          internalConnections: preview.removedSelfLoopConnectionIds.map((id) =>
            structuredClone(draft.connections[id]!),
          ),
          preview: structuredClone(preview),
        },
      ];
      const byProfile = new Map(
        targetScreen.variantIds.map((id) => [
          draft.screenVariants[id]!.targetProfile.id,
          draft.screenVariants[id]!,
        ]),
      );
      for (const sourceId of preview.sourceScreenIds) {
        for (const variantId of draft.screens[sourceId]!.variantIds) {
          const sourceVariant = draft.screenVariants[variantId]!;
          const existing = byProfile.get(sourceVariant.targetProfile.id);
          if (existing) {
            mergeVariant(existing, sourceVariant, context.at);
            delete draft.screenVariants[variantId];
          } else {
            sourceVariant.screenId = input.targetScreenId;
            sourceVariant.updatedAt = context.at;
            targetScreen.variantIds.push(variantId);
            byProfile.set(sourceVariant.targetProfile.id, sourceVariant);
          }
        }
      }
      targetScreen.variantIds = [...new Set(targetScreen.variantIds)].sort();
      targetScreen.updatedAt = context.at;
      for (const connection of Object.values(draft.connections)) {
        if (
          all.has(connection.fromScreenId) &&
          connection.destination.kind === "screen" &&
          all.has(connection.destination.screenId)
        ) {
          delete draft.connections[connection.id];
          continue;
        }
        if (all.has(connection.fromScreenId)) {
          if (sources.has(connection.fromScreenId)) connection.fromScreenId = input.targetScreenId;
          connection.actions.unshift({
            id: `${context.eventId}-reveal-${connection.id}`,
            kind: "reveal",
            target: semanticTarget(connection)!,
            direction: "auto",
            maxAttempts: 16,
          });
          connection.updatedAt = context.at;
        }
        if (
          connection.destination.kind === "screen" &&
          sources.has(connection.destination.screenId)
        ) {
          connection.destination.screenId = input.targetScreenId;
          connection.updatedAt = context.at;
        }
        rewriteActionAssertions(connection.actions, sources, input.targetScreenId);
      }
      for (const routine of Object.values(draft.routines))
        rewriteActionAssertions(routine.actions, sources, input.targetScreenId);
      for (const flow of Object.values(draft.flows)) {
        if (sources.has(flow.startScreenId)) flow.startScreenId = input.targetScreenId;
        flow.connectionIds = flow.connectionIds.filter((id) => draft.connections[id]);
        if (preview.rewiredFlowIds.includes(flow.id)) flow.updatedAt = context.at;
      }
      for (const test of Object.values(draft.tests)) {
        if (test.surfaceBindings)
          for (const binding of test.surfaceBindings)
            if (sources.has(binding.screenId)) {
              binding.screenId = input.targetScreenId;
              binding.variantId = variantReplacements.get(binding.variantId) ?? binding.variantId;
            }
        if (test.capture?.mode === "checkpoints")
          test.capture.screenIds = [
            ...new Set(
              test.capture.screenIds.map((id) => (sources.has(id) ? input.targetScreenId : id)),
            ),
          ];
        if (
          mapScenarioSteps(test.steps, sources, input.targetScreenId) ||
          preview.rewiredTestIds.includes(test.id)
        )
          test.updatedAt = context.at;
      }
      for (const combine of Object.values(draft.combines))
        for (const capture of Object.values(combine.captures ?? {}))
          if (capture.mode === "checkpoints")
            capture.screenIds = [
              ...new Set(
                capture.screenIds.map((id) => (sources.has(id) ? input.targetScreenId : id)),
              ),
            ];
      for (const variable of Object.values(draft.variables))
        if (
          variable.apply.kind === "list" &&
          variable.apply.listScreenId &&
          sources.has(variable.apply.listScreenId)
        ) {
          variable.apply.listScreenId = input.targetScreenId;
          variable.updatedAt = context.at;
        }
      for (const group of Object.values(draft.groups)) {
        group.screenIds = [
          ...new Set(group.screenIds.map((id) => (sources.has(id) ? input.targetScreenId : id))),
        ];
        if (preview.rewiredGroupIds.includes(group.id)) group.updatedAt = context.at;
      }
      for (const sourceId of preview.sourceScreenIds) delete draft.screens[sourceId];
    },
  );
}
