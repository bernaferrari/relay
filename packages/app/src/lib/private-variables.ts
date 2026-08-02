const STORAGE_PREFIX = "relay.private-variables.v1";

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}:${projectId}`;
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
