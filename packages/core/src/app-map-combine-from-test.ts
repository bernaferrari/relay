import {
  capturePolicyForLens,
  combineIdFor,
  compareUtf8Bytewise,
  sameAppMapCombineCellValues,
  variableCanApply,
  type AppMap,
  type AppMapCapturePolicy,
  type AppMapCombine,
  type AppMapCombineCellRuntimeProfile,
  type CombineLensInput,
} from "@relay/protocol";

export { capturePolicyForLens, combineIdFor, variableCanApply };

export class AppMapCombineWorldError extends Error {
  constructor(
    message: string,
    readonly code:
      | "unknown-variable"
      | "unknown-value"
      | "empty-selection"
      | "cannot-apply"
      | "missing-test",
  ) {
    super(message);
    this.name = "AppMapCombineWorldError";
  }
}

export function assertCombineWorlds(map: AppMap, worlds: Record<string, string[]>): void {
  const entries = Object.entries(worlds);
  if (!entries.length) {
    throw new AppMapCombineWorldError("Choose at least one Variable value.", "empty-selection");
  }
  for (const [variableId, valueIds] of entries) {
    const variable = map.variables?.[variableId];
    if (!variable) {
      throw new AppMapCombineWorldError(`Unknown Variable ${variableId}.`, "unknown-variable");
    }
    if (!variableCanApply(variable)) {
      throw new AppMapCombineWorldError(
        `Variable ${variable.name} cannot apply and undo.`,
        "cannot-apply",
      );
    }
    if (!valueIds.length) {
      throw new AppMapCombineWorldError(
        `Choose at least one ${variable.name} value.`,
        "empty-selection",
      );
    }
    const available = new Set(variable.options.map((option) => option.id));
    for (const valueId of valueIds) {
      if (!available.has(valueId)) {
        throw new AppMapCombineWorldError(
          `Unknown value ${valueId} on Variable ${variableId}.`,
          "unknown-value",
        );
      }
    }
  }
}

export function upsertAppMapCombineFromTest(input: {
  map: AppMap;
  testId: string;
  selected: Record<string, string[]>;
  /** Ordered public Repeat dimensions. Object key order is not a domain contract. */
  variableIds?: readonly string[];
  strategy?: "zip" | "cartesian" | "pairwise";
  repeatPolicy?: AppMapCombine["repeatPolicy"];
  lens?: CombineLensInput;
  now?: number;
}): { combine: AppMapCombine; created: boolean; capture?: AppMapCapturePolicy } {
  const test = input.map.tests?.[input.testId];
  if (!test) {
    throw new AppMapCombineWorldError(`Unknown Test ${input.testId}.`, "missing-test");
  }
  assertCombineWorlds(input.map, input.selected);
  const selectedIds = Object.keys(input.selected);
  const variableIds = input.variableIds
    ? [...input.variableIds]
    : selectedIds.sort(compareUtf8Bytewise);
  if (
    variableIds.length !== selectedIds.length ||
    new Set(variableIds).size !== variableIds.length ||
    variableIds.some((id) => !Object.hasOwn(input.selected, id))
  ) {
    throw new AppMapCombineWorldError(
      "Repeat dimensions do not match the selected values.",
      "unknown-variable",
    );
  }
  const id = combineIdFor(variableIds, [input.testId]);
  const existing = input.map.combines?.[id];
  const now = input.now ?? Date.now();
  const names = variableIds.map((variableId) => input.map.variables[variableId]!.name);
  const capture = input.lens ? capturePolicyForLens(input.lens) : undefined;
  const selected = Object.fromEntries(
    variableIds.map((variableId) => [variableId, [...input.selected[variableId]!]]),
  );
  const captures = capture
    ? { ...existing?.captures, [input.testId]: capture }
    : existing?.captures;
  return {
    combine: {
      id,
      organizationId: input.map.organizationId,
      projectId: input.map.projectId,
      appMapId: input.map.id,
      name: existing?.name ?? `${names.join(" × ")} × ${test.name}`,
      variableIds,
      testIds: [input.testId],
      selected,
      ...(captures ? { captures } : {}),
      ...(input.strategy
        ? { strategy: input.strategy }
        : existing?.strategy
          ? { strategy: existing.strategy }
          : {}),
      ...(input.repeatPolicy
        ? { repeatPolicy: structuredClone(input.repeatPolicy) }
        : existing?.repeatPolicy
          ? { repeatPolicy: structuredClone(existing.repeatPolicy) }
          : {}),
      ...(existing?.cellRuntimeProfiles
        ? { cellRuntimeProfiles: existing.cellRuntimeProfiles }
        : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    },
    created: !existing,
    ...(capture ? { capture } : {}),
  };
}

export type SavedRuntimeProfileOption = {
  id: string;
  name: string;
  targetId: string;
  platform: string;
};

export function mapSavedRuntimeProfiles(map: AppMap): SavedRuntimeProfileOption[] {
  const seen = new Map<string, SavedRuntimeProfileOption>();
  for (const variant of Object.values(map.screenVariants ?? {})) {
    const profile = variant.targetProfile;
    if (!profile?.id || seen.has(profile.id)) continue;
    seen.set(profile.id, {
      id: profile.id,
      name: profile.name?.trim() || profile.id,
      targetId: profile.targetId,
      platform: profile.platform,
    });
  }
  return [...seen.values()];
}

function tokensFrom(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 2);
}

export function compatibleDefaultTargetProfileId(input: {
  profiles: readonly SavedRuntimeProfileOption[];
  target: { targetId: string; platform: string };
  values: Record<string, string>;
  explicitProfileId?: string;
}): string | undefined {
  const explicit = input.explicitProfileId?.trim();
  if (explicit) return explicit;
  const matching = input.profiles.filter(
    (profile) =>
      profile.targetId === input.target.targetId && profile.platform === input.target.platform,
  );
  if (matching.length === 1) return matching[0]!.id;
  if (!matching.length) return undefined;
  const valueTokens = [...new Set(Object.values(input.values).flatMap(tokensFrom))];
  const scored = matching
    .map((profile) => {
      const haystack = [profile.id, profile.name, profile.platform, profile.targetId]
        .join(" ")
        .toLocaleLowerCase();
      const tokenHits = valueTokens.filter((token) => haystack.includes(token)).length;
      const exactValue = Object.values(input.values).some((value) =>
        haystack.includes(value.toLocaleLowerCase()),
      );
      return { id: profile.id, score: tokenHits * 2 + (exactValue ? 1 : 0) };
    })
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  if (!scored[0] || scored[0].score === 0) return undefined;
  if (scored[1] && scored[1].score === scored[0].score) return undefined;
  return scored[0].id;
}

export function synthesizeCombineCellRuntimeProfiles(input: {
  cells: ReadonlyArray<{ testId: string; values: Record<string, string> }>;
  bindings: readonly AppMapCombineCellRuntimeProfile[];
  map: AppMap;
  target?: { targetId: string; platform: string };
  explicitProfileId?: string;
}): AppMapCombineCellRuntimeProfile[] {
  if (!input.target) return [...input.bindings];
  const profiles = mapSavedRuntimeProfiles(input.map);
  const synthesized = [...input.bindings];
  for (const cell of input.cells) {
    if (
      synthesized.some(
        (binding) =>
          binding.testId === cell.testId &&
          sameAppMapCombineCellValues(binding.values, cell.values),
      )
    ) {
      continue;
    }
    const targetProfileId = compatibleDefaultTargetProfileId({
      profiles,
      target: input.target,
      values: cell.values,
      explicitProfileId: input.explicitProfileId,
    });
    if (!targetProfileId) continue;
    synthesized.push({
      testId: cell.testId,
      values: { ...cell.values },
      targetProfileId,
    });
  }
  return synthesized;
}

export function resolveCombineCellSelector(
  cells: ReadonlyArray<{
    cellId: string;
    testId: string;
    values: Record<string, string>;
    worldLabel: string;
  }>,
  cell: string,
): string[] {
  const needle = cell.trim();
  if (!needle) throw new AppMapCombineWorldError("Choose a Combine cell.", "empty-selection");
  const byId = cells.filter((item) => item.cellId === needle);
  if (byId.length) return [...new Set(byId.map((item) => item.cellId))];
  const byWorld = cells.filter((item) => Object.values(item.values).join("|") === needle);
  if (byWorld.length) return [...new Set(byWorld.map((item) => item.cellId))];
  const colon = needle.indexOf(":");
  if (colon > 0) {
    const testId = needle.slice(0, colon);
    const value = needle.slice(colon + 1);
    const match = cells.filter(
      (item) => item.testId === testId && Object.values(item.values).includes(value),
    );
    if (match.length) return [...new Set(match.map((item) => item.cellId))];
  }
  const byValue = cells.filter((item) => Object.values(item.values).includes(needle));
  if (byValue.length) return [...new Set(byValue.map((item) => item.cellId))];
  const lowered = needle.toLocaleLowerCase();
  const byLabel = cells.filter((item) => item.worldLabel.toLocaleLowerCase() === lowered);
  if (byLabel.length) return [...new Set(byLabel.map((item) => item.cellId))];
  throw new AppMapCombineWorldError(`Unknown Combine cell ${needle}.`, "unknown-value");
}
