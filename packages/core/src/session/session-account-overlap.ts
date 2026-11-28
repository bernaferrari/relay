/** Runtime sign-in account validation and scheduler-lane projection. */
import type { ExecutionTargetRef } from "@relay/protocol";
import { jobSchedulingTargetId } from "../browser/browser-account-lane.js";
import type { Recipe } from "../recipe/recipes.js";
import { savedSignInKeysForRecipeGraph } from "../sign-in/sign-in-admission.js";
import type { BrowserAccountOverlap } from "./session-contract.js";

export function signInKeysForScheduling(recipeGraph: Record<string, Recipe> | undefined): string[] {
  if (!recipeGraph) return [];
  try {
    return savedSignInKeysForRecipeGraph(recipeGraph);
  } catch {
    return ["unknown-sign-in"];
  }
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

/** Accept only non-secret account admission that exactly matches the frozen
 * executable graph and has a project scope. Any mismatch is deliberately not
 * partially trusted: the caller falls back to the legacy serializing lane. */
export function validatedBrowserAccountOverlap(input: {
  overlap?: BrowserAccountOverlap;
  recipeGraph?: Record<string, Recipe>;
  projectId?: string;
}): BrowserAccountOverlap | undefined {
  const overlap = input.overlap;
  const projectId = input.projectId?.trim();
  if (!overlap || !projectId) return undefined;
  if (
    overlap.sharing !== "safe-shared-read" &&
    overlap.sharing !== "isolated-account" &&
    overlap.sharing !== "isolated-lane"
  ) {
    return undefined;
  }
  const keys = [...new Set(overlap.accountKeys.map((key) => key.trim()))]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  const graphKeys = signInKeysForScheduling(input.recipeGraph);
  if (
    !keys.length ||
    keys.length !== overlap.accountKeys.length ||
    !graphKeys.length ||
    graphKeys[0] === "unknown-sign-in" ||
    !sameKeys(keys, graphKeys)
  ) {
    return undefined;
  }
  return Object.freeze({
    accountKeys: Object.freeze([...keys]),
    sharing: overlap.sharing,
  });
}

function encodedAccountSet(projectId: string, keys: readonly string[]): string {
  return `account:${encodeURIComponent(projectId)}:${keys.map(encodeURIComponent).join(",")}`;
}

/** Scheduler target for a job. Runtime sign-in accounts share one stable
 * account-set lane (`target#signed-out:account:...`) so same-account work does
 * not consume browser host slots while serialized. The separate per-run
 * `unsignedLaneId` remains the one-shot Playwright session key and is what
 * retries refresh; the stable lane is only scheduler admission. The prefix is
 * intentionally `signed-out:` because runtime sign-in starts in signed-out
 * browser storage and existing target-control recovery understands that lane
 * namespace. */
export function sessionJobSchedulingTargetId(input: {
  executionTarget: ExecutionTargetRef;
  browserCaseProfile?: { authenticationFixtureId?: string };
  unsignedLaneId?: string;
  browserAccountOverlap?: BrowserAccountOverlap;
  recipeGraph?: Record<string, Recipe>;
  projectId?: string;
}): string {
  const overlap = validatedBrowserAccountOverlap({
    ...(input.browserAccountOverlap ? { overlap: input.browserAccountOverlap } : {}),
    ...(input.recipeGraph ? { recipeGraph: input.recipeGraph } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
  });
  if (overlap && input.executionTarget.kind === "local-browser") {
    const projectId = input.projectId!.trim();
    return `${input.executionTarget.identity.value}#signed-out:${encodedAccountSet(projectId, overlap.accountKeys)}`;
  }
  return jobSchedulingTargetId({
    executionTarget: input.executionTarget,
    ...(input.browserCaseProfile ? { browserCaseProfile: input.browserCaseProfile } : {}),
    ...(input.unsignedLaneId ? { unsignedLaneId: input.unsignedLaneId } : {}),
  });
}
