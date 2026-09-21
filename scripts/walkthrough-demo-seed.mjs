/** Seed the walkthrough-demo App Map + Lanes for the captured-app player
 * (delivery plan §6.6): three real states (Home, Settings, Language), two
 * recorded connections, one authored link, member + admin configurations.
 *
 * Prerequisite: the slice4-reference map (recorded during the Slice 4 pilot).
 *   node --import tsx scripts/walkthrough-demo-seed.mjs
 */
import { createHash } from "node:crypto";
import { readAppMap, importAppMap, saveLane } from "../packages/core/src/index.ts";

const SOURCE = "slice4-reference";
const DEMO = "walkthrough-demo";

const map = await readAppMap("default", SOURCE);
if (!map) throw new Error(`App Map ${SOURCE} not found — run the slice4 pilot first`);

const memberHome = Object.values(map.screens).find((s) => s.title === "Member home");
if (!memberHome) throw new Error("slice4-reference has no Member home screen");
const openSettings = Object.values(map.connections).find((c) => c.id === "open-member-settings-32");
if (!openSettings) throw new Error("slice4-reference has no open-member-settings-32 connection");
const settingsScreenId = openSettings.destination.screenId;

const now = Date.now();
const scoped = (entity, extra = {}) => ({
  organizationId: map.organizationId,
  projectId: map.projectId,
  appMapId: DEMO,
  createdAt: now,
  updatedAt: now,
  ...entity,
  ...extra,
});

const languageScreen = scoped({
  id: "screen-language",
  title: "Preferred language",
  variantIds: [],
  identity: {
    schemaVersion: 1,
    fingerprint: createHash("sha256")
      .update("walkthrough-demo:screen-language:preferred-language:v1")
      .digest("hex"),
  },
});
const openLanguage = scoped({
  id: "open-language",
  fromScreenId: settingsScreenId,
  destination: { kind: "screen", screenId: "screen-language" },
  label: "Preferred language",
  state: "ready",
  actions: [{ id: "tap-open-language", kind: "tap", target: { label: "Language" } }],
  sourceAnchor: { point: { x: 0.07, y: 0.31 } },
});
// Authored link: visibly wired on the map, never executed by a run.
const languageHome = scoped({
  id: "language-home-authored",
  fromScreenId: "screen-language",
  destination: { kind: "screen", screenId: memberHome.id },
  label: "Back to home",
  state: "draft",
  actions: [{ id: "tap-language-home", kind: "tap", target: { label: "Home" } }],
});

const memberTest = map.tests["test-member-v2"];
if (!memberTest) throw new Error("slice4-reference has no test-member-v2");
const extendedMember = {
  ...memberTest,
  appMapId: DEMO,
  updatedAt: now,
  steps: [
    ...memberTest.steps,
    {
      id: "member-open-language",
      intent: "Language",
      capture: true,
      kind: "instruction",
      binding: { status: "resolved", kind: "connections", connectionIds: ["open-language"] },
    },
  ],
};
// The admin configuration covers Home → Settings only: Language stays an
// honest missing state for that variant in the player.
const adminTest = scoped(
  {
    id: "test-admin-settings",
    name: "Admin settings walkthrough",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "admin-open-settings",
        intent: "Settings",
        capture: true,
        kind: "instruction",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["open-member-settings-32"],
        },
      },
    ],
    capture: { mode: "final-screen" },
  },
  {
    validation: {
      status: "passed",
      appMapRevision: map.revision,
      testUpdatedAt: now,
      validatedAt: now,
    },
  },
);

const demo = {
  ...map,
  id: DEMO,
  name: "Walkthrough demo",
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
  screens: {
    [memberHome.id]: { ...map.screens[memberHome.id], appMapId: DEMO },
    [settingsScreenId]: {
      ...map.screens[settingsScreenId],
      appMapId: DEMO,
      title: "Workspace settings",
    },
    "screen-language": languageScreen,
  },
  screenVariants: Object.fromEntries(
    [
      ...(map.screens[memberHome.id].variantIds ?? []),
      ...(map.screens[settingsScreenId].variantIds ?? []),
    ]
      .map((variantId) => {
        const variant = map.screenVariants[variantId];
        return variant ? [variantId, { ...variant, appMapId: DEMO }] : null;
      })
      .filter(Boolean),
  ),
  connections: {
    "open-member-settings-32": { ...openSettings, appMapId: DEMO },
    "open-language": openLanguage,
    "language-home-authored": languageHome,
  },
  tests: {
    "test-member-v2": extendedMember,
    "test-admin-settings": adminTest,
  },
};

const existing = await readAppMap("default", DEMO);
if (existing && !process.argv.includes("--force")) {
  console.log(
    `walkthrough-demo already exists (revision ${existing.revision}); re-run with --force to replace`,
  );
} else {
  await importAppMap({
    organizationId: map.organizationId,
    projectId: map.projectId,
    appMap: demo,
    conflict: "replace",
  });
}

await saveLane({
  projectId: map.projectId,
  id: "walkthrough-member",
  appMapId: DEMO,
  target: { kind: "browser", browserTargetId: "slice4-firefox-member" },
  engine: "firefox",
  targetProfileId: "browser:slice4-firefox-member-1280x800-ad0f5fce2a52",
  account: {
    kind: "fixture",
    accountId: "f622d450-7cad-4740-b07d-1eb10b8496b4",
    accountRevision: "1",
    reference: "authfx:f622d450-7cad-4740-b07d-1eb10b8496b4:1",
  },
});
await saveLane({
  projectId: map.projectId,
  id: "walkthrough-admin",
  appMapId: DEMO,
  target: { kind: "browser", browserTargetId: "slice4-chrome-admin" },
  engine: "chromium",
  targetProfileId: "browser:slice4-chrome-admin-1280x800-30bf622d6316",
  account: {
    kind: "fixture",
    accountId: "59021f2e-c845-405a-b60b-36754c27a990",
    accountRevision: "1",
    reference: "authfx:59021f2e-c845-405a-b60b-36754c27a990:1",
  },
});

console.log(
  `seeded ${DEMO}: screens ${Object.keys(demo.screens).length}, connections ${Object.keys(demo.connections).length}, lanes walkthrough-member + walkthrough-admin`,
);
