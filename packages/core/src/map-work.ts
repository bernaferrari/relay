import type {
  AppMap,
  AppMapCombine,
  AppMapCompiledTest,
  AppMapScenarioTest,
  RecipeStep,
} from "@relay/protocol";
import { compileAppMapScenarioTest } from "./app-map-test-compiler.js";
import type { AppMapTestCompileOptions } from "./app-map-test-compiler.js";
export { AppMapTestCompileError } from "./app-map-test-compiler.js";
export type { AppMapTestCompileOptions } from "./app-map-test-compiler.js";
import type { Recipe } from "./recipes.js";

/** Compile the only supported Test contract: graph-native scenario intent. */
export function compileAppMapTest(
  map: AppMap,
  test: AppMapScenarioTest,
  options: AppMapTestCompileOptions = {},
): { root: Recipe; graph: Record<string, Recipe>; plan: AppMapCompiledTest } {
  return compileAppMapScenarioTest(map, test, options);
}

/** Compile a matrix's Tests in their saved order. Variables are applied by the
 * matrix runner; each Test remains an independently inspectable module. */
export function compileAppMapCombine(
  map: AppMap,
  combine: AppMapCombine,
): { root: Recipe; graph: Record<string, Recipe> } {
  if (!combine.testIds.length) throw new Error("Combination needs at least one test");
  const graph: Record<string, Recipe> = {};
  const modules: RecipeStep[] = [];
  for (const testId of combine.testIds) {
    const test = map.tests?.[testId];
    if (!test) throw new Error(`Test ${testId} is missing`);
    const compiled = compileAppMapTest(map, {
      ...test,
      ...(combine.captures?.[testId] ? { capture: combine.captures[testId] } : {}),
    });
    Object.assign(graph, compiled.graph);
    modules.push({
      id: `relay-check-${testId}`,
      kind: "module",
      recipeId: compiled.root.id,
      check: { id: testId, title: test.name },
    });
  }
  const root: Recipe = {
    id: `combine-${combine.id}`,
    title: combine.name,
    source: "custom",
    steps: modules,
    createdAt: map.updatedAt,
    updatedAt: map.updatedAt,
  };
  graph[root.id] = root;
  return { root, graph };
}
