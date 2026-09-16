import { createHash } from "node:crypto";
import type {
  AppMap,
  AppMapCombine,
  AppMapScenarioTest,
  AppMapVariable,
  Connection,
  LaneSaveInput,
  Screen,
  ScreenVariant,
  TargetProfile,
} from "@relay/protocol";
import { compileBrowserEnvironment } from "@relay/protocol";
import { BROWSER_TARGET_CAPABILITIES } from "./targets.js";
import { SEEDED_MEMBER_EXPECTED_SEATS } from "./seeded-member-app.js";

export const SEEDED_MEMBER_APP_MAP_ID = "seeded-member";
export const SEEDED_MEMBER_TEST_ID = "test-member-settings-seats";
export const SEEDED_MEMBER_COMBINE_ID = "seeded-member-acceptance";
export const SEEDED_MEMBER_TARGET_ID = "seeded-member-app";
export const SEEDED_MEMBER_LANE_ID = "seeded-member";
export const SEEDED_ADMIN_LANE_ID = "seeded-admin";
export const SEEDED_MEMBER_ACCOUNT_VARIABLE_ID = "account";
export const SEEDED_MEMBER_HOME_SCREEN_ID = "home";
export const SEEDED_MEMBER_OPEN_SETTINGS_CONNECTION_ID = "open-settings";
export const SEEDED_MEMBER_ACCIDENTAL_CONNECTION_ID = "open-organization";
export const SEEDED_MEMBER_OPEN_SETTINGS_STEP_ID = "open-settings";
export const SEEDED_MEMBER_ACCIDENTAL_STEP_ID = "open-organization";
export const SEEDED_MEMBER_EXTRACT_STEP_ID = "read-seats";
export const SEEDED_MEMBER_CHECK_STEP_ID = "check-seats";
export const SEEDED_MEMBER_SEATS_VARIABLE = "team_seats";
export const SEEDED_MEMBER_VIEWPORT = { width: 900, height: 600 } as const;
export const SEEDED_MEMBER_COMPACT_VIEWPORT = { width: 390, height: 844 } as const;
export const SEEDED_MEMBER_CAPTURE_LOOK_FOR =
  "Arabic text is readable, seats are not truncated, and Save is visible.";
/** Shared with the unsigned saved target. Unique Member/Admin profiles overlay
 * a fixture only; they must not invent a different environmentRevision. */
export const SEEDED_MEMBER_BROWSER_ENVIRONMENT = {
  engine: "chromium" as const,
  viewport: { ...SEEDED_MEMBER_VIEWPORT },
  locale: "en-US",
  timezoneId: "UTC",
};
export const SEEDED_MEMBER_HOME_FINGERPRINT = createHash("sha256")
  .update("seeded-member-home")
  .digest("hex");

export type SeededMemberScope = {
  organizationId: string;
  projectId: string;
  appMapId: string;
};

const defaultScope: SeededMemberScope = {
  organizationId: "local",
  projectId: "default",
  appMapId: SEEDED_MEMBER_APP_MAP_ID,
};

export function seededMemberProfileId(role: "admin" | "member"): string {
  return `browser:${SEEDED_MEMBER_TARGET_ID}-900x600-${role}`;
}

export function seededMemberTargetProfile(input: {
  role: "admin" | "member";
  fixtureReference: string;
  observedAt?: number;
}): TargetProfile {
  const browserCaseProfile = compileBrowserEnvironment({
    ...SEEDED_MEMBER_BROWSER_ENVIRONMENT,
    authenticationFixtureId: input.fixtureReference,
  });
  return {
    id: seededMemberProfileId(input.role),
    targetId: SEEDED_MEMBER_TARGET_ID,
    source: "browser",
    platform: "browser",
    name: `Seeded ${input.role}`,
    viewport: { ...SEEDED_MEMBER_VIEWPORT },
    browserCaseProfile,
    capabilities: [...BROWSER_TARGET_CAPABILITIES],
    observedAt: input.observedAt ?? 1,
  };
}

export function seededMemberHomeScreen(
  scope: SeededMemberScope = defaultScope,
  at = 1,
  variantIds: string[] = [],
): Screen {
  return {
    ...scope,
    id: SEEDED_MEMBER_HOME_SCREEN_ID,
    title: "Workspace home",
    identity: { schemaVersion: 1, fingerprint: SEEDED_MEMBER_HOME_FINGERPRINT },
    variantIds,
    createdAt: at,
    updatedAt: at,
  };
}

export function seededMemberHomeVariant(input: {
  role: "admin" | "member";
  fixtureReference: string;
  scope?: SeededMemberScope;
  at?: number;
}): ScreenVariant {
  const scope = input.scope ?? defaultScope;
  const at = input.at ?? 1;
  const id = `home-${input.role}`;
  return {
    ...scope,
    id,
    screenId: SEEDED_MEMBER_HOME_SCREEN_ID,
    targetProfile: seededMemberTargetProfile({
      role: input.role,
      fixtureReference: input.fixtureReference,
      observedAt: at,
    }),
    observation: {
      fingerprint: SEEDED_MEMBER_HOME_FINGERPRINT,
      nodes: [
        { role: "heading", label: "Workspace home", visibleToUser: true },
        {
          role: "text",
          identifier: "session-role",
          label: input.role,
          visibleToUser: true,
        },
        {
          role: "link",
          identifier: "open-settings",
          label: "Settings",
          visibleToUser: true,
          hittable: true,
        },
      ],
      volatileSignals: [],
    },
    evidenceIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

export function seededMemberOpenSettingsConnection(
  scope: SeededMemberScope = defaultScope,
  at = 1,
): Connection {
  return {
    ...scope,
    id: SEEDED_MEMBER_OPEN_SETTINGS_CONNECTION_ID,
    fromScreenId: SEEDED_MEMBER_HOME_SCREEN_ID,
    destination: { kind: "end" },
    label: "Open workspace settings",
    state: "ready",
    actions: [
      {
        id: "open-settings-path",
        kind: "steps",
        steps: [
          { kind: "wait-for", target: { label: "Settings" }, timeoutMs: 10_000 },
          { kind: "tap", target: { identifier: "open-settings" } },
          { kind: "wait-for", target: { label: "Workspace settings" }, timeoutMs: 10_000 },
          { kind: "wait-for", target: { identifier: "team-seats" }, timeoutMs: 10_000 },
          {
            kind: "extract",
            as: SEEDED_MEMBER_SEATS_VARIABLE,
            target: { identifier: "team-seats" },
          },
          {
            kind: "assert-content",
            input: SEEDED_MEMBER_SEATS_VARIABLE,
            expected: String(SEEDED_MEMBER_EXPECTED_SEATS),
            match: "number-equals",
          },
        ],
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
}

export function seededMemberAccidentalConnection(
  scope: SeededMemberScope = defaultScope,
  at = 1,
): Connection {
  return {
    ...scope,
    id: SEEDED_MEMBER_ACCIDENTAL_CONNECTION_ID,
    fromScreenId: SEEDED_MEMBER_HOME_SCREEN_ID,
    destination: { kind: "end" },
    label: "Open organization",
    state: "ready",
    actions: [
      {
        id: "open-org-path",
        kind: "steps",
        steps: [
          { kind: "wait-for", target: { label: "Manage organization" }, timeoutMs: 5_000 },
          { kind: "tap", target: { identifier: "manage-org" } },
        ],
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
}

export function seededMemberSettingsTest(input?: {
  includeAccidental?: boolean;
  scope?: SeededMemberScope;
  at?: number;
}): AppMapScenarioTest {
  const scope = input?.scope ?? defaultScope;
  const at = input?.at ?? 1;
  const accidental = input?.includeAccidental
    ? [
        {
          id: SEEDED_MEMBER_ACCIDENTAL_STEP_ID,
          kind: "instruction" as const,
          intent: "Open organization (accidental)",
          binding: {
            status: "resolved" as const,
            kind: "connections" as const,
            connectionIds: [SEEDED_MEMBER_ACCIDENTAL_CONNECTION_ID],
          },
        },
      ]
    : [];
  return {
    ...scope,
    id: SEEDED_MEMBER_TEST_ID,
    name: "Member settings team seats",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: SEEDED_MEMBER_OPEN_SETTINGS_STEP_ID,
        kind: "instruction",
        intent: "Open workspace settings as Member",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: [SEEDED_MEMBER_OPEN_SETTINGS_CONNECTION_ID],
        },
      },
      ...accidental,
      {
        id: SEEDED_MEMBER_EXTRACT_STEP_ID,
        kind: "extraction",
        intent: "Read team seats remaining",
        capture: true,
        binding: {
          status: "resolved",
          kind: "extract",
          as: SEEDED_MEMBER_SEATS_VARIABLE,
          target: { identifier: "team-seats" },
        },
      },
      {
        id: SEEDED_MEMBER_CHECK_STEP_ID,
        kind: "validation",
        intent: "Team seats remaining is 4",
        binding: {
          status: "resolved",
          kind: "assertion",
          assertion: {
            kind: "content",
            input: SEEDED_MEMBER_SEATS_VARIABLE,
            expected: String(SEEDED_MEMBER_EXPECTED_SEATS),
            match: "number-equals",
          },
        },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
}

export const SEEDED_MEMBER_CAPTURE_TEST_ID = "test-member-settings-capture";
export const SEEDED_MEMBER_CAPTURE_STEP_ID = "capture-settings";

export function seededMemberCaptureReviewTest(input?: {
  scope?: SeededMemberScope;
  at?: number;
}): AppMapScenarioTest {
  const scope = input?.scope ?? defaultScope;
  const at = input?.at ?? 1;
  return {
    ...scope,
    id: SEEDED_MEMBER_CAPTURE_TEST_ID,
    name: "Member settings capture for review",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: SEEDED_MEMBER_OPEN_SETTINGS_STEP_ID,
        kind: "instruction",
        intent: "Open workspace settings as Member",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: [SEEDED_MEMBER_OPEN_SETTINGS_CONNECTION_ID],
        },
      },
      {
        id: SEEDED_MEMBER_CAPTURE_STEP_ID,
        kind: "validation",
        intent: "Capture settings for a person to review later",
        binding: {
          status: "resolved",
          kind: "recipe-step",
          step: {
            kind: "screenshot",
            caption: "Member account settings",
            review: {
              mode: "later",
              lookFor: SEEDED_MEMBER_CAPTURE_LOOK_FOR,
            },
          },
        },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
}

export type SeededMemberCaptureConfiguration = {
  role: "member" | "admin";
  viewport: { id: "desktop" | "compact"; label: string; width: number; height: number };
  locale: { id: "en" | "ar"; label: string; tag: string };
  caption: string;
  lookFor: string;
};

export function seededMemberCaptureConfigurations(): SeededMemberCaptureConfiguration[] {
  const roles = [
    { id: "member" as const, label: "Member" },
    { id: "admin" as const, label: "Admin" },
  ];
  const viewports = [
    { id: "desktop" as const, label: "Desktop", ...SEEDED_MEMBER_VIEWPORT },
    { id: "compact" as const, label: "Compact", ...SEEDED_MEMBER_COMPACT_VIEWPORT },
  ];
  const locales = [
    { id: "en" as const, label: "English", tag: "en-US" },
    { id: "ar" as const, label: "Arabic", tag: "ar" },
  ];
  return roles.flatMap((role) =>
    viewports.flatMap((viewport) =>
      locales.map((locale) => ({
        role: role.id,
        viewport,
        locale,
        caption: `${role.label} · ${viewport.label} · ${locale.label}`,
        lookFor: SEEDED_MEMBER_CAPTURE_LOOK_FOR,
      })),
    ),
  );
}

export function seededMemberAccountVariable(
  scope: SeededMemberScope = defaultScope,
  at = 1,
): AppMapVariable {
  return {
    ...scope,
    id: SEEDED_MEMBER_ACCOUNT_VARIABLE_ID,
    name: "Account",
    kind: "account",
    apply: { kind: "list" },
    options: [
      { id: "member", label: "Member" },
      { id: "admin", label: "Admin" },
    ],
    createdAt: at,
    updatedAt: at,
  };
}

export function seededMemberCombine(input: {
  memberProfileId: string;
  scope?: SeededMemberScope;
  at?: number;
}): AppMapCombine {
  const scope = input.scope ?? defaultScope;
  const at = input.at ?? 1;
  return {
    ...scope,
    id: SEEDED_MEMBER_COMBINE_ID,
    name: "Member settings seats",
    variableIds: [SEEDED_MEMBER_ACCOUNT_VARIABLE_ID],
    testIds: [SEEDED_MEMBER_TEST_ID],
    selected: { [SEEDED_MEMBER_ACCOUNT_VARIABLE_ID]: ["member"] },
    strategy: "zip",
    captures: { [SEEDED_MEMBER_TEST_ID]: { mode: "every-screen" } },
    cellRuntimeProfiles: [
      {
        testId: SEEDED_MEMBER_TEST_ID,
        values: { [SEEDED_MEMBER_ACCOUNT_VARIABLE_ID]: "member" },
        targetProfileId: input.memberProfileId,
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
}

export function seededMemberGraphTest(input?: {
  includeAccidental?: boolean;
  scope?: SeededMemberScope;
  at?: number;
}): Pick<AppMapScenarioTest, "name" | "kind" | "intentSchemaVersion" | "steps"> {
  const test = seededMemberSettingsTest(input);
  return {
    name: test.name,
    kind: test.kind,
    intentSchemaVersion: test.intentSchemaVersion,
    steps: test.steps,
  };
}

export function seededMemberConnectionCreateInput(connection: Connection): {
  id: string;
  fromScreenId: string;
  destination: Connection["destination"];
  label?: string;
  state: Connection["state"];
  actions: Connection["actions"];
} {
  return {
    id: connection.id,
    fromScreenId: connection.fromScreenId,
    destination: connection.destination,
    ...(connection.label ? { label: connection.label } : {}),
    state: connection.state,
    actions: connection.actions,
  };
}

export function seededMemberLane(input: {
  role: "admin" | "member";
  fixture: { id: string; revision: number | string; reference: string };
  actorId?: string;
}): LaneSaveInput {
  const id = input.role === "admin" ? SEEDED_ADMIN_LANE_ID : SEEDED_MEMBER_LANE_ID;
  return {
    id,
    appMapId: SEEDED_MEMBER_APP_MAP_ID,
    target: { kind: "browser", browserTargetId: SEEDED_MEMBER_TARGET_ID },
    targetProfileId: seededMemberProfileId(input.role),
    engine: "chromium",
    account: {
      kind: "fixture",
      accountId: input.fixture.id,
      accountRevision: String(input.fixture.revision),
      reference: input.fixture.reference,
    },
    actorId: input.actorId ?? "human:test-runner",
    capture: { mode: "every-screen" },
  };
}

export function buildSeededMemberAppMap(input: {
  memberFixtureReference: string;
  adminFixtureReference: string;
  includeAccidental?: boolean;
  scope?: SeededMemberScope;
  at?: number;
}): AppMap {
  const scope = input.scope ?? defaultScope;
  const at = input.at ?? 1;
  const memberVariant = seededMemberHomeVariant({
    role: "member",
    fixtureReference: input.memberFixtureReference,
    scope,
    at,
  });
  const adminVariant = seededMemberHomeVariant({
    role: "admin",
    fixtureReference: input.adminFixtureReference,
    scope,
    at,
  });
  const test = seededMemberSettingsTest({
    includeAccidental: input.includeAccidental,
    scope,
    at,
  });
  const variable = seededMemberAccountVariable(scope, at);
  const combine = seededMemberCombine({
    memberProfileId: seededMemberProfileId("member"),
    scope,
    at,
  });
  return {
    schemaVersion: 1,
    id: scope.appMapId,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    name: "Seeded Member settings",
    revision: 1,
    notes: {},
    groups: {},
    screens: {
      [SEEDED_MEMBER_HOME_SCREEN_ID]: seededMemberHomeScreen(scope, at, [
        memberVariant.id,
        adminVariant.id,
      ]),
    },
    screenVariants: { [memberVariant.id]: memberVariant, [adminVariant.id]: adminVariant },
    connections: {
      [SEEDED_MEMBER_OPEN_SETTINGS_CONNECTION_ID]: seededMemberOpenSettingsConnection(scope, at),
      [SEEDED_MEMBER_ACCIDENTAL_CONNECTION_ID]: seededMemberAccidentalConnection(scope, at),
    },
    caseStacks: {},
    variables: { [variable.id]: variable },
    tests: { [test.id]: test },
    combines: { [combine.id]: combine },
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  };
}

export const SEEDED_MEMBER_ACCIDENTAL_STEP_REMOVE = {
  kind: "step.remove" as const,
  stepId: SEEDED_MEMBER_ACCIDENTAL_STEP_ID,
};
