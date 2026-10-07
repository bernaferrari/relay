import raw from "./native-fast-authored-run.json?raw";

type FrozenRecipe = { id: string; steps: Record<string, unknown>[] };
type RetainedTrace = {
  id: string;
  index: number;
  recipeId: string;
  recipeStepId: string;
  title: string;
  status: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  frames: { path: string; caption: string }[];
};
type RetainedIntent = {
  kind: string;
  data: {
    schemaVersion: number;
    kind: string;
    child: {
      schemaVersion: number;
      kind: string;
      plan: {
        schemaVersion: number;
        test: { id: string; name: string };
        rootRecipeId: string;
        stepProvenance: {
          recipeId: string;
          recipeStepId: string;
          stepIndex: number;
          testId: string;
          testStepId: string;
        }[];
      };
      recipeGraph: Record<string, FrozenRecipe>;
    };
    wrapper: Record<string, unknown>;
  };
};
/** Retained iPad Fast Run a1a09d67: 31 real traces; inputs, AX and image bytes omitted. */
export const retainedNativeFastRun: {
  id: string;
  title: string;
  outcome: string;
  status: string;
  platform: string;
  durationMs: number;
  steps: RetainedTrace[];
  frames: { path: string; caption: string; stepId: string }[];
  artifacts: RetainedIntent[];
  recipeGraph: Record<string, FrozenRecipe>;
  recipeSnapshot: FrozenRecipe;
} = JSON.parse(raw);
