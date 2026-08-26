import type { AppMap, AppMapScenarioTest, AppMapScenarioTestStep } from "@relay/protocol";

/**
 * Diff-to-flows v1: map changed repository files onto the App Map Tests that
 * could observe the change, so a PR can rerun exactly the affected critical
 * flows instead of the whole suite.
 *
 * v1 contract: App Map entities do not yet carry `sourcePaths` front-matter in
 * the protocol document, so callers supply `{entityId -> sourcePaths}`. The
 * mapping is advisory input, never stored state. v2 plan: add an optional
 * `sourcePaths?: string[]` field to the Screen and Connection protocol
 * entities (validated as a string array, defaulting empty), migrate authoring
 * surfaces to write it through the existing entity save operations, then drop
 * the caller-provided parameter in favor of reading the saved map directly.
 *
 * Matching is longest-prefix directory match over directory prefixes: a
 * changed file belongs to an entity when some source path of that entity sits
 * under a directory containing the changed file, and the deepest matching
 * directory wins across entities. Entities without paths never match.
 * Matched connections affect Tests whose steps traverse them, and matched
 * routines expand through `previewRoutineImpact`, so editing one shared
 * routine marks every Test that walks any flow using it. Pure and
 * deterministic: identical inputs always produce identical sorted output.
 */
export type DiffImpactInput = {
  changedFiles: string[];
  /** Advisory `{entityId -> repository source paths}` front-matter. */
  sourcePaths?: Record<string, string[]>;
};

/** Directory prefixes (with trailing slash) that contain at least one changed
 * file. Repository-root files carry no directory prefix and cannot match. */
function changedDirectoryPrefixes(changedFiles: readonly string[]): string[] {
  const prefixes = new Set<string>();
  for (const file of changedFiles) {
    const trimmed = file.trim().replace(/^\/+/u, "");
    const lastSlash = trimmed.lastIndexOf("/");
    // `lastSlash <= 0`: root-level file, or a bare name — neither has a
    // directory prefix, so they must not accidentally match siblings.
    if (lastSlash <= 0) continue;
    prefixes.add(trimmed.slice(0, lastSlash + 1));
  }
  return [...prefixes];
}

/** Longest match depth between one entity source path and the changed-file
 * prefixes. Source paths may be files or directories:
 *
 * - a changed directory equal to or nested under the source directory matches
 *   with the shared-prefix length;
 * - a source path pointing at one file matches when that file's own directory
 *   sits under a changed prefix;
 * - everything else, including root-level paths without a directory, misses.
 */
function longestMatchingPrefix(prefixes: readonly string[], sourcePath: string): number {
  const trimmed = sourcePath.trim().replace(/^\/+/u, "");
  if (!trimmed) return -1;
  let best = -1;
  for (const prefix of prefixes) {
    // The source path names a directory containing the changed file when the
    // changed file sits at `<sourcePath>/…`.
    if (prefix.startsWith(`${trimmed}/`) && trimmed.length > best) {
      best = trimmed.length;
      continue;
    }
    // The source path names a file whose directory is a changed prefix.
    const lastSlash = trimmed.lastIndexOf("/");
    if (
      lastSlash > 0 &&
      trimmed.slice(0, lastSlash + 1).startsWith(prefix) &&
      prefix.length > best
    ) {
      best = prefix.length;
    }
  }
  return best;
}
type DiffImpactContext = {
  /** Every entity id matched by the diff, plus connections of matched flows. */
  matchedEntityIds: Set<string>;
  routines: Map<string, { routines: string[]; connections: string[]; flows: string[] }>;
  appMap: AppMap;
};

/**
 * Transitive routine closure, mirroring `previewRoutineImpact`'s machinery
 * (direct routine callers, flow setups, connection actions) but without the
 * whole-map validation: diff impact must stay a pure read that tolerates
 * partially-authored maps, whose broken references simply contribute nothing.
 */
function routineClosureTouches(context: DiffImpactContext, routineId: string): boolean {
  let closure = context.routines.get(routineId);
  if (!closure) {
    const affected = new Set<string>([routineId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const candidate of Object.values(context.appMap.routines)) {
        if (affected.has(candidate.id)) continue;
        if (
          candidate.actions.some(
            (action) => action.kind === "routine" && affected.has(action.routineId),
          )
        ) {
          affected.add(candidate.id);
          grew = true;
        }
      }
    }
    const connections: string[] = [];
    for (const connection of Object.values(context.appMap.connections)) {
      if (
        connection.actions.some(
          (action) => action.kind === "routine" && affected.has(action.routineId),
        )
      ) {
        connections.push(connection.id);
      }
    }
    const connectionSet = new Set(connections);
    const flows: string[] = [];
    for (const flow of Object.values(context.appMap.flows)) {
      if (
        (flow.setup !== undefined && affected.has(flow.setup.routineId)) ||
        flow.connectionIds.some((connectionId) => connectionSet.has(connectionId))
      ) {
        flows.push(flow.id);
      }
    }
    closure = { routines: [...affected], connections, flows };
    context.routines.set(routineId, closure);
  }
  return (
    closure.routines.some((id) => context.matchedEntityIds.has(id)) ||
    closure.flows.some((id) => context.matchedEntityIds.has(id)) ||
    closure.connections.some((id) => context.matchedEntityIds.has(id))
  );
}

function stepTouchesDiff(
  step: AppMapScenarioTestStep,
  context: DiffImpactContext,
  visited: Set<AppMapScenarioTestStep>,
): boolean {
  if (visited.has(step)) return false;
  visited.add(step);
  if (step.binding.status === "resolved" && step.binding.kind === "connections") {
    if (step.binding.connectionIds.some((id) => context.matchedEntityIds.has(id))) {
      return true;
    }
  }
  if (step.kind === "instruction") {
    return step.cleanup !== undefined && routineClosureTouches(context, step.cleanup.routineId);
  }
  if (step.kind === "module") {
    return (
      step.binding.status === "resolved" &&
      step.binding.kind === "routine" &&
      routineClosureTouches(context, step.binding.routineId)
    );
  }
  if (step.kind === "decision") {
    const thenTouched = step.thenSteps.some((child) => stepTouchesDiff(child, context, visited));
    if (thenTouched) return true;
    return (step.elseSteps ?? []).some((child) => stepTouchesDiff(child, context, visited));
  }
  if (step.kind === "loop") {
    return step.steps.some((child) => stepTouchesDiff(child, context, visited));
  }
  return false;
}

function testTouchesDiff(test: AppMapScenarioTest, context: DiffImpactContext): boolean {
  return test.steps.some((step) =>
    stepTouchesDiff(step, context, new Set<AppMapScenarioTestStep>()),
  );
}

/**
 * Compute the sorted, de-duplicated ids of Tests affected by `changedFiles`.
 * See the module contract above for the v1 matching rules.
 */
export function computeDiffImpact(appMap: AppMap, input: DiffImpactInput): string[] {
  const context = diffImpactContext(appMap, input);
  if (!context) return [];
  return Object.values(appMap.tests)
    .filter((test) => testTouchesDiff(test, context))
    .map((test) => test.id)
    .sort();
}

/**
 * Every App Map entity id the diff touches, before narrowing to Tests:
 * directly matched entities, routine closures, executing connections, and
 * traversed connections of matched flows. The server reports this alongside
 * `affectedTestIds` so callers can see which graph entities carried impact.
 */
export function matchedDiffEntities(appMap: AppMap, input: DiffImpactInput): string[] {
  const context = diffImpactContext(appMap, input);
  if (!context) return [];
  return [...context.matchedEntityIds].sort();
}

function diffImpactContext(appMap: AppMap, input: DiffImpactInput): DiffImpactContext | null {
  const prefixes = changedDirectoryPrefixes(input.changedFiles);
  const matched = new Map<string, number>();
  for (const [entityId, paths] of Object.entries(input.sourcePaths ?? {})) {
    let best = -1;
    for (const path of paths) {
      const depth = longestMatchingPrefix(prefixes, path);
      if (depth > best) best = depth;
    }
    if (best >= 0) matched.set(entityId, best);
  }
  if (matched.size === 0) return null;

  const matchedEntityIds = new Set(matched.keys());
  const context: DiffImpactContext = {
    matchedEntityIds,
    routines: new Map(),
    appMap,
  };

  // A matched Routine contributes everything it can reach: sibling routines in
  // its closure, the connections that execute the closure, and the flows
  // reached through either — so editing one shared helper marks every Test
  // that observes its effect, however indirectly.
  const closureSeeds = [...matched.keys()].filter((id) => appMap.routines[id]);
  for (const seed of closureSeeds) {
    routineClosureTouches(context, seed);
  }
  context.matchedEntityIds = new Set([
    ...matched.keys(),
    ...closureSeeds.flatMap((seed) => {
      const closure = context.routines.get(seed)!;
      return [...closure.routines, ...closure.connections, ...closure.flows];
    }),
  ]);

  // Connections executing a matched Routine inherit the impact even when no
  // path front-matter names them: a Test bound to the edge runs the code.
  for (const connection of Object.values(appMap.connections)) {
    if (
      connection.actions.some(
        (action) => action.kind === "routine" && context.matchedEntityIds.has(action.routineId),
      )
    ) {
      context.matchedEntityIds.add(connection.id);
    }
  }

  // A matched flow contributes its traversed connections: a change to a
  // flow-owned document affects every Test that walks the flow even when the
  // individual edges carry no paths of their own.
  for (const flowId of context.matchedEntityIds) {
    for (const connectionId of appMap.flows[flowId]?.connectionIds ?? []) {
      context.matchedEntityIds.add(connectionId);
    }
  }

  return context;
}
