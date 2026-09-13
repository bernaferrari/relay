import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest, Connection, Screen } from "@relay/protocol";
import { compileAppMapTest } from "./map-work.js";
import {
  leftoverConversationHomePrelude,
  leftoverWarmConfirmationSteps,
  sourceProofAfterLeftoverWarm,
  waitForIsIndependentlySourceProven,
} from "./leftover-origin-recovery.js";

const at = 1;
const scope = { organizationId: "org", projectId: "project", appMapId: "grok" };
const homeFingerprint = "a".repeat(64);
const conversationFingerprint = "c".repeat(64);
const loggedOutFingerprint = "d".repeat(64);

function screen(id: string, title: string, fingerprint: string): Screen {
  return {
    ...scope,
    id,
    title,
    identity: { schemaVersion: 1, fingerprint },
    variantIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

function connection(
  input: Omit<Connection, keyof typeof scope | "createdAt" | "updatedAt">,
): Connection {
  return { ...scope, ...input, createdAt: at, updatedAt: at };
}

function mapWith(connections: Record<string, Connection>): AppMap {
  return {
    schemaVersion: 1,
    id: "grok",
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    name: "Grok",
    revision: 1,
    notes: {},
    groups: {},
    screens: {
      home: screen("home", "Signed-in home", homeFingerprint),
      conversation: screen("conversation", "Signed-in conversation", conversationFingerprint),
      "logged-out": screen("logged-out", "Logged-out home", loggedOutFingerprint),
    },
    screenVariants: {},
    connections,
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
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

const openConversation = connection({
  id: "open-conversation",
  fromScreenId: "home",
  destination: { kind: "screen", screenId: "conversation" },
  label: "Open conversation",
  state: "ready",
  actions: [
    {
      id: "open",
      kind: "steps",
      steps: [
        { kind: "wait-for", target: { label: "Library" }, timeoutMs: 5_000 },
        { kind: "tap", target: { label: "Older chat" } },
      ],
    },
  ],
});

const newChat = connection({
  id: "new-chat",
  fromScreenId: "home",
  destination: { kind: "end" },
  label: "New Chat",
  state: "ready",
  actions: [
    {
      id: "reset",
      kind: "steps",
      steps: [
        { kind: "wait-for", target: { label: "Library" }, timeoutMs: 5_000 },
        { kind: "tap", target: { identifier: "new-chat", label: "Chat" } },
      ],
    },
  ],
});

const signOut = connection({
  id: "sign-out",
  fromScreenId: "home",
  destination: { kind: "screen", screenId: "logged-out" },
  label: "Sign Out",
  state: "ready",
  actions: [{ id: "tap-sign-out", kind: "tap", target: { label: "Sign Out" } }],
});

test("source proof skips leftover New Chat before wait-for", () => {
  const waitFor = { kind: "wait-for" as const, target: { label: "Library" }, timeoutMs: 5_000 };
  assert.equal(
    sourceProofAfterLeftoverWarm([
      { kind: "tap", target: { identifier: "new-chat", label: "Chat" } },
      waitFor,
    ]),
    waitFor,
  );
  assert.equal(sourceProofAfterLeftoverWarm([waitFor]), waitFor);
});

test("wait-for is independently source-proven for dest-screen leftover", () => {
  assert.equal(
    waitForIsIndependentlySourceProven({
      kind: "wait-for",
      target: { label: "Library" },
      timeoutMs: 5_000,
    }),
    true,
  );
  assert.equal(
    waitForIsIndependentlySourceProven({
      kind: "expect-screen",
      screenId: "home",
      screenTitle: "Home",
      fingerprint: homeFingerprint,
    }),
    false,
  );
});

test("leftover conversation recovers home through recorded New Chat", () => {
  const prelude = leftoverConversationHomePrelude(
    mapWith({ "open-conversation": openConversation, "new-chat": newChat }),
    "home",
  );
  assert.ok(prelude);
  assert.equal(prelude.preludeStartFingerprint, conversationFingerprint);
  assert.deepEqual(prelude.preludeSteps, [
    { kind: "tap", target: { identifier: "new-chat", label: "Chat" } },
  ]);
});

test("Sign Out dest-screen is not a leftover conversation cursor", () => {
  assert.equal(
    leftoverConversationHomePrelude(mapWith({ "sign-out": signOut, "new-chat": newChat }), "home"),
    undefined,
  );
  const waitThenSignOut = connection({
    ...signOut,
    id: "sign-out-wait",
    actions: [
      {
        id: "leave",
        kind: "steps",
        steps: [
          { kind: "wait-for", target: { label: "Library" }, timeoutMs: 5_000 },
          { kind: "tap", target: { label: "Sign Out" } },
        ],
      },
    ],
  });
  assert.equal(
    leftoverConversationHomePrelude(
      mapWith({ "sign-out-wait": waitThenSignOut, "new-chat": newChat }),
      "home",
    ),
    undefined,
  );
});

test("Sign Out wait-for dest-screen does not steal leftover conversation prelude", () => {
  const waitThenSignOut = connection({
    ...signOut,
    id: "sign-out-wait",
    actions: [
      {
        id: "leave",
        kind: "steps",
        steps: [
          { kind: "wait-for", target: { label: "Library" }, timeoutMs: 5_000 },
          { kind: "tap", target: { label: "Sign Out" } },
        ],
      },
    ],
  });
  const prelude = leftoverConversationHomePrelude(
    mapWith({
      "sign-out-wait": waitThenSignOut,
      "open-conversation": openConversation,
      "new-chat": newChat,
    }),
    "home",
  );
  assert.ok(prelude);
  assert.equal(prelude.preludeStartFingerprint, conversationFingerprint);
  assert.equal(prelude.preludeStartAliases, undefined);
});

test("leftover dest-screen without New Chat does not invent a prelude", () => {
  assert.equal(
    leftoverConversationHomePrelude(mapWith({ "open-conversation": openConversation }), "home"),
    undefined,
  );
});

test("a home-starting Test compiles leftover New Chat prelude", () => {
  const map = mapWith({ "open-conversation": openConversation, "new-chat": newChat });
  const work: AppMapScenarioTest = {
    ...scope,
    id: "signed-in-home",
    name: "Open home",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "on-home",
        kind: "validation",
        intent: "On signed-in home",
        binding: {
          status: "resolved",
          kind: "assertion",
          assertion: { kind: "screen", screenId: "home" },
        },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
  const compiled = compileAppMapTest(map, work);
  const first = compiled.root.steps[0];
  assert.equal(first?.kind, "expect-screen");
  assert.equal(first.kind === "expect-screen" ? first.screenId : undefined, "home");
  assert.ok(first && "preludeSteps" in first);
  assert.deepEqual(first.preludeSteps, [
    { kind: "tap", target: { identifier: "new-chat", label: "Chat" } },
  ]);
  assert.equal(
    first && "preludeStartFingerprint" in first ? first.preludeStartFingerprint : undefined,
    conversationFingerprint,
  );
});

test("Android new_conversation dest-end is leftover New Chat", () => {
  const androidNewChat = connection({
    id: "connection-grok-android-new-chat",
    fromScreenId: "home",
    destination: { kind: "end" },
    label: "New conversation",
    state: "ready",
    actions: [
      {
        id: "reset",
        kind: "steps",
        steps: [
          { kind: "wait-for", target: { label: "Ask" }, timeoutMs: 5_000 },
          { kind: "tap", target: { identifier: "new_conversation_button" } },
        ],
      },
    ],
  });
  const prelude = leftoverConversationHomePrelude(
    mapWith({
      "open-conversation": openConversation,
      "connection-grok-android-new-chat": androidNewChat,
    }),
    "home",
  );
  assert.ok(prelude);
  assert.deepEqual(prelude.preludeSteps, [
    { kind: "tap", target: { identifier: "new_conversation_button" } },
  ]);
});

test("home inbound prefers sidebar New conversation over Imagine Ask", () => {
  const imagine = screen("imagine", "Imagine", "b".repeat(64));
  const sidebar = screen("sidebar", "Grok sidebar", conversationFingerprint);
  const askInbound = connection({
    id: "open-ask",
    fromScreenId: "imagine",
    destination: { kind: "screen", screenId: "home" },
    label: "Ask",
    state: "ready",
    actions: [{ id: "tap-ask", kind: "tap", target: { label: "Ask" } }],
  });
  const newConversationInbound = connection({
    id: "open-new-conversation",
    fromScreenId: "sidebar",
    destination: { kind: "screen", screenId: "home" },
    label: "New conversation",
    state: "ready",
    actions: [{ id: "tap-new", kind: "tap", target: { identifier: "new_conversation_button" } }],
  });
  const map = {
    ...mapWith({ "open-ask": askInbound, "open-new-conversation": newConversationInbound }),
    screens: {
      home: screen("home", "Signed-in home", homeFingerprint),
      imagine,
      sidebar,
    },
  };
  const work: AppMapScenarioTest = {
    ...scope,
    id: "signed-in-home",
    name: "Open home",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "on-home",
        kind: "validation",
        intent: "On signed-in home",
        binding: {
          status: "resolved",
          kind: "assertion",
          assertion: { kind: "screen", screenId: "home" },
        },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
  const compiled = compileAppMapTest(map, work);
  const first = compiled.root.steps[0];
  assert.ok(first && "preludeSteps" in first);
  assert.deepEqual(first.preludeSteps, [
    { kind: "tap", target: { identifier: "new_conversation_button" } },
  ]);
  assert.equal(
    first && "preludeStartFingerprint" in first ? first.preludeStartFingerprint : undefined,
    conversationFingerprint,
  );
});

test("warm confirmation does not prepend leftover New Chat", () => {
  const map = mapWith({ "open-conversation": openConversation, "new-chat": newChat });
  assert.deepEqual(leftoverWarmConfirmationSteps(map, "home"), []);
  const work: AppMapScenarioTest = {
    ...scope,
    id: "open-from-home",
    name: "Open conversation",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "on-home",
        kind: "validation",
        intent: "On signed-in home",
        binding: {
          status: "resolved",
          kind: "assertion",
          assertion: { kind: "screen", screenId: "home" },
        },
      },
      {
        id: "open",
        kind: "instruction",
        intent: "Open existing sidebar conversation",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["open-conversation"],
        },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
  const compiled = compileAppMapTest(map, work);
  const confirm = Object.values(compiled.graph).find((recipe) =>
    recipe.title.includes("warm transition confirmation"),
  );
  assert.ok(confirm);
  assert.equal(confirm.steps[0]?.kind, "wait-for");
  assert.equal(
    confirm.steps.some((step) => step.kind === "tap" && step.target.identifier === "new-chat"),
    false,
  );
});
