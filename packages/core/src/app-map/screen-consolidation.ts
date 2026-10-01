import type { LogicalScrollSurface, ScreenConsolidationPreview, StepTarget } from "@relay/protocol";
import { mergeScreenIdentity } from "./same-screen-identity.js";
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
import {
  logicalSurfaceEvidence,
  validateConsolidationSurface,
} from "./screen-consolidation-surface.js";
import { identifier, requiredText } from "./validation-shapes.js";

export type ConsolidateScreensInput = {
  targetScreenId: string;
  sourceScreenIds: string[];
  targetTitle?: string;
  importedSurface?: LogicalScrollSurface;
  mode?: "scroll-surface" | "same-screen";
};

function revealPlan(
  connection: Connection,
): { target: StepTarget; actionIndex: number } | undefined {
  for (const [actionIndex, action] of connection.actions.entries()) {
    if (action.kind === "passive" || action.kind === "wait" || action.kind === "reveal") continue;
    if (action.kind === "app" && action.action === "close") continue;
    if (action.kind === "tap") {
      const target = action.target;
      return target.identifier || target.ref || target.label || target.text
        ? { target: structuredClone(target), actionIndex }
        : undefined;
    }
    if (action.kind === "recorded" || action.kind === "steps") {
      const first = action.steps.find((step) => step.kind !== "sleep");
      if (first?.kind !== "tap") return undefined;
      return first.target.identifier || first.target.ref || first.target.label || first.target.text
        ? { target: structuredClone(first.target), actionIndex }
        : undefined;
    }
    return undefined;
  }
  return undefined;
}

function semanticTarget(connection: Connection): StepTarget | undefined {
  return revealPlan(connection)?.target;
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

function collectTestChanges(
  map: AppMap,
  testId: string,
  steps: AppMapScenarioTestStep[],
  removed: Set<string>,
  targetScreenId: string,
  targetTitle: string | undefined,
  output: Pick<
    ScreenConsolidationPreview,
    "testPathEdits" | "removedTestStepIds" | "renamedTestSteps"
  >,
): void {
  for (const step of steps) {
    if (
      step.kind === "instruction" &&
      step.binding.status === "resolved" &&
      step.binding.kind === "connections"
    ) {
      const beforeConnectionIds = [...step.binding.connectionIds];
      const terminalConnectionId = beforeConnectionIds.at(-1);
      const removesViewportDestination = Boolean(
        terminalConnectionId && removed.has(terminalConnectionId),
      );
      const afterConnectionIds = removesViewportDestination
        ? []
        : beforeConnectionIds.filter((id) => !removed.has(id));
      if (afterConnectionIds.length !== beforeConnectionIds.length) {
        output.testPathEdits.push({
          testId,
          stepId: step.id,
          beforeConnectionIds,
          afterConnectionIds,
        });
      }
      if (removesViewportDestination) output.removedTestStepIds.push(step.id);
      else if (targetTitle && terminalConnectionId) {
        const terminal = map.connections[terminalConnectionId];
        const oldTitle = map.screens[targetScreenId]!.title;
        if (
          terminal?.destination.kind === "screen" &&
          terminal.destination.screenId === targetScreenId &&
          step.intent === `Visit ${oldTitle}` &&
          step.intent !== `Visit ${targetTitle}`
        )
          output.renamedTestSteps.push({
            testId,
            stepId: step.id,
            beforeIntent: step.intent,
            afterIntent: `Visit ${targetTitle}`,
          });
      }
    }
    if (step.kind === "decision") {
      collectTestChanges(map, testId, step.thenSteps, removed, targetScreenId, targetTitle, output);
      if (step.elseSteps)
        collectTestChanges(
          map,
          testId,
          step.elseSteps,
          removed,
          targetScreenId,
          targetTitle,
          output,
        );
    } else if (step.kind === "loop")
      collectTestChanges(map, testId, step.steps, removed, targetScreenId, targetTitle, output);
  }
}

function countScenarioSteps(steps: AppMapScenarioTestStep[]): number {
  return steps.reduce((count, step) => {
    if (step.kind === "decision")
      return (
        count + 1 + countScenarioSteps(step.thenSteps) + countScenarioSteps(step.elseSteps ?? [])
      );
    if (step.kind === "loop") return count + 1 + countScenarioSteps(step.steps);
    return count + 1;
  }, 0);
}

function mapScenarioSteps(
  steps: AppMapScenarioTestStep[],
  sources: Set<string>,
  target: string,
  removedConnections: Set<string>,
  removedStepIds: Set<string>,
  renamedIntents: ReadonlyMap<string, string>,
): boolean {
  let changed = false;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]!;
    if (removedStepIds.has(step.id)) {
      steps.splice(index, 1);
      changed = true;
      continue;
    }
    const renamedIntent = renamedIntents.get(step.id);
    if (renamedIntent && step.intent !== renamedIntent) {
      step.intent = renamedIntent;
      changed = true;
    }
    if (
      step.kind === "instruction" &&
      step.binding.status === "resolved" &&
      step.binding.kind === "connections"
    ) {
      const filtered = step.binding.connectionIds.filter((id) => !removedConnections.has(id));
      if (filtered.length !== step.binding.connectionIds.length) {
        if (filtered.length === 0) {
          appMapFail("invalid-map", `Test step ${step.id} lost its executable path unexpectedly`);
        }
        step.binding.connectionIds = filtered;
        changed = true;
      }
    }
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
      changed =
        mapScenarioSteps(
          step.thenSteps,
          sources,
          target,
          removedConnections,
          removedStepIds,
          renamedIntents,
        ) || changed;
      if (step.elseSteps)
        changed =
          mapScenarioSteps(
            step.elseSteps,
            sources,
            target,
            removedConnections,
            removedStepIds,
            renamedIntents,
          ) || changed;
    } else if (step.kind === "loop")
      changed =
        mapScenarioSteps(
          step.steps,
          sources,
          target,
          removedConnections,
          removedStepIds,
          renamedIntents,
        ) || changed;
  }
  return changed;
}

export function previewScreenConsolidation(
  map: AppMap,
  input: ConsolidateScreensInput,
): ScreenConsolidationPreview {
  if (input.mode !== undefined && input.mode !== "same-screen" && input.mode !== "scroll-surface")
    appMapFail("invalid-map", "Unknown screen consolidation mode");
  if (input.mode === "same-screen" && input.importedSurface)
    appMapFail("invalid-map", "Same-screen merging cannot import a scroll surface");
  identifier(input.targetScreenId, "screen consolidation targetScreenId");
  if (input.targetTitle !== undefined)
    requiredText(input.targetTitle, "screen consolidation targetTitle", 240);
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
  if (input.importedSurface) validateConsolidationSurface(map, all, input.importedSurface);
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
    if (fromMerged && toMerged && input.mode !== "same-screen") {
      removedSelfLoopConnectionIds.push(connection.id);
      continue;
    }
    const clone = structuredClone(connection);
    if (all.has(clone.fromScreenId)) {
      const originalFromScreenId = clone.fromScreenId;
      if (sources.has(clone.fromScreenId)) {
        clone.fromScreenId = input.targetScreenId;
        if (clone.return) clone.return.expectedDestination.screenId = input.targetScreenId;
      }
      const target = semanticTarget(connection);
      if (input.mode === "same-screen") {
        // Recorded actions between states remain executable self loops.
      } else if (!target)
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
      if (clone.navigation) clone.navigation.expectedDestination.screenId = input.targetScreenId;
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
  const removedConnections = new Set(removedSelfLoopConnectionIds);
  const testChanges = {
    testPathEdits: [] as ScreenConsolidationPreview["testPathEdits"],
    removedTestStepIds: [] as string[],
    renamedTestSteps: [] as ScreenConsolidationPreview["renamedTestSteps"],
  };
  for (const test of Object.values(map.tests))
    collectTestChanges(
      map,
      test.id,
      test.steps,
      removedConnections,
      input.targetScreenId,
      input.targetTitle,
      testChanges,
    );
  const evidenceBackedVariants = [...all]
    .flatMap((screenId) => map.screens[screenId]!.variantIds)
    .map((variantId) => map.screenVariants[variantId]!)
    .filter((variant) => variant.evidenceIds.length > 0);
  const distinctViewportEvidence = new Set(
    evidenceBackedVariants.map((variant) => [...variant.evidenceIds].sort().join("\u0000")),
  );
  if (input.mode !== "same-screen" && !input.importedSurface && distinctViewportEvidence.size > 1)
    blockers.push({
      code: "logical-surface-required",
      message:
        "Evidence-backed viewport screens require an explicit ordered logical surface import so their raw captures remain decomposable",
      entityIds: evidenceBackedVariants.map((variant) => variant.id).sort(),
    });
  const replacementVariant = new Map(
    mergedVariantIds.map(({ sourceVariantId, targetVariantId }) => [
      sourceVariantId,
      targetVariantId,
    ]),
  );
  const projectedSurfaceBindings = Object.values(map.tests).reduce((count, test) => {
    const bindings = test.surfaceBindings ?? [];
    const merged = bindings.filter((binding) => all.has(binding.screenId));
    const retained = bindings.filter((binding) => !all.has(binding.screenId));
    if (input.importedSurface && merged.length > 0) return count + retained.length + 1;
    const keys = new Set(
      [...retained, ...merged].map((binding) =>
        JSON.stringify({
          ...binding,
          screenId: all.has(binding.screenId) ? input.targetScreenId : binding.screenId,
          variantId: replacementVariant.get(binding.variantId) ?? binding.variantId,
        }),
      ),
    );
    return count + keys.size;
  }, 0);
  const rewiredTestIds = new Set(
    Object.values(map.tests)
      .filter(
        (test) =>
          test.surfaceBindings?.some((binding) =>
            input.importedSurface ? all.has(binding.screenId) : sources.has(binding.screenId),
          ) ||
          (test.capture?.mode === "checkpoints" &&
            test.capture.screenIds.some((id) => sources.has(id))),
      )
      .map((test) => test.id),
  );
  for (const edit of testChanges.testPathEdits) rewiredTestIds.add(edit.testId);
  for (const edit of testChanges.renamedTestSteps) rewiredTestIds.add(edit.testId);
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
    rewiredTestIds: [...rewiredTestIds].sort(),
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
    testPathEdits: testChanges.testPathEdits.sort(
      (a, b) => a.testId.localeCompare(b.testId) || a.stepId.localeCompare(b.stepId),
    ),
    removedTestStepIds: [...new Set(testChanges.removedTestStepIds)].sort(),
    renamedTestSteps: testChanges.renamedTestSteps.sort(
      (a, b) => a.testId.localeCompare(b.testId) || a.stepId.localeCompare(b.stepId),
    ),
    resultingCounts: {
      screens: Object.keys(map.screens).length - sourceScreenIds.length,
      variants: Object.keys(map.screenVariants).length - mergedVariantIds.length,
      connections: Object.keys(map.connections).length - removedSelfLoopConnectionIds.length,
      surfaceBindings: projectedSurfaceBindings,
      testSteps:
        Object.values(map.tests).reduce(
          (count, test) => count + countScenarioSteps(test.steps),
          0,
        ) - testChanges.removedTestStepIds.length,
    },
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
      if (input.mode === "same-screen")
        mergeScreenIdentity(
          targetScreen,
          preview.sourceScreenIds.map((id) => draft.screens[id]!),
        );
      if (input.targetTitle !== undefined) targetScreen.title = input.targetTitle.trim();
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
      if (input.importedSurface) {
        const surface = structuredClone(input.importedSurface);
        const surfaceVariant = byProfile.get(surface.targetProfileId)!;
        const evidence = logicalSurfaceEvidence(surface);
        surfaceVariant.evidenceIds = [
          ...new Set([...surfaceVariant.evidenceIds, ...evidence.map(({ id }) => id)]),
        ];
        surfaceVariant.evidenceUris = [
          ...new Set([...(surfaceVariant.evidenceUris ?? []), ...evidence.map(({ uri }) => uri)]),
        ];
        surfaceVariant.scrollSurfaces = [
          ...new Map(
            [...(surfaceVariant.scrollSurfaces ?? []), surface].map((entry) => [
              entry.captureId,
              entry,
            ]),
          ).values(),
        ];
        surfaceVariant.scrollCapturePolicy = structuredClone(surface.capturePolicy);
        surfaceVariant.updatedAt = context.at;
      }
      targetScreen.updatedAt = context.at;
      for (const connection of Object.values(draft.connections)) {
        if (
          all.has(connection.fromScreenId) &&
          connection.destination.kind === "screen" &&
          all.has(connection.destination.screenId) &&
          input.mode !== "same-screen"
        ) {
          delete draft.connections[connection.id];
          continue;
        }
        if (all.has(connection.fromScreenId)) {
          if (sources.has(connection.fromScreenId)) {
            connection.fromScreenId = input.targetScreenId;
            if (connection.return)
              connection.return.expectedDestination.screenId = input.targetScreenId;
          }
          const plan = input.mode === "same-screen" ? undefined : revealPlan(connection)!;
          const alreadyRevealed = connection.actions
            .slice(0, plan?.actionIndex ?? 0)
            .some((action) => action.kind === "reveal");
          if (input.mode !== "same-screen" && !alreadyRevealed)
            connection.actions.splice(plan!.actionIndex, 0, {
              id: `${context.eventId}-reveal-${connection.id}`,
              kind: "reveal",
              target: plan!.target,
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
          if (connection.navigation)
            connection.navigation.expectedDestination.screenId = input.targetScreenId;
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
        if (test.surfaceBindings) {
          const mergedBindings = test.surfaceBindings.filter((binding) =>
            all.has(binding.screenId),
          );
          const retainedBindings = test.surfaceBindings.filter(
            (binding) => !all.has(binding.screenId),
          );
          if (input.importedSurface && mergedBindings.length > 0) {
            const targetVariant = byProfile.get(input.importedSurface.targetProfileId)!;
            test.surfaceBindings = [
              ...retainedBindings,
              {
                screenId: input.targetScreenId,
                variantId: targetVariant.id,
                captureMode: "full-surface",
                reason: input.importedSurface.capturePolicy.reason,
                surfaceId: input.importedSurface.id,
                baselineCaptureId: input.importedSurface.captureId,
                compare: "visual-and-semantic",
                repair: "propose-recapture",
              },
            ];
          } else {
            test.surfaceBindings = [
              ...new Map(
                [...retainedBindings, ...mergedBindings].map((binding) => {
                  const rewritten = {
                    ...binding,
                    screenId: all.has(binding.screenId) ? input.targetScreenId : binding.screenId,
                    variantId: variantReplacements.get(binding.variantId) ?? binding.variantId,
                  };
                  return [JSON.stringify(rewritten), rewritten] as const;
                }),
              ).values(),
            ];
          }
        }
        if (test.capture?.mode === "checkpoints")
          test.capture.screenIds = [
            ...new Set(
              test.capture.screenIds.map((id) => (sources.has(id) ? input.targetScreenId : id)),
            ),
          ];
        if (
          mapScenarioSteps(
            test.steps,
            sources,
            input.targetScreenId,
            new Set(preview.removedSelfLoopConnectionIds),
            new Set(
              preview.testPathEdits
                .filter(
                  (edit) =>
                    edit.testId === test.id && preview.removedTestStepIds.includes(edit.stepId),
                )
                .map(({ stepId }) => stepId),
            ),
            new Map(
              preview.renamedTestSteps
                .filter((edit) => edit.testId === test.id)
                .map(({ stepId, afterIntent }) => [stepId, afterIntent]),
            ),
          ) ||
          preview.rewiredTestIds.includes(test.id)
        )
          test.updatedAt = context.at;
      }
      const danglingTestChanges = {
        testPathEdits: [] as ScreenConsolidationPreview["testPathEdits"],
        removedTestStepIds: [] as string[],
        renamedTestSteps: [] as ScreenConsolidationPreview["renamedTestSteps"],
      };
      for (const test of Object.values(draft.tests))
        collectTestChanges(
          draft,
          test.id,
          test.steps,
          new Set(preview.removedSelfLoopConnectionIds),
          input.targetScreenId,
          undefined,
          danglingTestChanges,
        );
      if (danglingTestChanges.testPathEdits.length > 0)
        appMapFail(
          "invalid-map",
          `Consolidation left deleted connections referenced by Test steps: ${danglingTestChanges.testPathEdits.map(({ testId, stepId }) => `${testId}/${stepId}`).join(", ")}`,
        );
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
