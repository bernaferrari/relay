/** Seed the reference-30 App Map + Lanes: the frozen thirty-slot reference
 * (delivery plan FIN-21) — ten approved checkpoints in three explicit
 * configurations (Member·Firefox, Admin·Chrome, Member·WebKit).
 *
 *   node --import tsx scripts/reference-30-seed.mjs [--force]
 *
 * Screens and connections are authored here; identities come from live
 * alias-observation afterwards (scripts/reference-30-observe.mjs), never
 * from invention. The ten checkpoints per configuration:
 *   settings, language, team, profile, notifications, sessions, tokens,
 *   usage, audit, home.
 */
import { createHash } from "node:crypto";
import { readAppMap, importAppMap, saveLane } from "../packages/core/src/index.ts";

const SOURCE = "slice4-reference";
const MAP_ID = "reference-30";

const map = await readAppMap("default", SOURCE);
if (!map) throw new Error(`App Map ${SOURCE} not found — run the slice4 pilot first`);
const memberHome = Object.values(map.screens).find((s) => s.title === "Member home");
const openSettings = map.connections["open-member-settings-32"];
if (!memberHome || !openSettings) throw new Error("slice4-reference is missing the member flow");

const now = Date.now();
const settingsId = openSettings.destination.screenId;
const scoped = (entity) => ({
  organizationId: map.organizationId,
  projectId: map.projectId,
  appMapId: MAP_ID,
  createdAt: now,
  updatedAt: now,
  ...entity,
});
const syntheticIdentity = (id) => ({
  schemaVersion: 1,
  fingerprint: createHash("sha256").update(`reference-30:${id}:v1`).digest("hex"),
});

const CHECKPOINTS = [
  { id: "settings", screenId: settingsId, title: "Workspace settings" },
  { id: "language", screenId: "screen-language", title: "Preferred language" },
  { id: "team", screenId: "screen-team", title: "Team permissions" },
  { id: "profile", screenId: "screen-profile", title: "Profile" },
  { id: "notifications", screenId: "screen-notifications", title: "Notifications" },
  { id: "sessions", screenId: "screen-sessions", title: "Active sessions" },
  { id: "tokens", screenId: "screen-tokens", title: "API tokens" },
  { id: "usage", screenId: "screen-usage", title: "Usage and quota" },
  { id: "audit", screenId: "screen-audit", title: "Audit log" },
  { id: "home", screenId: memberHome.id, title: "Member home" },
];

const NAV_LINKS = {
  language: { label: "Language", from: settingsId },
  team: { label: "Manage team permissions", from: settingsId },
  profile: { label: "Profile", from: settingsId },
  notifications: { label: "Notifications", from: settingsId },
  sessions: { label: "Active sessions", from: settingsId },
  tokens: { label: "API tokens", from: settingsId },
  usage: { label: "Usage and quota", from: settingsId },
  audit: { label: "Audit log", from: settingsId },
};

const screens = {
  [memberHome.id]: {
    ...map.screens[memberHome.id],
    appMapId: MAP_ID,
    title: "Member home",
    variantIds: [],
  },
  [settingsId]: {
    ...map.screens[settingsId],
    appMapId: MAP_ID,
    title: "Workspace settings",
    variantIds: [],
  },
};
const connections = {
  "open-member-settings-32": { ...openSettings, appMapId: MAP_ID },
};
const backConnections = {};
for (const checkpoint of CHECKPOINTS) {
  if (checkpoint.screenId === settingsId || checkpoint.screenId === memberHome.id) continue;
  screens[checkpoint.screenId] = scoped({
    id: checkpoint.screenId,
    title: checkpoint.title,
    variantIds: [],
    identity: syntheticIdentity(checkpoint.screenId),
  });
}
for (const [id, link] of Object.entries(NAV_LINKS)) {
  const checkpoint = CHECKPOINTS.filter((candidate) => candidate.id === id)[0];
  connections[`ref-open-${id}`] = scoped({
    id: `ref-open-${id}`,
    fromScreenId: link.from,
    destination: { kind: "screen", screenId: checkpoint.screenId },
    label: checkpoint.title,
    state: "ready",
    actions: [{ id: `tap-ref-open-${id}`, kind: "tap", target: { label: link.label } }],
    sourceAnchor: { point: { x: 0.05, y: 0.3 } },
  });
  // Every workspace page links back to Settings.
  backConnections[`ref-back-${id}`] = scoped({
    id: `ref-back-${id}`,
    fromScreenId: checkpoint.screenId,
    destination: { kind: "screen", screenId: settingsId },
    label: "Back to settings",
    state: "ready",
    actions: [{ id: `tap-ref-back-${id}`, kind: "tap", target: { label: "Settings" } }],
    sourceAnchor: { point: { x: 0.05, y: 0.5 } },
  });
}
// settings → home closes the loop for the final home checkpoint.
connections["ref-open-home"] = scoped({
  id: "ref-open-home",
  fromScreenId: settingsId,
  destination: { kind: "screen", screenId: memberHome.id },
  label: "Member home",
  state: "ready",
  actions: [{ id: "tap-ref-open-home", kind: "tap", target: { label: "Home" } }],
  sourceAnchor: { point: { x: 0.05, y: 0.9 } },
});

function stepsForRole(role) {
  const steps = [
    {
      id: `${role}-open-settings`,
      intent: "Settings",
      capture: true,
      kind: "instruction",
      binding: {
        status: "resolved",
        kind: "connections",
        connectionIds: ["open-member-settings-32"],
      },
    },
  ];
  const order = [
    "language",
    "team",
    "profile",
    "notifications",
    "sessions",
    "tokens",
    "usage",
    "audit",
  ];
  for (const id of order) {
    steps.push({
      id: `${role}-open-${id}`,
      intent: CHECKPOINTS.filter((candidate) => candidate.id === id)[0].title,
      capture: true,
      kind: "instruction",
      binding: { status: "resolved", kind: "connections", connectionIds: [`ref-open-${id}`] },
    });
    steps.push({
      id: `${role}-back-${id}`,
      intent: "Settings",
      capture: false,
      kind: "instruction",
      binding: { status: "resolved", kind: "connections", connectionIds: [`ref-back-${id}`] },
    });
  }
  steps.push({
    id: `${role}-open-home`,
    intent: "Member home",
    capture: true,
    kind: "instruction",
    binding: { status: "resolved", kind: "connections", connectionIds: ["ref-open-home"] },
  });
  return steps;
}

const demo = {
  ...map,
  id: MAP_ID,
  name: "Reference 30",
  revision: 1,
  notes: {},
  groups: {},
  proposals: {},
  activity: {},
  caseStacks: {},
  variables: {},
  combines: {},
  routines: {},
  flows: {},
  runs: {},
  targetResults: {},
  updatedAt: now,
  screens,
  screenVariants: {},
  connections: { ...connections, ...backConnections },
  tests: {
    "test-member-reference": scoped({
      id: "test-member-reference",
      name: "Member reference (10 checkpoints)",
      kind: "scenario",
      intentSchemaVersion: 1,
      steps: stepsForRole("member"),
      capture: { mode: "final-screen" },
      validation: { status: "passed", appMapRevision: 1, testUpdatedAt: now, validatedAt: now },
    }),
    "test-admin-reference": scoped({
      id: "test-admin-reference",
      name: "Admin reference (10 checkpoints)",
      kind: "scenario",
      intentSchemaVersion: 1,
      steps: stepsForRole("admin"),
      capture: { mode: "final-screen" },
      validation: { status: "passed", appMapRevision: 1, testUpdatedAt: now, validatedAt: now },
    }),
  },
};

const existing = await readAppMap("default", MAP_ID);
if (existing && !process.argv.includes("--force")) {
  console.log(
    `reference-30 already exists (revision ${existing.revision}); re-run with --force to replace`,
  );
} else {
  await importAppMap({
    organizationId: map.organizationId,
    projectId: map.projectId,
    appMap: demo,
    conflict: "replace",
  });
}

const MEMBER_FIXTURE = {
  kind: "fixture",
  accountId: "f622d450-7cad-4740-b07d-1eb10b8496b4",
  accountRevision: "1",
  reference: "authfx:f622d450-7cad-4740-b07d-1eb10b8496b4:1",
};
const ADMIN_FIXTURE = {
  kind: "fixture",
  accountId: "59021f2e-c845-405a-b60b-36754c27a990",
  accountRevision: "1",
  reference: "authfx:59021f2e-c845-405a-b60b-36754c27a990:1",
};

await saveLane({
  projectId: map.projectId,
  id: "reference-member-firefox",
  appMapId: MAP_ID,
  target: { kind: "browser", browserTargetId: "slice4-firefox-member" },
  engine: "firefox",
  targetProfileId: "browser:slice4-firefox-member-1280x800-ad0f5fce2a52",
  account: MEMBER_FIXTURE,
});
await saveLane({
  projectId: map.projectId,
  id: "reference-admin-chrome",
  appMapId: MAP_ID,
  target: { kind: "browser", browserTargetId: "slice4-chrome-admin" },
  engine: "chromium",
  targetProfileId: "browser:slice4-chrome-admin-1280x800-30bf622d6316",
  account: ADMIN_FIXTURE,
});
await saveLane({
  projectId: map.projectId,
  id: "reference-member-webkit",
  appMapId: MAP_ID,
  target: { kind: "browser", browserTargetId: "slice4-webkit-signedout" },
  engine: "webkit",
  targetProfileId: "browser:slice4-webkit-member-1280x800-c7d2f30a91b4",
  account: MEMBER_FIXTURE,
});

console.log(
  `seeded ${MAP_ID}: ${Object.keys(screens).length} screens, ${Object.keys(connections).length + Object.keys(backConnections).length} connections, 2 tests × 10 checkpoints, 3 lanes`,
);
