import type { AppMap, AppMapScenarioTest, Screen } from "@relay/protocol";
import type { DeviceInfo, PersistedRun } from "./api-types";
import type { DeviceReadiness } from "./device-readiness";
import { createScenarioTest } from "./app-map-test-editor-model";
import { presentTarget } from "./target-presentation";

/**
 * The guide remembers only a person's presentation choice. Its progress is
 * deliberately derived from targets, maps, and immutable reports every time
 * Relay opens, so reconnecting a stale device can never restore a fake green
 * checkmark.
 */
export const FIRST_TEST_ONBOARDING_STORAGE_KEY = "onboarding:first-test:v1";

export type FirstTestAuthoringPreference = "screen-check" | "blank" | "record" | "yaml";

export type FirstTestOnboardingPreference = {
  version: 1;
  dismissedAt?: number;
  completedAt?: number;
  authoringPreference?: FirstTestAuthoringPreference;
};

export const EMPTY_FIRST_TEST_ONBOARDING_PREFERENCE: FirstTestOnboardingPreference = {
  version: 1,
};

const AUTHORING_PREFERENCES = new Set<FirstTestAuthoringPreference>([
  "screen-check",
  "blank",
  "record",
  "yaml",
]);

function timestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Ignore malformed or retired preferences rather than making local storage a
 * source of onboarding state. */
export function parseFirstTestOnboardingPreference(
  value: string | null | undefined,
): FirstTestOnboardingPreference {
  if (!value) return { ...EMPTY_FIRST_TEST_ONBOARDING_PREFERENCE };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_FIRST_TEST_ONBOARDING_PREFERENCE };
    const candidate = parsed as Record<string, unknown>;
    if (candidate.version !== 1) return { ...EMPTY_FIRST_TEST_ONBOARDING_PREFERENCE };
    const preference: FirstTestOnboardingPreference = { version: 1 };
    const dismissedAt = timestamp(candidate.dismissedAt);
    const completedAt = timestamp(candidate.completedAt);
    if (dismissedAt) preference.dismissedAt = dismissedAt;
    if (completedAt) preference.completedAt = completedAt;
    if (
      typeof candidate.authoringPreference === "string" &&
      AUTHORING_PREFERENCES.has(candidate.authoringPreference as FirstTestAuthoringPreference)
    ) {
      preference.authoringPreference =
        candidate.authoringPreference as FirstTestAuthoringPreference;
    }
    return preference;
  } catch {
    return { ...EMPTY_FIRST_TEST_ONBOARDING_PREFERENCE };
  }
}

export function serializeFirstTestOnboardingPreference(
  preference: FirstTestOnboardingPreference,
): string {
  return JSON.stringify({
    version: 1,
    ...(timestamp(preference.dismissedAt) ? { dismissedAt: preference.dismissedAt } : {}),
    ...(timestamp(preference.completedAt) ? { completedAt: preference.completedAt } : {}),
    ...(preference.authoringPreference
      ? { authoringPreference: preference.authoringPreference }
      : {}),
  });
}

export type FirstTestTargetStatus =
  | {
      kind: "offline";
      title: string;
      detail: string;
      actionLabel: string;
    }
  | {
      kind: "choose-target";
      title: string;
      detail: string;
      actionLabel: string;
    }
  | {
      kind: "needs-attention";
      title: string;
      detail: string;
      actionLabel: string;
    }
  | {
      kind: "needs-control";
      title: string;
      detail: string;
      actionLabel: string;
    }
  | {
      kind: "ready";
      title: string;
      detail: string;
    };

/** A target is only ready when the current server view says it is controllable.
 * A cached selection or a remembered serial is intentionally not enough. */
export function firstTestTargetStatus(input: {
  online: boolean;
  target: DeviceInfo | null | undefined;
  readiness: DeviceReadiness;
  hasControl: boolean;
  controlIssue?: string | null;
}): FirstTestTargetStatus {
  if (!input.online) {
    return {
      kind: "offline",
      title: "Relay is offline",
      detail: "Reconnect Relay before choosing a target or starting a test.",
      actionLabel: "Reconnect Relay",
    };
  }
  if (!input.target || input.readiness.kind === "choose-device") {
    return {
      kind: "choose-target",
      title: "Choose a target",
      detail: "Select a connected device or browser target to check before authoring.",
      actionLabel: "Choose target",
    };
  }
  if (input.readiness.kind !== "ready") {
    return {
      kind: "needs-attention",
      title: input.readiness.title,
      detail: input.readiness.detail,
      actionLabel: input.readiness.kind === "screen-preparing" ? "Open device" : "Check target",
    };
  }
  const targetName = presentTarget(input.target).displayName;
  if (input.controlIssue) {
    return {
      kind: "needs-control",
      title: `Open ${targetName}`,
      detail: input.controlIssue,
      actionLabel: "Open device",
    };
  }
  if (!input.hasControl) {
    return {
      kind: "needs-control",
      title: `Waiting for control of ${targetName}`,
      detail: "Relay needs an active control session before it can record or run this test.",
      actionLabel: "Open device",
    };
  }
  return {
    kind: "ready",
    title: `${targetName} is ready`,
    detail: "Relay can now record or run an explicitly chosen test on this target.",
  };
}

export type FirstTestStage = "target" | "capture" | "author" | "run" | "complete";

export type FirstTestRunSummary = {
  id: string;
  status: string;
  queuedAt?: number;
  startedAt?: number;
  finishedAt?: number;
  writtenAt?: number;
};

export type FirstTestChecklistState = {
  stage: FirstTestStage;
  target: FirstTestTargetStatus;
  targetReady: boolean;
  screenSaved: boolean;
  testCreated: boolean;
  testReady: boolean;
  latestRun?: FirstTestRunSummary;
  completedRun?: FirstTestRunSummary;
};

function runTime(run: FirstTestRunSummary): number {
  return run.finishedAt ?? run.writtenAt ?? run.startedAt ?? run.queuedAt ?? 0;
}

function succeeded(run: FirstTestRunSummary): boolean {
  return run.status === "ok" || run.status === "healed";
}

/**
 * The guide's order is intentionally strict. A valid authoring draft is not a
 * run, and a previously selected target is not proof that its control session
 * still exists.
 */
export function deriveFirstTestState(input: {
  target: FirstTestTargetStatus;
  screenSaved: boolean;
  testCreated: boolean;
  testReady: boolean;
  runs?: readonly FirstTestRunSummary[];
}): FirstTestChecklistState {
  const runs = [...(input.runs ?? [])].toSorted((left, right) => runTime(right) - runTime(left));
  const latestRun = runs[0];
  const completedRun = runs.find(succeeded);
  const targetReady = input.target.kind === "ready";
  const stage: FirstTestStage = completedRun
    ? "complete"
    : !targetReady
      ? "target"
      : !input.screenSaved
        ? "capture"
        : !input.testCreated || !input.testReady
          ? "author"
          : "run";
  return {
    stage,
    target: input.target,
    targetReady,
    screenSaved: input.screenSaved,
    testCreated: input.testCreated,
    testReady: input.testReady,
    ...(latestRun ? { latestRun } : {}),
    ...(completedRun ? { completedRun } : {}),
  };
}

/** A safe starter asserts only an already saved screen with a stable identity. It never taps a
 * product control, grants a permission, or queues a run. */
export function createFirstTestStarter(input: {
  map: AppMap;
  kind: "screen-check" | "blank";
  screen?: Screen;
  testId?: string;
  stepId?: string;
  at?: number;
}): AppMapScenarioTest {
  const at = input.at ?? Date.now();
  const testId = input.testId ?? crypto.randomUUID();
  const testNumber = Object.keys(input.map.tests).length + 1;
  if (input.kind === "blank") {
    return createScenarioTest(input.map, `Test ${testNumber}`, testId, at);
  }

  const screen = input.screen;
  if (!screen?.identity) {
    throw new Error("Save a screen with a stable identity before creating this check.");
  }
  const screenName = screen.title.trim() || "saved screen";
  return {
    ...createScenarioTest(input.map, `Check ${screenName}`, testId, at),
    steps: [
      {
        id: input.stepId ?? crypto.randomUUID(),
        kind: "validation",
        intent: `Verify ${screenName} is visible`,
        binding: {
          status: "resolved",
          kind: "assertion",
          assertion: { kind: "screen", screenId: screen.id },
        },
      },
    ],
  };
}

function artifactMatchesTest(
  artifact: NonNullable<PersistedRun["artifacts"]>[number],
  appMapId: string,
  testId: string,
): boolean {
  if (
    artifact.kind !== "app-map-test-plan" ||
    !artifact.data ||
    typeof artifact.data !== "object"
  ) {
    return false;
  }
  const plan = artifact.data as Record<string, unknown>;
  if (plan.appMapId !== appMapId) return false;
  const test = plan.test;
  return Boolean(
    test && typeof test === "object" && (test as Record<string, unknown>).id === testId,
  );
}

/** Only immutable reports with the exact frozen Test plan can complete the
 * guide. Matching by map name, recipe title, or an in-memory job would attach
 * unrelated work and make the progress lie. */
export function persistedRunsForFirstTest(
  runs: readonly PersistedRun[],
  appMapId: string | undefined,
  testId: string | undefined,
): PersistedRun[] {
  if (!appMapId || !testId) return [];
  return runs
    .filter((run) =>
      (run.artifacts ?? []).some((artifact) => artifactMatchesTest(artifact, appMapId, testId)),
    )
    .toSorted((left, right) => runTime(right) - runTime(left));
}

/** Dismissal is a presentation preference, never an inferred completion. A
 * real persisted success always remains the source for the complete stage. */
export function shouldShowFirstTestChecklist(
  preference: FirstTestOnboardingPreference,
  state: FirstTestChecklistState,
): boolean {
  // Existing maps can already have years of report history. A completed handoff
  // is useful only when this guide helped author the Test, so old successful
  // maps do not unexpectedly reopen a first-use card.
  if (state.stage === "complete") {
    return Boolean(preference.authoringPreference) && !preference.completedAt;
  }
  return !preference.dismissedAt;
}
