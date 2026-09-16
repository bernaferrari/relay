import * as z from "zod/v4";

/**
 * Starting-state facts and leftover effects for the existing Routine / Test
 * model. This is not a sixth framework: Routines stay Routines, Tests stay
 * Tests. Effects only name what a following Test may not assume.
 */

export const ROUTINE_STARTING_STATE_FACTS = [
  "known-account",
  "home-visible",
  "menu-closed",
  "composer-empty",
  "owned-conversation-available",
  "language-theme-established",
] as const;
export type RoutineStartingStateFact = (typeof ROUTINE_STARTING_STATE_FACTS)[number];

export const ROUTINE_LEFTOVER_SURFACES = [
  "settings",
  "sidebar",
  "private-chat",
  "signed-out",
  "prefs-mutated",
  "conversation-deleted",
  "interrupted",
] as const;
export type RoutineLeftoverSurface = (typeof ROUTINE_LEFTOVER_SURFACES)[number];

export const ROUTINE_SHARING_POLICIES = [
  "safe-shared-read",
  "fail-closed",
  "isolated-lane",
  "isolated-account",
] as const;
export type RoutineSharingPolicy = (typeof ROUTINE_SHARING_POLICIES)[number];

export const ROUTINE_ACCOUNT_ISOLATION = ["browser-lane-only", "server-account"] as const;
export type RoutineAccountIsolation = (typeof ROUTINE_ACCOUNT_ISOLATION)[number];

/** Playwright / Chrome user-data isolation is not a second Grok account. */
export const BROWSER_LANE_ISOLATION_NOTE =
  "Browser Lane isolation is Playwright/browser storage isolation. It is not server-side account isolation. Same-account concurrent mutation is unsafe even across Lanes.";

const STARTING_STATE_FACT_SET = new Set<string>(ROUTINE_STARTING_STATE_FACTS);
const LEFTOVER_SURFACE_SET = new Set<string>(ROUTINE_LEFTOVER_SURFACES);
const SHARING_POLICY_SET = new Set<string>(ROUTINE_SHARING_POLICIES);
const ACCOUNT_ISOLATION_SET = new Set<string>(ROUTINE_ACCOUNT_ISOLATION);

const MUTATING_LEFTOVER = new Set<RoutineLeftoverSurface>([
  "signed-out",
  "prefs-mutated",
  "conversation-deleted",
  "interrupted",
]);

export type RoutineEffects = {
  /** Facts this Routine establishes after a successful complete run. */
  establishes?: readonly RoutineStartingStateFact[];
  /** Facts required before this Routine may run. Unspecified leftover does not
   * prove them; a declared leftover that contradicts them fails closed. */
  requires?: readonly RoutineStartingStateFact[];
  /**
   * Surfaces left behind when this Routine completes without a matching
   * cleanup. A following Test cannot claim Home / known-account / owned
   * conversation / language-theme while these remain.
   */
  leftover?: readonly RoutineLeftoverSurface[];
  /**
   * Sharing policy for mutating work. Default for mutating leftover is
   * fail-closed. Isolated-lane is not enough when accountIsolation is
   * browser-lane-only.
   */
  sharing?: RoutineSharingPolicy;
  /**
   * browser-lane-only: Lanes isolate browser storage, not the server account.
   * server-account: isolation is a distinct account fixture/value.
   */
  accountIsolation?: RoutineAccountIsolation;
  /** Human-readable isolation note. Mutating presets stamp BROWSER_LANE_ISOLATION_NOTE. */
  accountIsolationNote?: string;
};

export type AppMapTestStartingState = {
  requires?: readonly RoutineStartingStateFact[];
  /** Declared source screen for coverage:transition openers. */
  sourceScreenId?: string;
  leftover?: readonly RoutineLeftoverSurface[];
  sharing?: RoutineSharingPolicy;
  accountIsolation?: RoutineAccountIsolation;
  accountIsolationNote?: string;
};

export type StartingStateShareContext = {
  testId: string;
  accountId?: string;
  laneId?: string;
};

const FACT_BLOCKERS: Record<RoutineStartingStateFact, readonly RoutineLeftoverSurface[]> = {
  "known-account": ["signed-out"],
  "home-visible": ["settings", "sidebar", "private-chat", "signed-out", "interrupted"],
  "menu-closed": ["settings", "sidebar", "private-chat"],
  "composer-empty": ["private-chat"],
  "owned-conversation-available": ["conversation-deleted", "signed-out"],
  "language-theme-established": ["prefs-mutated"],
};

export function isRoutineStartingStateFact(value: string): value is RoutineStartingStateFact {
  return STARTING_STATE_FACT_SET.has(value);
}

export function isRoutineLeftoverSurface(value: string): value is RoutineLeftoverSurface {
  return LEFTOVER_SURFACE_SET.has(value);
}

export function isRoutineSharingPolicy(value: string): value is RoutineSharingPolicy {
  return SHARING_POLICY_SET.has(value);
}

export function isRoutineAccountIsolation(value: string): value is RoutineAccountIsolation {
  return ACCOUNT_ISOLATION_SET.has(value);
}

export function leftoverContradictsFact(
  leftover: readonly RoutineLeftoverSurface[],
  fact: RoutineStartingStateFact,
): boolean {
  const blockers = FACT_BLOCKERS[fact];
  return leftover.some((surface) => blockers.includes(surface));
}

export function leftoverContradictedFacts(
  leftover: readonly RoutineLeftoverSurface[],
): RoutineStartingStateFact[] {
  return ROUTINE_STARTING_STATE_FACTS.filter((fact) => leftoverContradictsFact(leftover, fact));
}

export function hasMutatingLeftover(effects: RoutineEffects | AppMapTestStartingState): boolean {
  return (effects.leftover ?? []).some((surface) => MUTATING_LEFTOVER.has(surface));
}

export function effectiveSharingPolicy(
  effects: RoutineEffects | AppMapTestStartingState,
): RoutineSharingPolicy {
  if (effects.sharing) return effects.sharing;
  return hasMutatingLeftover(effects) ? "fail-closed" : "safe-shared-read";
}

/**
 * Concurrent/overlapping placement of mutating work. Sequential leftover is a
 * separate check: leftover Settings still blocks a following Test that claims
 * Home even when sharing is safe-shared-read.
 */
export function mutatingWorkMayShare(
  effects: RoutineEffects | AppMapTestStartingState,
  left: StartingStateShareContext,
  right: StartingStateShareContext,
): boolean {
  if (left.testId === right.testId && left.accountId === right.accountId && left.laneId === right.laneId) {
    return true;
  }
  const sharing = effectiveSharingPolicy(effects);
  if (sharing === "safe-shared-read") return true;
  if (sharing === "fail-closed") return false;
  const sameAccount =
    Boolean(left.accountId) && Boolean(right.accountId) && left.accountId === right.accountId;
  const distinctAccounts =
    Boolean(left.accountId) && Boolean(right.accountId) && left.accountId !== right.accountId;
  const distinctLanes = Boolean(left.laneId) && Boolean(right.laneId) && left.laneId !== right.laneId;
  const isolation = effects.accountIsolation ?? "browser-lane-only";
  if (isolation === "browser-lane-only" && sameAccount) return false;
  if (sharing === "isolated-account") return distinctAccounts;
  if (sharing === "isolated-lane") {
    if (isolation === "server-account") return distinctAccounts || distinctLanes;
    return distinctLanes && !sameAccount;
  }
  return false;
}

export const STARTING_STATE_ROUTINE_PRESETS = {
  "known-account": {
    establishes: ["known-account"],
  },
  "home-chrome": {
    requires: ["known-account"],
    establishes: ["home-visible", "menu-closed", "composer-empty"],
  },
  "owned-conversation": {
    requires: ["known-account", "home-visible"],
    establishes: ["owned-conversation-available"],
  },
  "language-theme": {
    requires: ["known-account"],
    establishes: ["language-theme-established"],
  },
} as const satisfies Record<string, RoutineEffects>;

export const MUTATING_ROUTINE_PRESETS = {
  "inspect-settings": {
    requires: ["known-account", "home-visible", "menu-closed"],
    leftover: ["settings"],
    sharing: "safe-shared-read",
  },
  "sign-out": {
    requires: ["known-account"],
    leftover: ["signed-out"],
    sharing: "fail-closed",
    accountIsolation: "browser-lane-only",
    accountIsolationNote: BROWSER_LANE_ISOLATION_NOTE,
  },
  "delete-conversation": {
    requires: ["known-account", "owned-conversation-available"],
    leftover: ["conversation-deleted"],
    sharing: "fail-closed",
    accountIsolation: "browser-lane-only",
    accountIsolationNote: BROWSER_LANE_ISOLATION_NOTE,
  },
  "change-prefs": {
    requires: ["known-account", "language-theme-established"],
    leftover: ["prefs-mutated"],
    sharing: "fail-closed",
    accountIsolation: "browser-lane-only",
    accountIsolationNote: BROWSER_LANE_ISOLATION_NOTE,
  },
  interrupt: {
    requires: ["known-account", "home-visible"],
    leftover: ["interrupted"],
    sharing: "fail-closed",
    accountIsolation: "browser-lane-only",
    accountIsolationNote: BROWSER_LANE_ISOLATION_NOTE,
  },
} as const satisfies Record<string, RoutineEffects>;

const uniqueEnum = <T extends string>(values: readonly T[], label: string) =>
  z
    .array(z.enum(values as unknown as [T, ...T[]]))
    .max(16)
    .superRefine((items, context) => {
      if (new Set(items).size === items.length) return;
      context.addIssue({ code: "custom", message: `${label} must not repeat a value` });
    });

export const routineEffectsSchema = z
  .object({
    establishes: uniqueEnum(ROUTINE_STARTING_STATE_FACTS, "establishes").optional(),
    requires: uniqueEnum(ROUTINE_STARTING_STATE_FACTS, "requires").optional(),
    leftover: uniqueEnum(ROUTINE_LEFTOVER_SURFACES, "leftover").optional(),
    sharing: z.enum(ROUTINE_SHARING_POLICIES).optional(),
    accountIsolation: z.enum(ROUTINE_ACCOUNT_ISOLATION).optional(),
    accountIsolationNote: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const appMapTestStartingStateSchema = z
  .object({
    requires: uniqueEnum(ROUTINE_STARTING_STATE_FACTS, "requires").optional(),
    sourceScreenId: z.string().trim().min(1).max(128).optional(),
    leftover: uniqueEnum(ROUTINE_LEFTOVER_SURFACES, "leftover").optional(),
    sharing: z.enum(ROUTINE_SHARING_POLICIES).optional(),
    accountIsolation: z.enum(ROUTINE_ACCOUNT_ISOLATION).optional(),
    accountIsolationNote: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
