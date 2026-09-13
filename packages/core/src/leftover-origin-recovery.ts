import type { AppMap, Connection, RecipeStep, Screen } from "@relay/protocol";
import { compileAppMapConnection } from "./app-map-compiler.js";

type MappedPreludeGesture = Extract<RecipeStep, { kind: "tap" | "key" | "swipe" | "scroll" }>;

export type LeftoverConversationPrelude = {
  preludeSteps: MappedPreludeGesture[];
  preludeStartFingerprint: string;
  preludeStartAliases?: string[];
};

/** Wait-for as the first compiled step is the origin proof. Dest-end and
 * dest-screen share that chrome (Library on leftover conversation and empty
 * home). Requiring dest-end only strands dest-screen leftover. */
export function waitForIsIndependentlySourceProven(sourceProof: RecipeStep | undefined): boolean {
  return sourceProof?.kind === "wait-for";
}

function firstAuthoredStep(connection: Connection): RecipeStep | undefined {
  for (const action of connection.actions) {
    if (action.kind === "steps" || action.kind === "recorded") return action.steps[0];
    if (action.kind === "tap") return { kind: "tap", target: action.target };
  }
  return undefined;
}

function connectionHasNewChatTap(connection: Connection): boolean {
  for (const action of connection.actions) {
    if (action.kind === "tap" && action.target.identifier === "new-chat") return true;
    if (action.kind === "steps" || action.kind === "recorded") {
      if (
        action.steps.some((step) => step.kind === "tap" && step.target.identifier === "new-chat")
      ) {
        return true;
      }
    }
  }
  return false;
}

function isAuthExitConnection(connection: Connection): boolean {
  const id = connection.id.toLowerCase();
  if (
    id.includes("sign-out") ||
    id.includes("signout") ||
    id.includes("log-out") ||
    id.includes("logout")
  ) {
    return true;
  }
  for (const action of connection.actions) {
    const taps =
      action.kind === "tap"
        ? [action]
        : action.kind === "steps" || action.kind === "recorded"
          ? action.steps.filter((step) => step.kind === "tap")
          : [];
    for (const tap of taps) {
      if (tap.kind !== "tap") continue;
      const label = tap.target.label?.trim().toLowerCase() ?? "";
      if (label === "sign out" || label === "log out") return true;
    }
  }
  return false;
}

function isWaitForOriginConnection(connection: Connection): boolean {
  return firstAuthoredStep(connection)?.kind === "wait-for" && !isAuthExitConnection(connection);
}

function isNewChatReturnConnection(connection: Connection): boolean {
  return connection.destination.kind === "end" && connectionHasNewChatTap(connection);
}

function leftoverDestinationScreens(map: AppMap, originScreenId: string): Screen[] {
  const screens: Screen[] = [];
  const seen = new Set<string>();
  for (const connection of Object.values(map.connections)) {
    if (
      connection.state !== "ready" ||
      connection.fromScreenId !== originScreenId ||
      connection.destination.kind !== "screen" ||
      connection.destination.screenId === originScreenId ||
      !isWaitForOriginConnection(connection)
    ) {
      continue;
    }
    const screen = map.screens[connection.destination.screenId];
    if (!screen || seen.has(screen.id)) continue;
    seen.add(screen.id);
    screens.push(screen);
  }
  return screens;
}

function preludeGestureFromCompiledStep(step: RecipeStep): MappedPreludeGesture | undefined {
  if (step.kind === "tap") {
    return {
      kind: "tap",
      target: structuredClone(step.target),
      ...(step.fallbackTargets?.length
        ? { fallbackTargets: structuredClone(step.fallbackTargets) }
        : {}),
    };
  }
  if (step.kind === "key") return { kind: "key", key: step.key };
  if (step.kind === "swipe") {
    return {
      kind: "swipe",
      from: structuredClone(step.from),
      to: structuredClone(step.to),
      ...(step.durationMs === undefined ? {} : { durationMs: step.durationMs }),
    };
  }
  if (step.kind === "scroll") {
    return {
      kind: "scroll",
      direction: step.direction,
      ...(step.amount === undefined ? {} : { amount: step.amount }),
    };
  }
  return undefined;
}

function compileNewChatReturnGestures(map: AppMap, originScreenId: string): MappedPreludeGesture[] {
  const connection = Object.values(map.connections).find(
    (candidate) =>
      candidate.state === "ready" &&
      candidate.fromScreenId === originScreenId &&
      isNewChatReturnConnection(candidate),
  );
  if (!connection) return [];
  const compiled = compileAppMapConnection(map, connection.id);
  const recipe = compiled.recipes[compiled.rootRecipeId];
  if (!recipe) return [];
  const steps: MappedPreludeGesture[] = [];
  for (const step of recipe.steps) {
    const gesture = preludeGestureFromCompiledStep(step);
    if (!gesture) continue;
    steps.push(gesture);
    if (steps.length >= 16) break;
  }
  return steps;
}

function leftoverIdentityFingerprints(screens: Screen[]): string[] {
  const fingerprints: string[] = [];
  const seen = new Set<string>();
  for (const screen of screens) {
    for (const fingerprint of [screen.identity?.fingerprint, ...(screen.identity?.aliases ?? [])]) {
      if (!fingerprint || seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      fingerprints.push(fingerprint);
    }
  }
  return fingerprints;
}

/** Tests that expect empty home can New Chat from leftover conversation.
 * Only dest-screen wait-for leftovers count — Sign Out / handoff dest-screen
 * is not a recoverable chat cursor. */
export function leftoverConversationHomePrelude(
  map: AppMap,
  originScreenId: string,
): LeftoverConversationPrelude | undefined {
  const leftovers = leftoverDestinationScreens(map, originScreenId);
  const fingerprints = leftoverIdentityFingerprints(leftovers);
  const preludeSteps = compileNewChatReturnGestures(map, originScreenId);
  if (!fingerprints.length || !preludeSteps.length) return undefined;
  const [preludeStartFingerprint, ...preludeStartAliases] = fingerprints;
  return {
    preludeSteps,
    preludeStartFingerprint: preludeStartFingerprint!,
    ...(preludeStartAliases.length ? { preludeStartAliases } : {}),
  };
}

/** Warm confirmation used to replay wait-for + tap from leftover conversation.
 * New Chat first makes leftover a safe origin instead of SOS-replaying the
 * same connection from an unknown cursor. */
export function leftoverWarmConfirmationSteps(
  map: AppMap,
  originScreenId: string,
): MappedPreludeGesture[] {
  return leftoverConversationHomePrelude(map, originScreenId)?.preludeSteps ?? [];
}

function isLeftoverWarmReturnTap(step: RecipeStep | undefined): boolean {
  return step?.kind === "tap" && step.target.identifier === "new-chat";
}

/** New Chat return taps may precede wait-for on warm confirmation. The leaf
 * stays independently source-proven — leftover conversation is a safe origin. */
export function sourceProofAfterLeftoverWarm(
  steps: readonly RecipeStep[] | undefined,
): RecipeStep | undefined {
  if (!steps?.length) return undefined;
  let index = 0;
  while (index < steps.length && isLeftoverWarmReturnTap(steps[index])) index += 1;
  return steps[index];
}
