import type { Accessor } from "solid-js";
import type { RecipeInfo, RecipeParameter, RecipeStability, RecipeStep } from "./api-types";
import {
  deleteRecipe,
  importRecipeYaml as importRecipeYamlRemote,
  loadRecipeHistory as loadRecipeHistoryRemote,
  loadRecipeStability as loadRecipeStabilityRemote,
  loadRecipeYaml as loadRecipeYamlRemote,
  previewRecipeYaml as previewRecipeYamlRemote,
  restoreRecipeVersion as restoreRecipeVersionRemote,
  saveRecipe as saveRecipeRemoteRequest,
} from "./server-recipe-remote";
import { toast } from "../context/toast";

type Request = <T = unknown>(path: string, init?: RequestInit, timeoutMs?: number) => Promise<T>;

export function createServerRecipeController(input: {
  request: Request;
  recipes: Accessor<RecipeInfo[]>;
  selectedRecipeId: Accessor<string | null>;
  setSelectedRecipeId: (id: string | null) => void;
  refreshRecipes: () => Promise<void>;
  appendLog: (text: string, level?: "info" | "success" | "error", jobId?: string) => void;
}) {
  async function saveRecipe(inputValue: {
    id?: string;
    title: string;
    description?: string;
    variables?: Record<string, string>;
    parameters?: RecipeParameter[];
    steps: RecipeStep[];
    quarantined?: boolean;
    quarantineReason?: string;
  }): Promise<RecipeInfo | null> {
    try {
      const recipe = await saveRecipeRemoteRequest(input.request, {
        ...inputValue,
        expectedRevision: input.recipes().find((item) => item.id === inputValue.id)?.updatedAt ?? 0,
      });
      await input.refreshRecipes();
      return recipe;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      input.appendLog(message, "error");
      toast(message, "error");
      return null;
    }
  }

  async function loadRecipeYaml(id: string): Promise<string | null> {
    try {
      return await loadRecipeYamlRemote(input.request, id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      input.appendLog(message, "error");
      toast(message, "error");
      return null;
    }
  }

  async function previewRecipeYaml(yaml: string): Promise<{
    recipe: RecipeInfo;
    exists: boolean;
    canonicalYaml: string;
  }> {
    return previewRecipeYamlRemote(input.request, yaml);
  }

  async function importRecipeYaml(
    yaml: string,
    conflict: "reject" | "replace" | "copy" = "reject",
  ): Promise<RecipeInfo | null> {
    try {
      const recipe = await importRecipeYamlRemote(input.request, yaml, conflict);
      await input.refreshRecipes();
      toast(`Imported “${recipe.title}”`, "success");
      return recipe;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      input.appendLog(message, "error");
      toast(message, "error");
      return null;
    }
  }

  function loadRecipeHistory(id: string): Promise<RecipeInfo[]> {
    return loadRecipeHistoryRemote(input.request, id);
  }

  async function restoreRecipeVersion(id: string, updatedAt: number): Promise<RecipeInfo> {
    const recipe = await restoreRecipeVersionRemote(input.request, id, updatedAt);
    await input.refreshRecipes();
    return recipe;
  }

  function loadRecipeStability(id: string): Promise<RecipeStability> {
    return loadRecipeStabilityRemote(input.request, id);
  }

  async function deleteRecipeRemote(id: string): Promise<void> {
    try {
      await deleteRecipe(input.request, id);
      if (input.selectedRecipeId() === id) input.setSelectedRecipeId(null);
      await input.refreshRecipes();
      toast("Test deleted", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      input.appendLog(message, "error");
      toast(message, "error");
    }
  }

  return {
    saveRecipeRemote: saveRecipe,
    loadRecipeYaml,
    previewRecipeYaml,
    importRecipeYaml,
    loadRecipeHistory,
    restoreRecipeVersion,
    loadRecipeStability,
    deleteRecipeRemote,
  };
}
