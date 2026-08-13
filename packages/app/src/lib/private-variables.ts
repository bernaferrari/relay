const STORAGE_PREFIX = "relay.private-variables.v1";
const SHARED_DRAFT_PREFIX = "relay.variable-shared-drafts.v1";

export type SharedVariableDraft = {
  mode: "AI" | "List" | "Default";
  preview: string;
  values?: string[];
  fallback: string;
};

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}:${projectId}`;
}

function sharedDraftStorageKey(projectId: string): string {
  return `${SHARED_DRAFT_PREFIX}:${projectId}`;
}

export function readPrivateVariableValues(projectId: string): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(projectId)) ?? "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([name, item]) => [name, item]),
    );
  } catch {
    return {};
  }
}

export function writePrivateVariableValue(
  projectId: string,
  variableId: string,
  value: string,
): void {
  if (typeof localStorage === "undefined") return;
  const current = readPrivateVariableValues(projectId);
  if (value) current[variableId] = value;
  else delete current[variableId];
  localStorage.setItem(storageKey(projectId), JSON.stringify(current));
}

export function removePrivateVariableValue(projectId: string, variableId: string): void {
  writePrivateVariableValue(projectId, variableId, "");
}

export function readSharedVariableDrafts(projectId: string): Record<string, SharedVariableDraft> {
  if (typeof localStorage === "undefined") return {};
  try {
    const value = JSON.parse(
      localStorage.getItem(sharedDraftStorageKey(projectId)) ?? "{}",
    ) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, SharedVariableDraft] => {
        const draft = entry[1];
        if (!draft || typeof draft !== "object" || Array.isArray(draft)) return false;
        const candidate = draft as Partial<SharedVariableDraft>;
        return (
          (candidate.mode === "AI" || candidate.mode === "List" || candidate.mode === "Default") &&
          typeof candidate.preview === "string" &&
          typeof candidate.fallback === "string" &&
          (candidate.values === undefined ||
            (Array.isArray(candidate.values) &&
              candidate.values.every((item) => typeof item === "string")))
        );
      }),
    );
  } catch {
    return {};
  }
}

export function writeSharedVariableDraft(
  projectId: string,
  variableId: string,
  draft: SharedVariableDraft,
): void {
  if (typeof localStorage === "undefined") return;
  const current = readSharedVariableDrafts(projectId);
  current[variableId] = structuredClone(draft);
  localStorage.setItem(sharedDraftStorageKey(projectId), JSON.stringify(current));
}

export function removeSharedVariableDraft(projectId: string, variableId: string): void {
  if (typeof localStorage === "undefined") return;
  const current = readSharedVariableDrafts(projectId);
  delete current[variableId];
  localStorage.setItem(sharedDraftStorageKey(projectId), JSON.stringify(current));
}

export function privateValuesForRun(
  projectId: string,
  variables: Array<{ id: string; name: string; scope: "shared" | "private" }>,
): Record<string, string> {
  const values = readPrivateVariableValues(projectId);
  return Object.fromEntries(
    variables
      .filter((variable) => variable.scope === "private" && values[variable.id])
      .map((variable) => [variable.name, values[variable.id]!]),
  );
}
