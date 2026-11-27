import type { AppMap, TestData } from "@relay/protocol";

export class ProjectVariablesUpdateError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 400,
  ) {
    super(message);
    this.name = "ProjectVariablesUpdateError";
  }
}

export function validateProjectVariables(value: TestData[]): TestData[] {
  if (!Array.isArray(value)) throw new ProjectVariablesUpdateError("Variables must be an array");
  const ids = new Set<string>();
  const names = new Set<string>();
  return value.map((variable) => {
    const id = typeof variable?.id === "string" ? variable.id.trim() : "";
    const name = typeof variable?.name === "string" ? variable.name.trim() : "";
    if (!id || !name) throw new ProjectVariablesUpdateError("Every variable needs an id and name");
    if (ids.has(id)) throw new ProjectVariablesUpdateError(`Variable id ${id} is duplicated`);
    if (names.has(name))
      throw new ProjectVariablesUpdateError(`Variable name ${name} is duplicated`);
    ids.add(id);
    names.add(name);
    if (!(variable.scope === "shared" || variable.scope === "private"))
      throw new ProjectVariablesUpdateError(`Variable ${name} has an invalid scope`);
    if (
      !(
        variable.source === "static" ||
        variable.source === "list" ||
        variable.source === "generated"
      )
    )
      throw new ProjectVariablesUpdateError(`Variable ${name} has an invalid source`);
    if (variable.scope === "private" && (variable.values?.length || variable.fallback))
      throw new ProjectVariablesUpdateError(
        `Private variable ${name} cannot persist a value or fallback`,
      );
    if (
      variable.values &&
      (!Array.isArray(variable.values) || variable.values.some((item) => typeof item !== "string"))
    )
      throw new ProjectVariablesUpdateError(`Variable ${name} values must be strings`);
    return {
      ...structuredClone(variable),
      id,
      name,
      ...(variable.values
        ? {
            values: variable.values
              .map((item) =>
                variable.scope === "shared" &&
                !variable.sensitive &&
                (variable.source === "static" || variable.source === "list")
                  ? item
                  : item.trim(),
              )
              .filter((item) => item.trim().length > 0),
          }
        : {}),
    };
  });
}

export function validateProjectInputIds(
  value: string[] | undefined,
  label: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((id) => typeof id !== "string" || !id.trim() || id !== id.trim())
  )
    throw new ProjectVariablesUpdateError(`${label} input IDs must be exact nonempty IDs`);
  if (new Set(value).size !== value.length)
    throw new ProjectVariablesUpdateError(`${label} input IDs are duplicated`);
  return [...value];
}

export function assertUnlinkedProjectInputs(
  current: readonly TestData[],
  maps: readonly AppMap[],
  degraded: boolean,
  inputIds: readonly string[],
): void {
  if (!inputIds.length) return;
  if (degraded)
    throw new ProjectVariablesUpdateError(
      "Some Project Apps are unavailable. Reload before editing saved inputs.",
      409,
    );
  for (const id of inputIds) {
    if (!current.some((item) => item.id === id))
      throw new ProjectVariablesUpdateError(`Required unlinked input ${id} does not exist`);
    if (
      maps.some((map) =>
        Object.values(map.variables).some(
          (variable) => variable.apply.kind === "input" && variable.apply.inputId === id,
        ),
      )
    )
      throw new ProjectVariablesUpdateError(
        "This input is already used by an App in this Project. Create a new input to keep existing Plans unchanged.",
        409,
      );
  }
}

/** Keep original order and exact stored records; validate only edited records.
 * Redacted projections are never submitted as replacements for preserved IDs. */
export function mergeProjectVariableUpdate(
  current: readonly TestData[],
  edited: readonly TestData[],
  preserveInputIds: readonly string[],
): TestData[] {
  const stored = new Map(current.map((item) => [item.id, item]));
  const replacements = new Map(edited.map((item) => [item.id, item]));
  const preserved = new Set(preserveInputIds);
  for (const id of preserved) {
    if (!stored.has(id))
      throw new ProjectVariablesUpdateError(`Preserved input ${id} does not exist`);
    if (replacements.has(id))
      throw new ProjectVariablesUpdateError(`Input ${id} cannot be edited and preserved`);
  }
  const result = current.flatMap((item) => {
    if (preserved.has(item.id)) return [structuredClone(item)];
    const replacement = replacements.get(item.id);
    if (!replacement) return [];
    replacements.delete(item.id);
    return [replacement];
  });
  result.push(...replacements.values());
  const names = new Set<string>();
  for (const item of result) {
    const name = item.name.trim();
    if (names.has(name))
      throw new ProjectVariablesUpdateError(`Variable name ${item.name} is duplicated`);
    names.add(name);
  }
  return result;
}
