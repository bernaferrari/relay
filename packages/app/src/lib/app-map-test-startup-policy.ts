import type { AppMapCompiledTest, AppMapTestStartup, RecipeStep, Screen } from "@relay/protocol";

export type AppMapTestCheckpointOption = { screenId: string; label: string };
export type AppMapTestStartupScreenSource = {
  screens: Record<string, Pick<Screen, "id" | "title" | "identity">>;
};

export const coldAppMapTestStartup: AppMapTestStartup = { mode: "cold" };

/** Only named, identity-bearing screens are candidates for a live entry proof.
 * The compiler remains the authority on whether that screen is reachable in
 * this particular Test; the picker never invents a coordinate or a fallback. */
export function appMapTestCheckpointOptions(
  map: AppMapTestStartupScreenSource | null | undefined,
): AppMapTestCheckpointOption[] {
  if (!map) return [];
  return Object.values(map.screens)
    .filter((screen) => Boolean(screen.identity?.fingerprint))
    .map((screen) => ({ screenId: screen.id, label: screen.title }))
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) || left.screenId.localeCompare(right.screenId),
    );
}

export function sameAppMapTestStartup(left: AppMapTestStartup, right: AppMapTestStartup): boolean {
  return (
    left.mode === right.mode &&
    (left.mode !== "verified-checkpoint" ||
      right.mode !== "verified-checkpoint" ||
      left.screenId === right.screenId)
  );
}

/** Count only operations reachable from the Test root. Recovery alternatives
 * live beside the graph for review, but are not part of the normal plan. An
 * omitted `relaunch` means the device adapter's normal open semantics, so it
 * still counts as a saved relaunch. */
export function appMapTestPlanRelaunchCount(
  plan: Pick<AppMapCompiledTest, "rootRecipeId" | "recipes">,
): number {
  const visited = new Set<string>();
  let count = 0;
  const visitRecipe = (recipeId: string): void => {
    if (visited.has(recipeId)) return;
    visited.add(recipeId);
    const recipe = plan.recipes[recipeId];
    if (!recipe) return;
    for (const step of recipe.steps) visitStep(step);
  };
  const visitStep = (step: RecipeStep): void => {
    if (step.kind === "app" && step.action === "open" && step.relaunch !== false) count += 1;
    if (step.kind === "module" || step.kind === "repeat") {
      visitRecipe(step.recipeId);
    } else if (step.kind === "branch") {
      visitRecipe(step.thenRecipeId);
      if (step.elseRecipeId) visitRecipe(step.elseRecipeId);
    }
  };
  visitRecipe(plan.rootRecipeId);
  return count;
}

export function appMapTestStartupCopy(input: {
  startup: AppMapTestStartup;
  screenTitle?: string;
  relaunchCount?: number;
}): { label: string; detail: string; retryDetail: string } {
  const { startup, screenTitle, relaunchCount } = input;
  if (startup.mode === "verified-checkpoint") {
    const screen = screenTitle ? `${screenTitle} (${startup.screenId})` : startup.screenId;
    const savedRelaunches =
      relaunchCount === undefined
        ? ""
        : relaunchCount
          ? ` The saved suffix contains ${relaunchCount} ${relaunchCount === 1 ? "app-open operation that relaunches" : "app-open operations that relaunch"}.`
          : " The saved suffix contains no app relaunch.";
    return {
      label: `Verified checkpoint · ${screenTitle ?? startup.screenId}`,
      detail: `Relay first proves the live ${screen} checkpoint, then runs only its suffix. A mismatch stops for review; it never falls back to the cold prefix or relaunches to recover.${savedRelaunches}`,
      retryDetail:
        "A paused job resumes this exact plan. Starting another run requires an explicit startup choice; Relay never converts this checkpoint into a cold retry.",
    };
  }
  const relaunches =
    relaunchCount === undefined
      ? "A relaunch can occur only when the saved plan explicitly opens an app."
      : relaunchCount
        ? `This executable plan contains ${relaunchCount} ${relaunchCount === 1 ? "app-open operation that relaunches" : "app-open operations that relaunch"}.`
        : "This executable plan contains no app relaunch.";
  return {
    label: "Cold baseline",
    detail: `Relay runs the saved Test from its authored beginning. ${relaunches}`,
    retryDetail:
      "A paused job resumes its existing plan. A new run must choose cold or a verified checkpoint explicitly; no failed branch silently restarts the app.",
  };
}
