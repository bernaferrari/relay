import assert from "node:assert/strict";
import test from "node:test";
import { loadRecipeYaml, saveRecipe } from "./server-recipe-remote";

test("keeps recipe persistence endpoint construction in one module", async () => {
  const calls: string[] = [];
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/yaml")) return { yaml: "schemaVersion: 1" } as T;
    return { journey: { id: "login", title: "Login", steps: [] } } as T;
  };
  await saveRecipe(request, { id: "login", expectedRevision: 12, title: "Login", steps: [] });
  assert.equal(await loadRecipeYaml(request, "login"), "schemaVersion: 1");
  assert.deepEqual(calls, ["PUT /journeys/login", "GET /journeys/login/yaml"]);
});
