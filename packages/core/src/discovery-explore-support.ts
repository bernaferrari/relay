/** Pure and persistence-facing helpers for the server-owned Explore crawl. */
import type {
  DiscoveryControl,
  DiscoveryExploreCursor,
  DiscoveryExploreFixtureState,
  NavigationProofCursorArtifact,
  StateFixture,
} from "@relay/protocol";
import type { DiscoveryHere, DiscoveryHereOption } from "./discovery-turn.js";
import { GroundingError } from "./grounding.js";
import type { InteractInput } from "./workspace.js";
import type { groundTarget } from "./grounding.js";

export const MAX_SAME_SCREEN_ACTIONS = 40;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type PlannedVisit = {
  screenId: string;
  pendingIds: string[];
};

export function cursorState(input: {
  stack: PlannedVisit[];
  explored: ReadonlySet<string>;
  sameScreenActions: ReadonlyMap<string, number>;
  inFlight?: { screenId: string; controlId: string };
}): DiscoveryExploreCursor {
  return {
    schemaVersion: 1,
    stack: input.stack.map((frame) => ({
      screenId: frame.screenId,
      pendingControlIds: [...frame.pendingIds],
    })),
    exploredEdgeKeys: [...input.explored].sort(),
    sameScreenActions: Object.fromEntries(
      [...input.sameScreenActions.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    ...(input.inFlight ? { inFlight: input.inFlight } : {}),
  };
}

export function provenCursor(
  here: DiscoveryHere,
  source: "screen-observation" | "transition",
): NavigationProofCursorArtifact {
  return {
    schemaVersion: 1,
    status: "proven",
    screenId: here.screen.id,
    proofToken: `discovery:${here.screen.fingerprint}`,
    source,
    updatedAt: Date.now(),
  };
}

export function unknownCursor(
  prior: NavigationProofCursorArtifact | undefined,
  reason: string,
): NavigationProofCursorArtifact {
  return {
    schemaVersion: 1,
    status: "unknown",
    reason,
    updatedAt: Date.now(),
    ...(prior?.status === "proven"
      ? { previous: { screenId: prior.screenId, proofToken: prior.proofToken } }
      : prior?.previous
        ? { previous: prior.previous }
        : {}),
  };
}

export function externalHandoffCursor(
  prior: NavigationProofCursorArtifact | undefined,
  foregroundApp: string,
  reason: string,
): NavigationProofCursorArtifact {
  return {
    schemaVersion: 1,
    status: "external-handoff",
    foregroundApp,
    reason,
    updatedAt: Date.now(),
    ...(prior?.status === "proven"
      ? { previous: { screenId: prior.screenId, proofToken: prior.proofToken } }
      : prior?.previous
        ? { previous: prior.previous }
        : {}),
  };
}

export function needsExploreGrounding(option: Pick<DiscoveryControl, "label" | "target">): boolean {
  const label = option.label.trim();
  if (
    new Set(["menu", "private", "more", "options", "overflow", "drawer", "hamburger"]).has(
      label.toLowerCase(),
    )
  ) {
    return true;
  }
  return Boolean(
    label &&
    !option.target.identifier &&
    !option.target.label &&
    !option.target.text &&
    option.target.point,
  );
}

/** Convert an observed option into the strict action vocabulary owned by policy. */
export function policyActionForOption(option: DiscoveryHereOption) {
  const label = option.label.trim();
  const role = option.role ?? "";
  const kind = /(delete|erase|remove|sign out|logout|purchase|subscribe|buy)/i.test(label)
    ? ("data-deletion" as const)
    : /switch|toggle|checkbox|radio|slider|seekbar|stepper/i.test(`${label} ${role}`)
      ? ("state-change" as const)
      : /(open in (?:browser|chrome|safari)|system settings|external)/i.test(label)
        ? ("external-app" as const)
        : ("navigate" as const);
  const requiredScopes =
    kind === "state-change"
      ? [
          /language|locale/i.test(label)
            ? ("locale" as const)
            : /theme|dark mode|light mode/i.test(label)
              ? ("theme" as const)
              : /permission/i.test(label)
                ? ("permission" as const)
                : /network|wi-?fi/i.test(label)
                  ? ("network" as const)
                  : /account/i.test(label)
                    ? ("account" as const)
                    : ("app" as const),
        ]
      : [];
  return { id: option.id, kind, requiredScopes, declaredExternalEffects: [] };
}

export async function resolveExploreInteraction(input: {
  serial: string;
  option: DiscoveryHereOption;
  ground: typeof groundTarget;
}): Promise<{ interaction: InteractInput; grounded: boolean }> {
  if (!needsExploreGrounding(input.option)) {
    const target = input.option.target;
    if (target.identifier)
      return {
        interaction: { kind: "identifier", identifier: target.identifier },
        grounded: false,
      };
    if (target.label)
      return { interaction: { kind: "label", label: target.label }, grounded: false };
    if (target.text)
      return { interaction: { kind: "text-match", match: target.text }, grounded: false };
    if (target.point)
      return {
        interaction: { kind: "point", x: target.point.x, y: target.point.y },
        grounded: false,
      };
    return { interaction: { kind: "label", label: input.option.label }, grounded: false };
  }
  try {
    const grounded = await input.ground({ serial: input.serial, target: input.option.label });
    return { interaction: grounded.interaction, grounded: true };
  } catch (error) {
    if (error instanceof GroundingError) throw error;
    throw error;
  }
}

export type ExploreFixtureAdapter = {
  prepare: (fixture: StateFixture) => Promise<void>;
  verify: (fixture: StateFixture) => Promise<void>;
  cleanup: (fixture: StateFixture) => Promise<void>;
};

export async function cleanupExploreFixture(input: {
  state: DiscoveryExploreFixtureState | undefined;
  adapter: ExploreFixtureAdapter | undefined;
  persist: (state: DiscoveryExploreFixtureState) => Promise<void>;
}): Promise<Error | undefined> {
  const { state, adapter, persist } = input;
  if (!state || state.phase === "cleaned") return undefined;
  if (!adapter) return new Error(`Explore fixture ${state.definition.id} cannot be cleaned up`);
  await persist({ ...state, phase: "cleanup-pending" });
  try {
    await adapter.cleanup(state.definition);
    await persist({ ...state, phase: "cleaned" });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export async function prepareExploreFixture(input: {
  fixture: StateFixture;
  prior: DiscoveryExploreFixtureState | undefined;
  adapter: ExploreFixtureAdapter | undefined;
  persist: (state: DiscoveryExploreFixtureState) => Promise<void>;
}): Promise<void> {
  const { fixture, prior, adapter, persist } = input;
  if (!adapter) {
    throw new Error(
      `Explore fixture ${fixture.id} needs a target fixture adapter; no state mutation was dispatched`,
    );
  }
  if (prior && prior.phase !== "cleaned") {
    const cleanupError = await cleanupExploreFixture({ state: prior, adapter, persist });
    if (cleanupError) throw cleanupError;
  }
  await persist({ definition: fixture, phase: "preparing" });
  await adapter.prepare(fixture);
  await persist({ definition: fixture, phase: "prepared" });
  await adapter.verify(fixture);
  await persist({ definition: fixture, phase: "verified" });
}
