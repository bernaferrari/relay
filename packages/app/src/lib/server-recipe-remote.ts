import type { RecipeInfo, RecipeParameter, RecipeStability, RecipeStep } from "./api-types";
import type { ServerRequest } from "./server-matrix-remote";

export type RecipeSaveInput = {
  id?: string;
  title: string;
  description?: string;
  variables?: Record<string, string>;
  parameters?: RecipeParameter[];
  steps: RecipeStep[];
  quarantined?: boolean;
  quarantineReason?: string;
};

export async function saveRecipe(
  request: ServerRequest,
  input: RecipeSaveInput,
): Promise<RecipeInfo> {
  const body = {
    title: input.title,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.variables !== undefined ? { variables: input.variables } : {}),
    ...(input.parameters !== undefined ? { parameters: input.parameters } : {}),
    steps: input.steps,
    ...(input.quarantined !== undefined ? { quarantined: input.quarantined } : {}),
    ...(input.quarantineReason !== undefined ? { quarantineReason: input.quarantineReason } : {}),
  };
  const data = await request<{ journey: RecipeInfo }>(
    input.id ? `/journeys/${encodeURIComponent(input.id)}` : "/journeys",
    { method: input.id ? "PUT" : "POST", body: JSON.stringify(body) },
  );
  return data.journey;
}

export async function loadRecipeYaml(request: ServerRequest, id: string): Promise<string> {
  const data = await request<{ yaml: string }>(`/journeys/${encodeURIComponent(id)}/yaml`);
  return data.yaml;
}

export async function previewRecipeYaml(
  request: ServerRequest,
  yaml: string,
): Promise<{ recipe: RecipeInfo; exists: boolean; canonicalYaml: string }> {
  const data = await request<{
    preview: { journey: RecipeInfo; exists: boolean; canonicalYaml: string };
  }>("/journeys/import", { method: "POST", body: JSON.stringify({ yaml, dryRun: true }) });
  return {
    recipe: data.preview.journey,
    exists: data.preview.exists,
    canonicalYaml: data.preview.canonicalYaml,
  };
}

export async function importRecipeYaml(
  request: ServerRequest,
  yaml: string,
  conflict: "reject" | "replace" | "copy",
): Promise<RecipeInfo> {
  const data = await request<{ journey: RecipeInfo }>("/journeys/import", {
    method: "POST",
    body: JSON.stringify({ yaml, conflict }),
  });
  return data.journey;
}

export async function loadRecipeHistory(request: ServerRequest, id: string): Promise<RecipeInfo[]> {
  const data = await request<{ versions: RecipeInfo[] }>(
    `/journeys/${encodeURIComponent(id)}/history`,
  );
  return data.versions;
}

export async function restoreRecipeVersion(
  request: ServerRequest,
  id: string,
  updatedAt: number,
): Promise<RecipeInfo> {
  const data = await request<{ journey: RecipeInfo }>(
    `/journeys/${encodeURIComponent(id)}/history`,
    {
      method: "POST",
      body: JSON.stringify({ updatedAt }),
    },
  );
  return data.journey;
}

export async function loadRecipeStability(
  request: ServerRequest,
  id: string,
): Promise<RecipeStability> {
  const data = await request<{ stability: RecipeStability }>(
    `/journeys/${encodeURIComponent(id)}/stability`,
  );
  return data.stability;
}

export function deleteRecipe(request: ServerRequest, id: string): Promise<void> {
  return request(`/journeys/${encodeURIComponent(id)}`, { method: "DELETE" });
}
