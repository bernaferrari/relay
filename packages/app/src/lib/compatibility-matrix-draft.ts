import type {
  CompatibilityMatrix,
  TargetCapability,
  TargetProfile,
  TargetSelector,
} from "@relay/protocol";

export type MatrixSelectorDraft = {
  mode: "targets" | "rules";
  targetIds: string[];
  platforms: TargetProfile["platform"][];
  osVersionPrefixes: string;
  nameIncludes: string;
  capabilities: TargetCapability[];
};

export type CompatibilityMatrixDraft = {
  name: string;
  primary: MatrixSelectorDraft;
  additional: MatrixSelectorDraft[];
};

export function emptyMatrixSelectorDraft(mode: MatrixSelectorDraft["mode"] = "rules") {
  return {
    mode,
    targetIds: [],
    platforms: [],
    osVersionPrefixes: "",
    nameIncludes: "",
    capabilities: [],
  } satisfies MatrixSelectorDraft;
}

export function selectorDraftFrom(selector: TargetSelector): MatrixSelectorDraft {
  return {
    mode: selector.targetIds?.length ? "targets" : "rules",
    targetIds: [...(selector.targetIds ?? [])],
    platforms: [...(selector.platforms ?? [])],
    osVersionPrefixes: selector.osVersionPrefixes?.join(", ") ?? "",
    nameIncludes: selector.nameIncludes?.join(", ") ?? "",
    capabilities: [...(selector.requiredCapabilities ?? [])],
  };
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function selectorFromDraft(draft: MatrixSelectorDraft): TargetSelector {
  if (draft.mode === "targets") return { targetIds: [...draft.targetIds] };
  const selector: TargetSelector = {};
  const prefixes = splitList(draft.osVersionPrefixes);
  const names = splitList(draft.nameIncludes);
  if (draft.platforms.length) selector.platforms = [...draft.platforms];
  if (prefixes.length) selector.osVersionPrefixes = prefixes;
  if (names.length) selector.nameIncludes = names;
  if (draft.capabilities.length) selector.requiredCapabilities = [...draft.capabilities];
  return selector;
}

export function selectorDraftValid(draft: MatrixSelectorDraft): boolean {
  if (draft.mode === "targets") return draft.targetIds.length > 0;
  return (
    draft.platforms.length > 0 ||
    splitList(draft.osVersionPrefixes).length > 0 ||
    splitList(draft.nameIncludes).length > 0 ||
    draft.capabilities.length > 0
  );
}

export function compatibilityMatrixDraftFrom(
  matrix?: CompatibilityMatrix,
): CompatibilityMatrixDraft {
  const [primary, ...additional] = matrix?.selectors ?? [];
  return {
    name: matrix?.name ?? "",
    primary: primary ? selectorDraftFrom(primary) : emptyMatrixSelectorDraft("targets"),
    additional: additional.map(selectorDraftFrom),
  };
}

export function compatibilityMatrixDraftValid(draft: CompatibilityMatrixDraft): boolean {
  return (
    draft.name.trim().length > 0 &&
    selectorDraftValid(draft.primary) &&
    draft.additional.every(selectorDraftValid)
  );
}

export function selectorsFromCompatibilityMatrixDraft(
  draft: CompatibilityMatrixDraft,
): TargetSelector[] {
  return [draft.primary, ...draft.additional].map(selectorFromDraft);
}

export function compatibilityMatrixId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function toggleListValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
