/**
 * One private execution-plan model: deterministic YAML on disk, consumed by
 * the job engine (recipe-runner.ts + session.ts).
 *
 * Built-in coded flows are mirrored here as single-`flow`-step plans so the
 * execution engine has one representation; custom plans live under `tests/`.
 */
import { mkdir, readdir, writeFile, unlink, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { ACTIONS, isActionId } from "./actions.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import { now } from "./events.js";
import {
  CURRENT_RECORDING_FORMAT_VERSION,
  type RecordingFormatVersion,
} from "./recording-format.js";
import {
  RevisionConflict,
  type Revisioned,
  type RecipeParameter,
  type RecipeStep,
} from "@relay/protocol";
import { currentOperationContext } from "./operation-context.js";
import { publish } from "./events.js";
import {
  atomicWriteFile,
  BoundedIdempotencyStore,
  KeyedSerialQueue,
  payloadFingerprint,
  scopedIdempotencyKey,
} from "./coordination-store.js";
export type {
  HumanCheckpointReason,
  HorizontalCoordinateAnchor,
  RecipeParameter,
  RecipeStep,
  RecordedNodeEvidence,
  RecordedSelectorCandidate,
  RecordedStepEvidence,
  StepPoint,
  StepPointAnchorTarget,
  StepTarget,
  VerticalCoordinateAnchor,
} from "@relay/protocol";
import { validateRecipeParameters, validateRecipeSteps } from "./recipe-validation.js";
export { validateRecipeParameters, validateRecipeSteps };
export { describeTarget, describeRecipeStep, glyphsForStep } from "./recipe-presentation.js";
import {
  saveRecipeEvidenceImage,
  readRecipeEvidenceImage,
  projectRecipeEvidenceImageArtifact,
  projectStoredRecipeEvidenceImageArtifact,
  evidencePart,
  evidenceDir,
} from "./recipe-evidence-store.js";
export {
  saveRecipeEvidenceImage,
  readRecipeEvidenceImage,
  projectRecipeEvidenceImageArtifact,
  projectStoredRecipeEvidenceImageArtifact,
};
import {
  formatRecipeYaml,
  legacyRecipeYamlPath,
  listYamlRecipeFiles,
  readYamlRecipeFile,
  readStoredRecipeYaml,
  recipeYamlPath,
  validateRecipeVariables,
} from "./recipe-yaml.js";

export type Recipe = {
  /** slug, unique; custom ones are "custom-<slug>" */
  id: string;
  title: string;
  description?: string;
  /** Test-scoped static values, frozen into the recipe source for Git review. */
  variables?: Record<string, string>;
  /** Declared inputs when this recipe is used as a reusable flow. */
  parameters?: RecipeParameter[];
  source: "builtin" | "custom";
  /**
   * Version of the recorded-evidence contract. It is intentionally separate
   * from the YAML schema so recordings can be audited or retired without
   * invalidating an otherwise readable flow definition.
   */
  recordingFormatVersion?: RecordingFormatVersion;
  steps: RecipeStep[];
  createdAt: number;
  updatedAt: number;
  quarantined?: boolean;
  quarantineReason?: string;
};

/** Directory for custom recipes — mirrors runsRoot()'s convention. */
export function recipesRoot(): string {
  const env = process.env.RELAY_RECIPES_DIR?.trim();
  if (env) return env;
  return join(findWorkspaceRoot(), "recipes");
}

/** Git-tracked YAML definitions are the only persisted execution-plan source. */
export function testsRoot(): string {
  const env = process.env.RELAY_TESTS_DIR?.trim();
  return env || join(findWorkspaceRoot(), "tests");
}

/** Built-in plans: one per coded flow, each a single opaque `flow` step. */
export function builtinRecipes(): Recipe[] {
  return ACTIONS.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    source: "builtin" as const,
    steps: [{ kind: "flow", flow: a.id }],
    createdAt: 0,
    updatedAt: 0,
  }));
}

async function readStoredRecipe(id: string): Promise<Recipe | null> {
  return (await readStoredRecipeYaml(testsRoot(), id))?.recipe ?? null;
}

/** Packaged flows and stored plan definitions share one execution catalog. A
 * stored definition with the same id overrides its packaged default. */
export async function listRecipes(): Promise<Recipe[]> {
  const builtins = builtinRecipes();
  const yamlRecipes = new Map<string, Recipe>();
  for (const path of await listYamlRecipeFiles(testsRoot())) {
    try {
      const recipe = await readYamlRecipeFile(path);
      if (recipe) yamlRecipes.set(recipe.id, recipe);
    } catch {
      /* Invalid YAML is surfaced on direct open/import, but must not break the library. */
    }
  }
  const customs = new Map<string, Recipe>();
  const overrides = new Map<string, Recipe>();
  for (const [id, recipe] of yamlRecipes) {
    if (isActionId(id)) overrides.set(id, recipe);
    else customs.set(id, recipe);
  }
  const customList = [...customs.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const included = builtins.map((recipe) => overrides.get(recipe.id) ?? recipe);
  return [...included, ...customList];
}

export async function readRecipe(id: string): Promise<Recipe | null> {
  const stored = await readStoredRecipe(id);
  if (stored) return stored;
  const builtin = builtinRecipes().find((r) => r.id === id);
  if (builtin) return builtin;
  return null;
}

export type FrozenRecipeGraph = Record<string, Recipe>;

/** Resolve every reusable-flow dependency before a job enters the queue. */
export async function freezeRecipeGraph(
  root: Recipe,
  seed: FrozenRecipeGraph = {},
): Promise<FrozenRecipeGraph> {
  const graph: FrozenRecipeGraph = { ...structuredClone(seed), [root.id]: structuredClone(root) };
  const visiting = new Set<string>();

  const dependencies = (recipe: Recipe): string[] =>
    recipe.steps.flatMap((step) => {
      if (step.kind === "module" || step.kind === "repeat") return [step.recipeId];
      if (step.kind === "branch") {
        return [step.thenRecipeId, ...(step.elseRecipeId ? [step.elseRecipeId] : [])];
      }
      return [];
    });

  async function visit(recipe: Recipe, path: string[]): Promise<void> {
    if (visiting.has(recipe.id)) {
      throw new Error(`reusable test cycle: ${[...path, recipe.id].join(" → ")}`);
    }
    visiting.add(recipe.id);
    for (const dependencyId of dependencies(recipe)) {
      const existing = graph[dependencyId];
      const dependency = existing ?? (await readRecipe(dependencyId));
      if (!dependency) {
        throw new Error(`reusable test not found: ${dependencyId}`);
      }
      if (!existing) graph[dependencyId] = structuredClone(dependency);
      await visit(dependency, [...path, recipe.id]);
    }
    visiting.delete(recipe.id);
  }

  await visit(root, []);
  return graph;
}

export async function freezeRecipeExecution(recipeId: string): Promise<{
  recipeSnapshot: Recipe;
  recipeGraph: FrozenRecipeGraph;
}> {
  const recipeSnapshot = await readRecipe(recipeId);
  if (!recipeSnapshot) throw new Error(`recipe not found: ${recipeId}`);
  return {
    recipeSnapshot: structuredClone(recipeSnapshot),
    recipeGraph: await freezeRecipeGraph(recipeSnapshot),
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

async function ensureRecipesRoot(): Promise<void> {
  await mkdir(recipesRoot(), { recursive: true });
}

async function ensureTestsRoot(): Promise<void> {
  await mkdir(testsRoot(), { recursive: true });
}

export type SaveRecipeInput = {
  id?: string;
  expectedRevision: number;
  title: string;
  description?: string;
  variables?: Record<string, string>;
  parameters?: RecipeParameter[];
  steps: RecipeStep[];
  quarantined?: boolean;
  quarantineReason?: string;
  recordingFormatVersion?: RecordingFormatVersion;
};

const recipeWrites = new KeyedSerialQueue();
const recipeIdempotency = new BoundedIdempotencyStore<Recipe>();

function recipeConflict(current: Recipe | null): RevisionConflict<Recipe | null> {
  const revision = current?.updatedAt ?? 0;
  const snapshot: Revisioned<Recipe | null> = {
    revision,
    value: current,
    updatedAt: revision,
    ...(currentOperationContext()?.actorId
      ? { updatedBy: currentOperationContext()!.actorId }
      : {}),
  };
  return new RevisionConflict(snapshot);
}

/**
 * Create or overwrite a recipe. Packaged ids are persisted as user overrides,
 * so every catalog item has the same edit semantics.
 */
async function saveRecipeUnchecked(input: SaveRecipeInput): Promise<Recipe> {
  const steps = validateRecipeSteps(input.steps);
  const variables = validateRecipeVariables(input.variables ?? undefined);
  const parameters = validateRecipeParameters(input.parameters ?? undefined);
  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    throw new Error("title is required");
  }
  const requestedAt = now();
  let id = input.id?.trim();
  if (!id) {
    id = `custom-${slugify(input.title)}-${requestedAt.toString(36)}`;
  }
  // If overwriting, preserve createdAt.
  const stored = await readStoredRecipeYaml(testsRoot(), id);
  const existing = stored?.recipe ?? null;
  const ts = Math.max(requestedAt, (existing?.updatedAt ?? 0) + 1);
  const quarantineReason = input.quarantineReason ?? existing?.quarantineReason;
  const recipe: Recipe = {
    id,
    title: input.title,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.variables !== undefined
      ? variables
        ? { variables }
        : {}
      : existing?.variables
        ? { variables: existing.variables }
        : {}),
    ...(input.parameters !== undefined
      ? parameters
        ? { parameters }
        : {}
      : existing?.parameters
        ? { parameters: existing.parameters }
        : {}),
    source: "custom",
    recordingFormatVersion:
      input.recordingFormatVersion ??
      existing?.recordingFormatVersion ??
      CURRENT_RECORDING_FORMAT_VERSION,
    steps,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
    ...((input.quarantined ?? existing?.quarantined) ? { quarantined: true } : {}),
    ...(quarantineReason?.trim() ? { quarantineReason: quarantineReason.trim() } : {}),
  };
  await ensureRecipesRoot();
  await ensureTestsRoot();
  if (existing) {
    const historyDir = join(recipesRoot(), ".history", id);
    await mkdir(historyDir, { recursive: true });
    await writeFile(
      join(historyDir, `${existing.updatedAt}.relay.plan.yaml`),
      formatRecipeYaml(existing),
      { encoding: "utf8", flag: "wx" },
    ).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    });
    const historyLimit = Math.max(1, Number(process.env.RELAY_RECIPE_HISTORY_LIMIT ?? 100));
    const historyFiles = (await readdir(historyDir)).sort().reverse();
    await Promise.all(
      historyFiles
        .slice(historyLimit)
        .map((file) => unlink(join(historyDir, file)).catch(() => undefined)),
    );
  }
  const destination = recipeYamlPath(testsRoot(), id);
  await atomicWriteFile(destination, formatRecipeYaml(recipe));
  if (stored?.contract === "legacy-recipe") {
    await unlink(stored.path).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    });
  }
  const persisted = await stat(destination);
  recipe.updatedAt = persisted.mtimeMs;
  return recipe;
}

export async function saveRecipe(input: SaveRecipeInput): Promise<Recipe> {
  const operation = currentOperationContext();
  const fingerprint = payloadFingerprint(input);
  const requestedId = input.id?.trim();
  const generatedSuffix = operation
    ? payloadFingerprint({
        organizationId: operation.organizationId,
        projectId: operation.projectId,
        operationId: operation.operationId,
        idempotencyKey: operation.idempotencyKey,
      }).slice(0, 12)
    : `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const id = requestedId || `custom-${slugify(input.title)}-${generatedSuffix}`;
  const normalizedInput = { ...input, id };
  const resourceIdentity = `${testsRoot()}:${requestedId ?? `create:${operation?.idempotencyKey ?? id}`}`;
  const queueKey = `${operation?.organizationId ?? "local"}\u0000${operation?.projectId ?? "default"}\u0000recipe\u0000${resourceIdentity}`;
  const replayKey = operation
    ? scopedIdempotencyKey({
        organizationId: operation.organizationId,
        projectId: operation.projectId,
        operationId: operation.operationId,
        idempotencyKey: operation.idempotencyKey,
        resourceKind: "recipe",
        resourceId: resourceIdentity,
      })
    : undefined;
  return recipeWrites.run(queueKey, async () => {
    const replay = replayKey ? recipeIdempotency.get(replayKey, fingerprint) : undefined;
    if (replay) return structuredClone(replay);
    const current = await readRecipe(id);
    const revision = current?.updatedAt ?? 0;
    if (normalizedInput.expectedRevision !== revision) {
      throw recipeConflict(current);
    }
    const saved = await saveRecipeUnchecked(normalizedInput);
    publish({
      type: current ? "resource.updated" : "resource.created",
      at: saved.updatedAt,
      projectId: currentOperationContext()?.projectId ?? "default",
      resource: "recipe",
      resourceId: saved.id,
      revision: saved.updatedAt,
    });
    if (replayKey) recipeIdempotency.set(replayKey, fingerprint, saved);
    return saved;
  });
}

export async function listRecipeHistory(id: string): Promise<Recipe[]> {
  const dir = join(recipesRoot(), ".history", evidencePart(id, "recipeId"));
  try {
    const entries = (await readdir(dir))
      .filter((file) => file.endsWith(".relay.plan.yaml") || file.endsWith(".relay.yaml"))
      .sort()
      .reverse();
    const versions: Recipe[] = [];
    for (const file of entries.slice(0, 50)) {
      const parsed = await readYamlRecipeFile(join(dir, file));
      if (parsed) versions.push(parsed);
    }
    return versions;
  } catch {
    return [];
  }
}

export async function restoreRecipeHistory(id: string, updatedAt: number): Promise<Recipe> {
  const versions = await listRecipeHistory(id);
  const version = versions.find((item) => item.updatedAt === updatedAt);
  if (!version) throw new Error("recipe version not found");
  const current = await readRecipe(id);
  return saveRecipe({
    id,
    title: version.title,
    description: version.description,
    variables: version.variables,
    parameters: version.parameters,
    steps: version.steps,
    quarantined: version.quarantined,
    quarantineReason: version.quarantineReason,
    expectedRevision: current?.updatedAt ?? 0,
  });
}

/** Delete a custom recipe or packaged override. Packaged defaults are immutable
 * runtime primitives and reappear when their YAML override is removed. */
export async function deleteRecipe(id: string): Promise<void> {
  await ensureRecipesRoot();
  await ensureTestsRoot();
  await rm(evidenceDir(id), { recursive: true, force: true });
  const yamlPath = recipeYamlPath(testsRoot(), id);
  await Promise.all(
    [yamlPath, legacyRecipeYamlPath(testsRoot(), id)].map((path) =>
      unlink(path).catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }),
    ),
  );
  publish({
    type: "resource.deleted",
    at: now(),
    projectId: currentOperationContext()?.projectId ?? "default",
    resource: "recipe",
    resourceId: id,
  });
}
