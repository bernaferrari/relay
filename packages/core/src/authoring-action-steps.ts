/**
 * Turn one explicit authoring interaction into replayable, stable Recipe
 * steps. Session persistence and device observation stay outside this module.
 */
import { randomUUID } from "node:crypto";
import type { AuthoringAction, AuthoringInteraction, RecipeStep } from "@relay/protocol";
import { recordedPauseDuration } from "./authoring-recorded-pause.js";
import { AuthoringStateError } from "./authoring-session-state.js";
import { validateRecipeSteps } from "./recipes.js";

function stableStep(step: RecipeStep, actionId: string, index: number, group?: string): RecipeStep {
  return {
    ...structuredClone(step),
    id: step.id?.trim() || `${actionId}-step-${index + 1}`,
    ...(group?.trim() && !step.group ? { group: group.trim() } : {}),
  };
}

export function stepsForInteraction(
  interaction: AuthoringInteraction,
  actionId: string,
  group?: string,
): RecipeStep[] {
  let steps: RecipeStep[];
  switch (interaction.kind) {
    case "tap":
      steps = [
        {
          kind: "tap",
          target: structuredClone(interaction.target),
          ...(interaction.expectedApp ? { expectedApp: interaction.expectedApp } : {}),
        },
      ];
      break;
    case "type":
      steps = checkedSteps([
        {
          kind: "type",
          text: interaction.text,
          ...(interaction.target ? { target: structuredClone(interaction.target) } : {}),
          ...(interaction.mode ? { mode: interaction.mode } : {}),
        },
      ]);
      break;
    case "clipboard":
      steps = checkedSteps([
        {
          kind: "clipboard",
          action: interaction.action,
          ...(interaction.text !== undefined ? { text: interaction.text } : {}),
          ...(interaction.target ? { target: structuredClone(interaction.target) } : {}),
          ...(interaction.expect !== undefined ? { expect: interaction.expect } : {}),
          ...(interaction.match ? { match: interaction.match } : {}),
        },
      ]);
      break;
    case "app":
      steps = [
        {
          kind: "app",
          action: interaction.action,
          ...(interaction.app !== undefined ? { app: interaction.app } : {}),
          ...(interaction.url !== undefined ? { url: interaction.url } : {}),
          ...(interaction.relaunch !== undefined ? { relaunch: interaction.relaunch } : {}),
          ...(interaction.artifact !== undefined ? { artifact: interaction.artifact } : {}),
          ...(interaction.as !== undefined ? { as: interaction.as } : {}),
          ...(interaction.version !== undefined ? { version: interaction.version } : {}),
          ...(interaction.versionMatch ? { versionMatch: interaction.versionMatch } : {}),
        },
      ];
      break;
    case "device":
      steps = [{ kind: "device", action: interaction.action }];
      break;
    case "rotate":
      steps = [{ kind: "rotate", orientation: interaction.orientation }];
      break;
    case "swipe":
      steps = [
        {
          kind: "swipe",
          from: { ...interaction.from },
          to: { ...interaction.to },
          ...(interaction.durationMs !== undefined ? { durationMs: interaction.durationMs } : {}),
        },
      ];
      break;
    case "key":
      steps = [{ kind: "key", key: interaction.key }];
      break;
    case "wait":
      if (!Number.isFinite(interaction.ms) || interaction.ms < 0) {
        throw new AuthoringStateError("Wait duration must be non-negative");
      }
      steps = interaction.ms === 0 ? [] : [{ kind: "sleep", ms: interaction.ms }];
      break;
    case "observe":
    case "screenshot":
      steps = [];
      break;
    case "reusable":
      steps = checkedSteps([
        {
          kind: "module",
          recipeId: interaction.recipeId,
          ...(interaction.bindings ? { bindings: structuredClone(interaction.bindings) } : {}),
        },
      ]);
      break;
    case "steps":
      steps = checkedSteps(structuredClone(interaction.steps));
      break;
  }
  return steps.map((step, index) => stableStep(step, actionId, index, group));
}

function checkedSteps(steps: unknown): RecipeStep[] {
  try {
    return validateRecipeSteps(steps);
  } catch (error) {
    throw new AuthoringStateError(error instanceof Error ? error.message : String(error));
  }
}

export function actionSource(interaction: AuthoringInteraction): AuthoringAction["source"] {
  if (interaction.kind === "reusable") return "reusable";
  if (
    interaction.kind === "steps" ||
    interaction.kind === "observe" ||
    interaction.kind === "screenshot" ||
    interaction.kind === "wait" ||
    interaction.kind === "clipboard" ||
    interaction.kind === "app" ||
    interaction.kind === "device" ||
    interaction.kind === "rotate"
  )
    return "manual";
  return "captured";
}

export function recordedPauseAction(input: {
  durationMs: number;
  finishedAt: number;
  evidenceIds?: string[];
  group?: string;
}): AuthoringAction | undefined {
  // Keep this constructor for compatibility with historical captured Takes;
  // new recording sessions only create timing through explicit wait input.
  const durationMs = recordedPauseDuration(input.durationMs);
  if (durationMs === 0) return undefined;
  const actionId = `action-${randomUUID()}`;
  return {
    id: actionId,
    source: "captured",
    label: "Recorded pause",
    recordedAt: input.finishedAt - durationMs,
    startedAt: input.finishedAt - durationMs,
    finishedAt: input.finishedAt,
    steps: stepsForInteraction({ kind: "wait", ms: durationMs }, actionId, input.group),
    evidenceIds: [...(input.evidenceIds ?? [])],
  };
}
