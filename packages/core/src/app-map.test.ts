import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCombine, AppMapTest, AppMapVariable, TargetProfile } from "@relay/protocol";
import {
  AppMapDomainError,
  addAppMapScreen,
  approveAppMapProposal,
  attachAppMapCaseStack,
  connectAppMapScreens,
  commitAppMapChanges,
  previewRoutineImpact,
  rejectAppMapProposal,
  removeAppMapConnection,
  removeAppMapCaseStack,
  removeAppMapFlow,
  removeAppMapTest,
  removeAppMapVariable,
  removeAppMapRoutine,
  removeAppMapScreen,
  saveAppMapFlow,
  saveAppMapCaseStack,
  saveAppMapCombine,
  saveAppMapTest,
  saveAppMapVariable,
  saveAppMapRoutine,
  serializeAppMap,
  submitAppMapProposal,
  updateAppMapConnection,
  updateAppMap,
  updateAppMapScreen,
  validateAppMap,
  type ActionSpec,
  type AppMap,
  type AppMapEntity,
  type AppMapErrorCode,
  type AppMapMutationContext,
  type Connection,
  type Proposal,
  type Routine,
  type Screen,
  type ScreenVariant,
} from "./app-map.js";

const at = 1_000;
const fingerprint = "a".repeat(64);
const scope = { organizationId: "org-1", projectId: "project-1", appMapId: "map-1" };

function entity(id: string, updatedAt = at): AppMapEntity {
  return { ...scope, id, createdAt: at, updatedAt };
}

function profile(id = "pixel-8"): TargetProfile {
  return {
    id,
    targetId: `target-${id}`,
    source: "device",
    platform: "android",
    name: id,
    capabilities: [],
    observedAt: at,
  };
}

function screen(id: string, variants: string[] = []): Screen {
  return {
    ...entity(id),
    title: id === "start" ? "Welcome" : id === "home" ? "Home" : id,
    identity: { schemaVersion: 1, fingerprint },
    variantIds: variants,
  };
}

function variant(id: string, screenId: string, target = profile()): ScreenVariant {
  return {
    ...entity(id),
    screenId,
    targetProfile: target,
    observation: { fingerprint, nodes: [], volatileSignals: [] },
    evidenceIds: ["evidence-screen"],
    evidenceUris: ["relay-evidence://captures/evidence-screen"],
  };
}

function actions(): ActionSpec[] {
  return [
    {
      id: "recorded",
      kind: "recorded",
      takeId: "take-1",
      takeRevision: 1,
      steps: [{ id: "step-1", kind: "tap", target: { label: "Continue" } }],
      evidenceIds: ["evidence-take"],
    },
    {
      id: "steps",
      kind: "steps",
      steps: [
        {
          id: "paste-multiline",
          kind: "clipboard",
          action: "paste",
          text: "alpha\nbeta\ngamma",
          target: { identifier: "composer" },
        },
      ],
    },
    { id: "tap", kind: "tap", target: { label: "Continue" } },
    { id: "text", kind: "text", text: "Ada", target: { ref: "name" } },
    {
      id: "swipe",
      kind: "gesture",
      gesture: { kind: "swipe", from: { x: 10, y: 20 }, to: { x: 10, y: 200 } },
    },
    { id: "scroll", kind: "gesture", gesture: { kind: "scroll", direction: "down", amount: 2 } },
    { id: "back", kind: "back" },
    { id: "home", kind: "home" },
    { id: "open-app", kind: "app", action: "open", app: "com.example.store" },
    { id: "close-app", kind: "app", action: "close", app: "com.example.store" },
    { id: "wait", kind: "wait", ms: 500 },
    { id: "assert-screen", kind: "assertion", assertion: { kind: "screen", screenId: "home" } },
    {
      id: "assert-target",
      kind: "assertion",
      assertion: { kind: "target", target: { text: "Ready" }, condition: "visible" },
    },
    {
      id: "assert-content",
      kind: "assertion",
      assertion: { kind: "content", input: "status", expected: "ready", match: "exact" },
    },
    { id: "routine", kind: "routine", routineId: "sign-in", bindings: { email: "{{email}}" } },
    { id: "passive", kind: "passive", reason: "automatic" },
  ];
}

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    ...entity("open-home"),
    fromScreenId: "start",
    destination: { kind: "screen", screenId: "home" },
    label: "Continue",
    state: "ready",
    actions: actions(),
    ...overrides,
  };
}

function routine(id: string, routineActions: ActionSpec[]): Routine {
  return {
    ...entity(id),
    name: id,
    parameters: id === "sign-in" ? [{ name: "email", required: true }] : [],
    actions: routineActions,
  };
}

function pendingProposal(baseRevision: number): Proposal {
  return {
    ...entity("proposal-1"),
    title: "Add settings",
    status: "pending",
    baseRevision,
    changes: [
      {
        kind: "screen.add",
        input: { screen: screen("settings") },
      },
    ],
  };
}

function mapFixture(): AppMap {
  const startVariant = variant("variant-start", "start");
  const homeVariant: ScreenVariant = {
    ...variant("variant-home", "home"),
    baseline: {
      approvedAt: at,
      approvedBy: "person-1",
      source: { kind: "run", targetResultId: "result-1", evidenceId: "evidence-run" },
    },
  };
  const signIn = routine("sign-in", [{ id: "enter-email", kind: "text", text: "{{email}}" }]);
  return {
    schemaVersion: 1,
    id: scope.appMapId,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    name: "Store",
    revision: 3,
    notes: {},
    groups: {},
    screens: {
      start: screen("start", [startVariant.id]),
      home: screen("home", [homeVariant.id]),
    },
    screenVariants: { [startVariant.id]: startVariant, [homeVariant.id]: homeVariant },
    connections: { "open-home": connection() },
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: { [signIn.id]: signIn },
    flows: {
      main: {
        ...entity("main"),
        name: "Main",
        startScreenId: "start",
        connectionIds: ["open-home"],
      },
    },
    runs: {
      "run-1": {
        ...entity("run-1"),
        flowId: "main",
        appMapRevision: 2,
        targetResultIds: ["result-1"],
        startedAt: at,
        finishedAt: at + 100,
      },
    },
    targetResults: {
      "result-1": {
        ...entity("result-1"),
        runId: "run-1",
        targetProfile: profile(),
        outcome: "passed",
        connectionId: "open-home",
        evidenceIds: ["evidence-run"],
        finishedAt: at + 100,
      },
    },
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  };
}

function context(map: AppMap, eventId: string, nextAt = map.updatedAt + 1): AppMapMutationContext {
  return {
    expectedRevision: map.revision,
    eventId,
    actorId: "person-1",
    actorKind: "human",
    at: nextAt,
  };
}

function expectError(code: AppMapErrorCode, run: () => unknown, message?: RegExp): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof AppMapDomainError);
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return true;
  });
}

test("validates a normalized project map containing every action kind and returns a clone", () => {
  const input = mapFixture();
  const validated = validateAppMap(input);

  assert.deepEqual(validated, input);
  assert.notEqual(validated, input);
  assert.notEqual(validated.connections["open-home"], input.connections["open-home"]);
  validated.screens.start!.title = "Changed clone";
  assert.equal(input.screens.start!.title, "Welcome");
  assert.deepEqual(
    input.connections["open-home"]!.actions.map((action) => action.kind),
    [
      "recorded",
      "steps",
      "tap",
      "text",
      "gesture",
      "gesture",
      "back",
      "home",
      "app",
      "app",
      "wait",
      "assertion",
      "assertion",
      "assertion",
      "routine",
      "passive",
    ],
  );
});

test("commits a canvas gesture atomically as one revision and one activity event", () => {
  const input = mapFixture();
  input.groups.home = {
    ...scope,
    id: "home",
    name: "Home Group",
    screenIds: ["home"],
    createdAt: at,
    updatedAt: at,
  };
  delete input.screenVariants["variant-home"]!.baseline;
  delete input.targetResults["result-1"];
  delete input.runs["run-1"];
  const result = commitAppMapChanges(
    input,
    [
      { kind: "flow.remove", flowId: "main" },
      { kind: "connection.remove", connectionId: "open-home" },
      { kind: "screen.remove", screenId: "home" },
    ],
    { notes: {} },
    context(input, "canvas-commit"),
    "Removed Home path",
  );

  assert.equal(result.revision, input.revision + 1);
  assert.equal(Object.keys(result.activity).length, 1);
  assert.equal(result.activity["canvas-commit"]?.eventType, "app-map.committed");
  assert.equal(result.screens.home, undefined);
  assert.equal(result.groups.home, undefined);
  assert.ok(input.screens.home, "the original map remains untouched");
});

test("keeps Groups visual-only and enforces one Group per screen", () => {
  const input = mapFixture();
  const grouped = commitAppMapChanges(
    input,
    [
      {
        kind: "group.save",
        group: {
          ...scope,
          id: "settings",
          name: "Settings",
          screenIds: ["start", "home"],
          createdAt: at,
          updatedAt: at,
        },
      },
    ],
    undefined,
    context(input, "group-settings"),
  );
  assert.deepEqual(grouped.groups.settings?.screenIds, ["start", "home"]);
  assert.deepEqual(grouped.connections, input.connections);

  expectError("in-use", () =>
    commitAppMapChanges(
      grouped,
      [
        {
          kind: "group.save",
          group: {
            ...scope,
            id: "duplicate",
            name: "Duplicate",
            screenIds: ["home"],
            createdAt: at,
            updatedAt: at,
          },
        },
      ],
      undefined,
      context(grouped, "group-duplicate"),
    ),
  );
});

test("rejects an invalid canvas batch without exposing a partial draft", () => {
  const input = mapFixture();
  expectError("missing-reference", () =>
    commitAppMapChanges(
      input,
      [
        { kind: "screen.add", input: { screen: screen("temporary") } },
        { kind: "screen.remove", screenId: "missing" },
      ],
      undefined,
      context(input, "invalid-canvas-commit"),
    ),
  );
  assert.equal(input.screens.temporary, undefined);
  assert.equal(input.revision, 3);
});

test("rejects invalid schema, record keys, scope, duplicate actions, and missing references", () => {
  const schema = mapFixture();
  (schema as unknown as { schemaVersion: number }).schemaVersion = 2;
  expectError("invalid-map", () => validateAppMap(schema), /schemaVersion/u);

  const key = mapFixture();
  key.screens.wrong = key.screens.start!;
  delete key.screens.start;
  expectError("invalid-map", () => validateAppMap(key), /does not match entity id/u);

  const scoped = mapFixture();
  scoped.screens.start!.projectId = "another-project";
  expectError("scope-mismatch", () => validateAppMap(scoped));

  const duplicate = mapFixture();
  duplicate.connections["open-home"]!.actions.push({ id: "tap", kind: "back" });
  expectError("duplicate-id", () => validateAppMap(duplicate), /duplicate action/u);

  const missing = mapFixture();
  missing.connections["open-home"]!.destination = { kind: "screen", screenId: "missing" };
  expectError("missing-reference", () => validateAppMap(missing), /missing screen/u);
});

test("validates variant ownership, baseline provenance, and one variant per target profile", () => {
  const orphan = mapFixture();
  orphan.screens.start!.variantIds = [];
  expectError("missing-reference", () => validateAppMap(orphan), /not owned/u);

  const wrongBaseline = mapFixture();
  wrongBaseline.screenVariants["variant-home"]!.baseline = {
    approvedAt: at,
    approvedBy: "person-1",
    source: { kind: "run", targetResultId: "missing" },
  };
  expectError("missing-reference", () => validateAppMap(wrongBaseline), /baseline/u);

  const duplicateTarget = mapFixture();
  const second = variant("variant-home-copy", "home");
  duplicateTarget.screenVariants[second.id] = second;
  duplicateTarget.screens.home!.variantIds.push(second.id);
  expectError("duplicate-id", () => validateAppMap(duplicateTarget), /target profile/u);

  const externalEvidence = mapFixture();
  externalEvidence.screenVariants["variant-home"]!.evidenceUris = [
    "https://example.com/untrusted.png",
  ];
  expectError("invalid-map", () => validateAppMap(externalEvidence), /Relay evidence resource/u);
});

test("rejects routine cycles, missing routine references, and missing asserted screens", () => {
  const missingRoutine = mapFixture();
  missingRoutine.connections["open-home"]!.actions.find(
    (action) => action.kind === "routine",
  )!.routineId = "missing";
  expectError("missing-reference", () => validateAppMap(missingRoutine), /missing routine/u);

  const missingSetup = mapFixture();
  missingSetup.flows.main!.setup = { routineId: "missing" };
  expectError("missing-reference", () => validateAppMap(missingSetup), /missing setup Routine/u);

  const missingSetupBinding = mapFixture();
  missingSetupBinding.flows.main!.setup = { routineId: "sign-in" };
  expectError(
    "missing-reference",
    () => validateAppMap(missingSetupBinding),
    /required parameter email on setup Routine/u,
  );

  const missingBinding = mapFixture();
  const invocation = missingBinding.connections["open-home"]!.actions.find(
    (action) => action.kind === "routine",
  );
  assert.ok(invocation?.kind === "routine");
  delete invocation.bindings;
  expectError(
    "missing-reference",
    () => validateAppMap(missingBinding),
    /required parameter email/u,
  );

  const cycle = mapFixture();
  cycle.routines.wrapper = routine("wrapper", [
    { id: "call-sign-in", kind: "routine", routineId: "sign-in", bindings: { email: "{{email}}" } },
  ]);
  cycle.routines["sign-in"]!.actions.push({
    id: "call-wrapper",
    kind: "routine",
    routineId: "wrapper",
  });
  expectError("invalid-map", () => validateAppMap(cycle), /cycle/u);

  const assertion = mapFixture();
  const action = assertion.connections["open-home"]!.actions.find(
    (item) => item.id === "assert-screen",
  );
  assert.ok(action?.kind === "assertion" && action.assertion.kind === "screen");
  action.assertion.screenId = "missing";
  expectError("missing-reference", () => validateAppMap(assertion), /asserts missing screen/u);
});

test("recorded actions use the canonical RecipeStep validator", () => {
  const input = mapFixture();
  const recorded = input.connections["open-home"]!.actions[0];
  assert.ok(recorded?.kind === "recorded");
  recorded.steps = [{ kind: "tap", target: {} }];
  expectError("invalid-map", () => validateAppMap(input), /steps are invalid/u);
});

test("rejects discontinuous flows and inconsistent run/target-result references", () => {
  const discontinuous = mapFixture();
  discontinuous.connections.other = connection({
    ...entity("other"),
    fromScreenId: "home",
    destination: { kind: "end" },
  });
  discontinuous.flows.main!.connectionIds = ["other"];
  expectError("invalid-map", () => validateAppMap(discontinuous), /discontinuous/u);

  const result = mapFixture();
  result.runs["run-1"]!.targetResultIds = [];
  expectError("missing-reference", () => validateAppMap(result), /not owned by run/u);
});

test("adds a screen and variants without mutating input and records one revisioned event", () => {
  const input = mapFixture();
  const addedVariant = variant("variant-help", "help", profile("iphone-15"));
  addedVariant.targetProfile.source = "device";
  addedVariant.targetProfile.platform = "ios";
  const next = addAppMapScreen(
    input,
    { screen: screen("help", [addedVariant.id]), variants: [addedVariant] },
    context(input, "event-add"),
  );

  assert.equal(input.screens.help, undefined);
  assert.equal(next.screens.help?.title, "help");
  assert.equal(next.screenVariants[addedVariant.id]?.screenId, "help");
  assert.equal(next.revision, 4);
  assert.deepEqual(next.activity["event-add"], {
    ...scope,
    id: "event-add",
    actorId: "person-1",
    actorKind: "human",
    eventType: "screen.added",
    subject: { kind: "screen", id: "help" },
    summary: "Added screen help",
    at: at + 1,
    beforeRevision: 3,
    afterRevision: 4,
  });
});

test("updates screen fields and normalized variants, including explicit field removal", () => {
  const input = mapFixture();
  const tablet = variant("variant-tablet", "home", profile("ipad-pro"));
  tablet.targetProfile.platform = "ios";
  const next = updateAppMapScreen(
    input,
    "home",
    {
      patch: { title: "Dashboard", description: "Primary state", identity: null },
      removeVariantIds: ["variant-home"],
      upsertVariants: [tablet],
    },
    context(input, "event-update-screen"),
  );

  assert.deepEqual(next.screens.home?.variantIds, ["variant-tablet"]);
  assert.equal(next.screenVariants["variant-home"], undefined);
  assert.equal(next.screenVariants["variant-tablet"]?.screenId, "home");
  assert.equal(next.screens.home?.title, "Dashboard");
  assert.equal(next.screens.home?.description, "Primary state");
  assert.equal(next.screens.home?.identity, undefined);
});

test("updating a variant preserves durable preview, baseline, and prior evidence", () => {
  const input = mapFixture();
  const existing = input.screenVariants["variant-home"]!;
  existing.evidenceIds = ["semantic-before", "screenshot-before"];
  existing.evidenceUris = [
    "relay-evidence://semantic-before",
    "relay-evidence://screenshot-before",
  ];
  existing.screenshotUri = "relay-evidence://screenshot-before";

  const incoming = structuredClone(existing);
  incoming.evidenceIds = ["semantic-after", "screenshot-after"];
  incoming.evidenceUris = ["relay-evidence://semantic-after", "relay-evidence://screenshot-after"];
  delete incoming.screenshotUri;
  delete incoming.baseline;

  const next = updateAppMapScreen(
    input,
    "home",
    { patch: {}, upsertVariants: [incoming] },
    context(input, "event-preserve-variant-evidence"),
  );
  const updated = next.screenVariants["variant-home"]!;

  assert.deepEqual(updated.evidenceIds, [
    "semantic-before",
    "screenshot-before",
    "semantic-after",
    "screenshot-after",
  ]);
  assert.deepEqual(updated.evidenceUris, [
    "relay-evidence://semantic-before",
    "relay-evidence://screenshot-before",
    "relay-evidence://semantic-after",
    "relay-evidence://screenshot-after",
  ]);
  assert.equal(updated.screenshotUri, "relay-evidence://screenshot-before");
  assert.deepEqual(updated.baseline, existing.baseline);
});

test("screen removal is safe and explains connections, flows, assertions, and proposals that block it", () => {
  const connected = mapFixture();
  expectError(
    "in-use",
    () => removeAppMapScreen(connected, "home", context(connected, "remove-home")),
    /connection/u,
  );

  const free = mapFixture();
  delete free.screenVariants["variant-home"]!.baseline;
  delete free.targetResults["result-1"];
  delete free.runs["run-1"];
  delete free.connections["open-home"];
  free.flows.main!.connectionIds = [];
  const removed = removeAppMapScreen(free, "home", context(free, "remove-free"));
  assert.equal(removed.screens.home, undefined);
  assert.equal(removed.screenVariants["variant-home"], undefined);

  const proposed = mapFixture();
  proposed.proposals["proposal-1"] = {
    ...pendingProposal(proposed.revision),
    changes: [{ kind: "screen.update", screenId: "start", input: { patch: { title: "Entry" } } }],
  };
  delete proposed.screenVariants["variant-home"]!.baseline;
  delete proposed.targetResults["result-1"];
  delete proposed.runs["run-1"];
  delete proposed.connections["open-home"];
  proposed.flows.main!.connectionIds = [];
  proposed.flows.main!.startScreenId = "home";
  expectError(
    "in-use",
    () => removeAppMapScreen(proposed, "start", context(proposed, "remove-proposed")),
    /proposal/u,
  );
});

test("connects and updates an edge while preserving immutable input", () => {
  const input = mapFixture();
  const done = connection({
    ...entity("finish"),
    fromScreenId: "home",
    destination: { kind: "end" },
    actions: [{ id: "finish-passive", kind: "passive", reason: "observe-only" }],
  });
  const connected = connectAppMapScreens(input, done, context(input, "connect-finish"));
  assert.equal(input.connections.finish, undefined);
  assert.equal(connected.connections.finish?.destination.kind, "end");

  const updated = updateAppMapConnection(
    connected,
    "finish",
    { label: null, state: "draft", actions: [{ id: "go-home", kind: "home" }] },
    context(connected, "update-finish"),
  );
  assert.equal(updated.connections.finish?.label, undefined);
  assert.equal(updated.connections.finish?.state, "draft");
  assert.deepEqual(updated.connections.finish?.actions, [{ id: "go-home", kind: "home" }]);
});

test("connection removal rejects flow and immutable result references", () => {
  const flowUse = mapFixture();
  expectError(
    "in-use",
    () => removeAppMapConnection(flowUse, "open-home", context(flowUse, "remove-edge")),
    /flow/u,
  );

  const resultUse = mapFixture();
  resultUse.flows.main!.connectionIds = [];
  expectError(
    "in-use",
    () => removeAppMapConnection(resultUse, "open-home", context(resultUse, "remove-result-edge")),
    /target result/u,
  );

  const free = mapFixture();
  free.flows.main!.connectionIds = [];
  delete free.screenVariants["variant-home"]!.baseline;
  delete free.targetResults["result-1"];
  delete free.runs["run-1"];
  const removed = removeAppMapConnection(free, "open-home", context(free, "remove-free-edge"));
  assert.equal(removed.connections["open-home"], undefined);
});

test("all mutations reject stale revisions and duplicate activity IDs", () => {
  const input = mapFixture();
  expectError(
    "revision-conflict",
    () =>
      addAppMapScreen(
        input,
        { screen: screen("help") },
        { ...context(input, "stale"), expectedRevision: 2 },
      ),
    /current revision is 3/u,
  );
  input.activity.duplicate = {
    ...scope,
    id: "duplicate",
    actorId: "person-1",
    actorKind: "human",
    eventType: "screen.updated",
    subject: { kind: "screen", id: "start" },
    summary: "Earlier change",
    at,
    beforeRevision: 1,
    afterRevision: 2,
  };
  expectError("duplicate-id", () =>
    updateAppMapScreen(input, "start", { patch: { title: "Entry" } }, context(input, "duplicate")),
  );
  expectError(
    "invalid-map",
    () =>
      updateAppMapScreen(
        input,
        "start",
        { patch: { title: "Entry" } },
        context(input, "time-travel", at - 1),
      ),
    /cannot precede/u,
  );
});

test("previews direct and transitive routine impact in deterministic order", () => {
  const input = mapFixture();
  input.flows.main!.setup = {
    routineId: "sign-in",
    bindings: { email: "setup@example.test" },
  };
  input.routines.wrapper = routine("wrapper", [
    { id: "wrapper-call", kind: "routine", routineId: "sign-in", bindings: { email: "{{email}}" } },
  ]);
  input.routines.checkout = routine("checkout", [
    { id: "checkout-call", kind: "routine", routineId: "wrapper" },
  ]);
  input.connections["open-home"]!.actions.push({
    id: "checkout-use",
    kind: "routine",
    routineId: "checkout",
  });
  input.connections.direct = connection({
    ...entity("direct"),
    actions: [
      {
        id: "direct-use",
        kind: "routine",
        routineId: "sign-in",
        bindings: { email: "test@example.com" },
      },
    ],
  });
  input.flows.alternate = {
    ...entity("alternate"),
    name: "Alternate",
    startScreenId: "start",
    connectionIds: ["direct"],
  };

  assert.deepEqual(previewRoutineImpact(input, "sign-in"), {
    routineId: "sign-in",
    directUsages: [
      { ownerKind: "connection", ownerId: "direct", actionId: "direct-use" },
      { ownerKind: "connection", ownerId: "open-home", actionId: "routine" },
      { ownerKind: "flow", ownerId: "main" },
      { ownerKind: "routine", ownerId: "wrapper", actionId: "wrapper-call" },
    ],
    affectedRoutineIds: ["checkout", "wrapper"],
    affectedConnectionIds: ["direct", "open-home"],
    affectedFlowIds: ["alternate", "main"],
  });
});

test("submits and approves a proposal with attributable revisioned events", () => {
  const input = mapFixture();
  const submitted = submitAppMapProposal(
    input,
    pendingProposal(input.revision),
    context(input, "submit-for-approval"),
  );
  const next = approveAppMapProposal(
    submitted,
    "proposal-1",
    context(submitted, "approve-proposal", submitted.updatedAt + 1),
    "Looks correct",
  );

  assert.equal(input.screens.settings, undefined);
  assert.equal(next.screens.settings?.title, "settings");
  assert.equal(next.proposals["proposal-1"]?.status, "approved");
  assert.deepEqual(next.proposals["proposal-1"]?.decision, {
    actorId: "person-1",
    at: at + 2,
    reason: "Looks correct",
  });
  assert.equal(next.revision, input.revision + 2);
  assert.equal(Object.keys(next.activity).length, 2);
  expectError("proposal-state", () =>
    approveAppMapProposal(next, "proposal-1", context(next, "approve-again")),
  );
});

test("proposal approval rejects invalid changes without mutating the source map", () => {
  const invalid = mapFixture();
  invalid.proposals["proposal-1"] = {
    ...pendingProposal(invalid.revision - 1),
    changes: [{ kind: "screen.add", input: { screen: screen("home") } }],
  };
  const before = structuredClone(invalid);
  expectError("duplicate-id", () =>
    approveAppMapProposal(invalid, "proposal-1", context(invalid, "approve-invalid")),
  );
  assert.deepEqual(invalid, before);
});

test("rebases and approves independent agent proposals across unrelated edits", () => {
  const input = mapFixture();
  const changedHome = updateAppMapScreen(
    input,
    "home",
    { patch: { title: "Home feed" } },
    context(input, "rename-home"),
  );
  const submitted = submitAppMapProposal(
    changedHome,
    pendingProposal(input.revision),
    context(changedHome, "submit-rebased", changedHome.updatedAt + 1),
  );

  assert.equal(submitted.proposals["proposal-1"]?.sourceRevision, input.revision);
  assert.equal(submitted.proposals["proposal-1"]?.baseRevision, changedHome.revision);

  const changedAgain = updateAppMapScreen(
    submitted,
    "home",
    { patch: { description: "Personalized feed" } },
    context(submitted, "describe-home", submitted.updatedAt + 1),
  );
  const approved = approveAppMapProposal(
    changedAgain,
    "proposal-1",
    context(changedAgain, "approve-rebased", changedAgain.updatedAt + 1),
  );
  assert.equal(approved.screens.settings?.title, "settings");
  assert.equal(approved.proposals["proposal-1"]?.status, "approved");
});

test("rejects a stale proposal when another actor changed the same entity", () => {
  const input = mapFixture();
  const changed = updateAppMapScreen(
    input,
    "home",
    { patch: { title: "Home feed" } },
    context(input, "rename-home"),
  );
  const proposal: Proposal = {
    ...pendingProposal(input.revision),
    changes: [{ kind: "screen.update", screenId: "home", input: { patch: { title: "Start" } } }],
  };
  expectError("revision-conflict", () =>
    submitAppMapProposal(changed, proposal, context(changed, "submit-conflict")),
  );
});

test("rejects a proposal without applying its changes", () => {
  const input = mapFixture();
  input.proposals["proposal-1"] = pendingProposal(input.revision);
  const next = rejectAppMapProposal(
    input,
    "proposal-1",
    context(input, "reject-proposal"),
    "Not now",
  );

  assert.equal(next.screens.settings, undefined);
  assert.equal(next.proposals["proposal-1"]?.status, "rejected");
  assert.equal(next.proposals["proposal-1"]?.decision?.reason, "Not now");
  assert.equal(next.activity["reject-proposal"]?.eventType, "proposal.rejected");
});

test("saves and removes reusable Flows and Routines through revisioned operations", () => {
  const input = mapFixture();
  const flow = {
    ...entity("alternate"),
    name: "Alternate",
    startScreenId: "start",
    connectionIds: ["open-home"],
  };
  const withFlow = saveAppMapFlow(input, flow, context(input, "save-flow"));
  assert.equal(withFlow.flows.alternate?.name, "Alternate");
  assert.equal(withFlow.activity["save-flow"]?.eventType, "flow.saved");
  const withoutFlow = removeAppMapFlow(
    withFlow,
    "alternate",
    context(withFlow, "remove-flow", withFlow.updatedAt + 1),
  );
  assert.equal(withoutFlow.flows.alternate, undefined);

  const helper = routine("dismiss-keyboard", [{ id: "back", kind: "back" }]);
  const withRoutine = saveAppMapRoutine(
    withoutFlow,
    helper,
    context(withoutFlow, "save-routine", withoutFlow.updatedAt + 1),
  );
  assert.equal(withRoutine.routines[helper.id]?.actions[0]?.kind, "back");
  const referencedRoutine = structuredClone(withRoutine);
  referencedRoutine.flows.main!.setup = { routineId: helper.id };
  expectError("in-use", () =>
    removeAppMapRoutine(
      referencedRoutine,
      helper.id,
      context(referencedRoutine, "remove-referenced-routine", referencedRoutine.updatedAt + 1),
    ),
  );
  const withoutRoutine = removeAppMapRoutine(
    withRoutine,
    helper.id,
    context(withRoutine, "remove-routine", withRoutine.updatedAt + 1),
  );
  assert.equal(withoutRoutine.routines[helper.id], undefined);
});

test("saves reusable Case Stacks and protects referenced coverage", () => {
  const input = mapFixture();
  const stack = {
    ...entity("thinking-levels"),
    name: "Thinking levels",
    dataIds: ["thinking-level"],
    strategy: "zip" as const,
    maxCases: 10,
  };
  const withStack = saveAppMapCaseStack(input, stack, context(input, "save-stack"));
  assert.equal(withStack.caseStacks[stack.id]?.name, "Thinking levels");
  assert.equal(withStack.activity["save-stack"]?.eventType, "case-stack.saved");

  const referenced = updateAppMapConnection(
    withStack,
    "open-home",
    { caseStackId: stack.id },
    context(withStack, "attach-stack", withStack.updatedAt + 1),
  );
  expectError("in-use", () =>
    removeAppMapCaseStack(
      referenced,
      stack.id,
      context(referenced, "remove-used-stack", referenced.updatedAt + 1),
    ),
  );
  const detached = updateAppMapConnection(
    referenced,
    "open-home",
    { caseStackId: null },
    context(referenced, "detach-stack", referenced.updatedAt + 1),
  );
  const removed = removeAppMapCaseStack(
    detached,
    stack.id,
    context(detached, "remove-stack", detached.updatedAt + 1),
  );
  assert.equal(removed.caseStacks[stack.id], undefined);
});

test("creates and attaches a Case Stack in one attributable revision", () => {
  const input = mapFixture();
  const stack = {
    ...entity("thinking-levels"),
    name: "Thinking levels",
    dataIds: ["thinking-level"],
    strategy: "zip" as const,
    maxCases: 10,
  };
  const attached = attachAppMapCaseStack(
    input,
    "open-home",
    stack.id,
    stack,
    context(input, "apply-stack"),
  );

  assert.equal(attached.revision, input.revision + 1);
  assert.equal(attached.caseStacks[stack.id]?.name, "Thinking levels");
  assert.equal(attached.connections["open-home"]?.caseStackId, stack.id);
  assert.equal(attached.activity["apply-stack"]?.eventType, "case-stack.attached");
});

test("a saved Combine preserves its exact value subset and protects dependencies", () => {
  const input = mapFixture();
  const variable: AppMapVariable = {
    ...entity("language"),
    name: "Language",
    kind: "language",
    apply: { kind: "list" },
    options: [
      { id: "en", label: "English" },
      { id: "it", label: "Italiano" },
      { id: "pt", label: "Português" },
    ],
  };
  const withVariable = saveAppMapVariable(
    input,
    variable,
    context(input, "save-language", input.updatedAt + 1),
  );
  const work: AppMapTest = {
    ...entity("settings-tour", withVariable.updatedAt + 1),
    name: "Open every Settings row",
    kind: "tour",
    rootScreenId: "start",
  };
  const withTest = saveAppMapTest(
    withVariable,
    work,
    context(withVariable, "save-tour", work.updatedAt),
  );
  const combine: AppMapCombine = {
    ...entity("language-settings", withTest.updatedAt + 1),
    name: "Language × Settings",
    variableIds: [variable.id],
    testIds: [work.id],
    selected: { [variable.id]: ["en", "it"] },
    strategy: "zip",
  };
  const saved = saveAppMapCombine(
    withTest,
    combine,
    context(withTest, "save-combine", combine.updatedAt),
  );

  assert.deepEqual(saved.combines[combine.id]?.selected, { language: ["en", "it"] });
  expectError("missing-reference", () =>
    removeAppMapVariable(saved, variable.id, context(saved, "remove-used-variable")),
  );
  expectError("missing-reference", () =>
    removeAppMapTest(saved, work.id, context(saved, "remove-used-test")),
  );
  expectError("missing-reference", () =>
    saveAppMapCombine(
      withTest,
      { ...combine, selected: { language: ["missing"] } },
      context(withTest, "save-bad-combine", combine.updatedAt),
    ),
  );
});

test("updates App Map metadata and stores finite collaborative screen positions", () => {
  const input = mapFixture();
  const renamed = updateAppMap(
    input,
    { name: "Storefront", description: "The complete customer storefront" },
    context(input, "rename-map"),
  );
  const positioned = updateAppMapScreen(
    renamed,
    "start",
    { patch: { position: { x: 128, y: -64 } } },
    context(renamed, "move-screen", renamed.updatedAt + 1),
  );

  assert.equal(renamed.name, "Storefront");
  assert.equal(renamed.description, "The complete customer storefront");
  assert.equal(renamed.activity["rename-map"]?.eventType, "app-map.updated");
  assert.deepEqual(positioned.screens.start?.position, { x: 128, y: -64 });
  expectError("invalid-map", () =>
    updateAppMapScreen(
      positioned,
      "start",
      { patch: { position: { x: Number.NaN, y: 0 } } },
      context(positioned, "bad-position", positioned.updatedAt + 1),
    ),
  );
  const cleared = updateAppMap(
    positioned,
    { description: null },
    context(positioned, "clear-description", positioned.updatedAt + 1),
  );
  assert.equal(cleared.description, undefined);
});

test("submits agent work as an attributable pending proposal", () => {
  const input = mapFixture();
  const proposal = pendingProposal(input.revision);
  const next = submitAppMapProposal(input, proposal, {
    ...context(input, "submit-proposal"),
    actorId: "agent:explorer",
    actorKind: "agent",
  });

  assert.equal(next.proposals[proposal.id]?.status, "pending");
  assert.equal(next.screens.settings, undefined);
  assert.equal(next.activity["submit-proposal"]?.actorId, "agent:explorer");
  assert.equal(next.activity["submit-proposal"]?.eventType, "proposal.submitted");
});

test("serializes a deterministic YAML-ready plain object without sharing references", () => {
  const first = mapFixture();
  const second = mapFixture();
  first.screens.home!.identity!.aliases = ["c".repeat(64), "b".repeat(64)];
  second.screens.home!.identity!.aliases = ["b".repeat(64), "c".repeat(64)];
  first.screenVariants["variant-home"]!.evidenceIds = ["evidence-z", "evidence-a"];
  second.screenVariants["variant-home"]!.evidenceIds = ["evidence-a", "evidence-z"];
  first.screenVariants["variant-home"]!.evidenceUris = [
    "relay-evidence://captures/z",
    "relay-evidence://captures/a",
  ];
  second.screenVariants["variant-home"]!.evidenceUris = [
    "relay-evidence://captures/a",
    "relay-evidence://captures/z",
  ];
  first.screenVariants["variant-home"]!.targetProfile.capabilities = ["tap", "screenshot"];
  second.screenVariants["variant-home"]!.targetProfile.capabilities = ["screenshot", "tap"];
  const firstRecorded = first.connections["open-home"]!.actions[0];
  const secondRecorded = second.connections["open-home"]!.actions[0];
  assert.ok(firstRecorded?.kind === "recorded" && secondRecorded?.kind === "recorded");
  firstRecorded.evidenceIds = ["evidence-z", "evidence-a"];
  secondRecorded.evidenceIds = ["evidence-a", "evidence-z"];
  second.screens = { home: second.screens.home!, start: second.screens.start! };
  second.screenVariants = {
    "variant-home": second.screenVariants["variant-home"]!,
    "variant-start": second.screenVariants["variant-start"]!,
  };
  second.connections = { "open-home": second.connections["open-home"]! };
  second.screens.home!.variantIds.reverse();

  const serialized = serializeAppMap(first);
  assert.deepEqual(serialized, serializeAppMap(second));
  assert.ok(Array.isArray(serialized.screens));
  assert.deepEqual(
    serialized.screens.map((item) => item.id),
    ["home", "start"],
  );
  assert.deepEqual(
    serialized.screenVariants.map((item) => item.id),
    ["variant-home", "variant-start"],
  );
  assert.equal(Object.getPrototypeOf(serialized), Object.prototype);
  serialized.screens[0]!.title = "Changed output";
  assert.equal(first.screens.home!.title, "Home");
  assert.doesNotThrow(() => JSON.stringify(serialized));
});
