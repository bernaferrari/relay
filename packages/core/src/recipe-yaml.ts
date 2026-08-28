import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, stringify } from "yaml";
import { validateRecipeParameters, validateRecipeSteps } from "./recipe-validation.js";
import type { Recipe, RecipeParameter, RecipeStep } from "./recipes.js";
import { CURRENT_RECORDING_FORMAT_VERSION } from "./recording-format.js";

const SCHEMA_VERSION = 1;
const MAX_RECIPE_YAML_BYTES = 1_000_000;
export const EXECUTION_PLAN_YAML_SUFFIX = ".relay.plan.yaml" as const;
export const LEGACY_RECIPE_YAML_SUFFIX = ".relay.yaml" as const;

export type RecipeYamlDocument = {
  schemaVersion: number;
  kind: "execution-plan";
  recordingFormatVersion?: typeof CURRENT_RECORDING_FORMAT_VERSION;
  id: string;
  name: string;
  description?: string;
  variables?: Record<string, string>;
  parameters?: RecipeParameter[];
  steps: RecipeStep[];
  quarantined?: boolean;
  quarantineReason?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function assertSafeNode(node: unknown): void {
  if (!node) return;
  if (!isNode(node)) throw new Error("unsupported YAML node in Relay test file");
  if (isAlias(node) || ("anchor" in node && Boolean(node.anchor))) {
    throw new Error("YAML anchors and aliases are not supported in Relay test files");
  }
  if (node.tag) throw new Error("custom YAML tags are not supported in Relay test files");
  if (isMap(node)) {
    for (const item of node.items) {
      assertSafeNode(item.key);
      assertSafeNode(item.value);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) assertSafeNode(item);
  } else if (!isScalar(node)) {
    throw new Error("unsupported YAML node in Relay test file");
  }
}

export function validateRecipeVariables(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new Error("variables must be a key/value mapping");
  const variables: Record<string, string> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) {
      throw new Error(`variables.${name} is not a valid variable name`);
    }
    if (typeof raw !== "string") throw new Error(`variables.${name} must be a string`);
    variables[name] = raw;
  }
  return Object.keys(variables).length > 0 ? variables : undefined;
}

function sortedStringRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function canonicalStep(step: RecipeStep): RecipeStep {
  if (step.kind !== "module" || !step.bindings) return step;
  return { ...step, bindings: sortedStringRecord(step.bindings) };
}

function documentFromRecipe(recipe: Recipe): RecipeYamlDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "execution-plan",
    ...(recipe.recordingFormatVersion
      ? { recordingFormatVersion: recipe.recordingFormatVersion }
      : {}),
    id: recipe.id,
    name: recipe.title,
    ...(recipe.description?.trim() ? { description: recipe.description } : {}),
    ...(recipe.variables && Object.keys(recipe.variables).length > 0
      ? { variables: sortedStringRecord(recipe.variables) }
      : {}),
    ...(recipe.parameters?.length ? { parameters: recipe.parameters } : {}),
    steps: recipe.steps.map(canonicalStep),
    ...(recipe.quarantined ? { quarantined: true } : {}),
    ...(recipe.quarantineReason?.trim() ? { quarantineReason: recipe.quarantineReason } : {}),
  };
}

export function parseRecipeYaml(
  source: string,
  metadata: Pick<Recipe, "createdAt" | "updatedAt"> = { createdAt: 0, updatedAt: 0 },
): Recipe {
  if (Buffer.byteLength(source, "utf8") > MAX_RECIPE_YAML_BYTES) {
    throw new Error("Relay test YAML exceeds the 1 MB limit");
  }
  const document = parseDocument(source, {
    version: "1.2",
    schema: "core",
    strict: true,
    uniqueKeys: true,
    prettyErrors: true,
    stringKeys: true,
    merge: false,
  });
  if (document.errors.length > 0) throw new Error(document.errors[0]!.message);
  assertSafeNode(document.contents);
  const value = document.toJS({ maxAliasCount: 0 });
  if (!isObject(value))
    throw new Error("Relay test YAML must contain an object at the document root");

  const allowed = new Set([
    "schemaVersion",
    "kind",
    "recordingFormatVersion",
    "id",
    "name",
    "description",
    "variables",
    "parameters",
    "steps",
    "quarantined",
    "quarantineReason",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`unknown Relay test field: ${key}`);
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      typeof value.schemaVersion === "number"
        ? `unsupported Relay test schemaVersion: ${value.schemaVersion}`
        : "schemaVersion must be 1",
    );
  }
  if (value.kind !== undefined && value.kind !== "execution-plan") {
    throw new Error("kind must be execution-plan");
  }
  if (
    value.recordingFormatVersion !== undefined &&
    value.recordingFormatVersion !== CURRENT_RECORDING_FORMAT_VERSION
  ) {
    throw new Error(`recordingFormatVersion must be ${CURRENT_RECORDING_FORMAT_VERSION}`);
  }
  assertString(value.id, "id");
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,95}$/.test(value.id)) {
    throw new Error("id must use letters, numbers, and hyphens only");
  }
  assertString(value.name, "name");
  if (value.description !== undefined && typeof value.description !== "string") {
    throw new Error("description must be a string");
  }
  if (!Array.isArray(value.steps)) throw new Error("steps must be an array");
  if (value.quarantined !== undefined && typeof value.quarantined !== "boolean") {
    throw new Error("quarantined must be a boolean");
  }
  if (value.quarantineReason !== undefined && typeof value.quarantineReason !== "string") {
    throw new Error("quarantineReason must be a string");
  }
  const variables = validateRecipeVariables(value.variables);
  const parameters = validateRecipeParameters(value.parameters);
  return {
    id: value.id,
    title: value.name,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    source: "custom",
    ...(value.recordingFormatVersion === CURRENT_RECORDING_FORMAT_VERSION
      ? { recordingFormatVersion: CURRENT_RECORDING_FORMAT_VERSION }
      : {}),
    ...(variables ? { variables } : {}),
    ...(parameters ? { parameters } : {}),
    steps: validateRecipeSteps(value.steps),
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    ...(value.quarantined === true ? { quarantined: true } : {}),
    ...(typeof value.quarantineReason === "string"
      ? { quarantineReason: value.quarantineReason }
      : {}),
  };
}

export function formatRecipeYaml(recipe: Recipe): string {
  return stringify(documentFromRecipe(recipe), {
    indent: 2,
    lineWidth: 100,
    sortMapEntries: false,
    aliasDuplicateObjects: false,
  });
}

export function recipeYamlFilename(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,95}$/.test(id)) throw new Error("invalid recipe id");
  return `${id}${EXECUTION_PLAN_YAML_SUFFIX}`;
}

export function recipeYamlPath(testsRoot: string, id: string): string {
  return join(testsRoot, recipeYamlFilename(id));
}

export function legacyRecipeYamlPath(testsRoot: string, id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,95}$/.test(id)) throw new Error("invalid recipe id");
  return join(testsRoot, `${id}${LEGACY_RECIPE_YAML_SUFFIX}`);
}

export type StoredRecipeYaml = {
  recipe: Recipe;
  path: string;
  contract: "execution-plan" | "legacy-recipe";
};

export async function readYamlRecipeFile(path: string): Promise<Recipe | null> {
  try {
    const [source, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    return parseRecipeYaml(source, {
      createdAt: info.birthtimeMs || info.mtimeMs,
      updatedAt: info.mtimeMs,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Resolve the single executable source for an id. Legacy `.relay.yaml` plans
 * remain readable, but Relay never guesses when both legacy and canonical
 * sources exist. A successful save can then migrate the legacy source. */
export async function readStoredRecipeYaml(
  testsRoot: string,
  id: string,
): Promise<StoredRecipeYaml | null> {
  const canonicalPath = recipeYamlPath(testsRoot, id);
  const legacyPath = legacyRecipeYamlPath(testsRoot, id);
  const [canonical, legacy] = await Promise.all([
    readYamlRecipeFile(canonicalPath),
    readYamlRecipeFile(legacyPath),
  ]);
  if (canonical && legacy) {
    throw new Error(
      `ambiguous executable source for ${id}: both ${recipeYamlFilename(id)} and ${id}${LEGACY_RECIPE_YAML_SUFFIX} exist`,
    );
  }
  if (canonical) return { recipe: canonical, path: canonicalPath, contract: "execution-plan" };
  if (legacy) return { recipe: legacy, path: legacyPath, contract: "legacy-recipe" };
  return null;
}

export async function listYamlRecipeFiles(testsRoot: string): Promise<string[]> {
  try {
    const names = (await readdir(testsRoot, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          (entry.name.endsWith(EXECUTION_PLAN_YAML_SUFFIX) ||
            entry.name.endsWith(LEGACY_RECIPE_YAML_SUFFIX)),
      )
      .map((entry) => entry.name)
      .sort();
    const sources = new Map<string, string>();
    for (const name of names) {
      const suffix = name.endsWith(EXECUTION_PLAN_YAML_SUFFIX)
        ? EXECUTION_PLAN_YAML_SUFFIX
        : LEGACY_RECIPE_YAML_SUFFIX;
      const id = name.slice(0, -suffix.length);
      const prior = sources.get(id);
      if (prior) {
        throw new Error(`ambiguous executable source for ${id}: both ${prior} and ${name} exist`);
      }
      sources.set(id, name);
    }
    return names.map((name) => join(testsRoot, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
