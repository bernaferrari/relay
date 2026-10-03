import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import { summarizeTestDiscovery } from "./test-discovery.js";

function fixture(): AppMap {
  const scenario = (id: string, name = id): AppMapScenarioTest => ({
    id,
    name,
    kind: "scenario",
    intentSchemaVersion: 1,
    organizationId: "local",
    projectId: "project",
    appMapId: "grok",
    createdAt: 1,
    updatedAt: 1,
    steps: [
      {
        id: `${id}-step`,
        kind: "instruction",
        intent: "Open settings",
        binding: { status: "resolved", kind: "connections", connectionIds: ["open"] },
      },
    ],
  });
  return {
    id: "grok",
    name: "Grok",
    revision: 2,
    tests: {
      recorded: scenario("recorded", "Grok · Expert"),
      draft: scenario("draft", "UNRECORDED — Heavy"),
      unbound: {
        ...scenario("unbound"),
        steps: [
          {
            id: "unbound-step",
            kind: "instruction",
            intent: "Submit",
            binding: { status: "unresolved", reason: "Record this action" },
          },
        ],
      },
    },
    screens: { home: { id: "home", title: "Home", variantIds: ["home-android"] } },
    screenVariants: {
      "home-android": {
        id: "home-android",
        screenId: "home",
        evidenceIds: [],
        targetProfile: {
          id: "phone",
          targetId: "phone",
          name: "Phone",
          platform: "android",
          source: "device",
          capabilities: [],
          observedAt: 1,
        },
        observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
      },
    },
    connections: {
      open: {
        id: "open",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "home" },
        actions: [{ id: "tap", kind: "tap", target: { label: "Settings" } }],
      },
    },
  } as unknown as AppMap;
}

function summary(map: AppMap) {
  return {
    tests: Object.values(map.tests).map((entry) => ({
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      stepCount: entry.kind === "scenario" ? entry.steps.length : 0,
    })),
  };
}

test("Test discovery distinguishes recorded native routes, explicit drafts and unbound actions without claiming live readiness", () => {
  const map = fixture();
  const before = structuredClone(map);
  const original = summary(map);
  const result = summarizeTestDiscovery("app-map.get", { appMap: map }, original, "test list") as {
    tests: Array<
      (typeof original.tests)[number] & {
        discovery: { status: string; platforms: Record<string, string> };
      }
    >;
  };
  const recorded = result.tests.find((entry) => entry.id === "recorded")!;
  assert.equal(recorded.discovery.status, "recorded");
  assert.equal(recorded.discovery.platforms.android, "reviewed");
  assert.equal(recorded.discovery.platforms.browser, "unrecorded");
  assert.equal(
    result.tests.find((entry) => entry.id === "draft")!.discovery.status,
    "needs-recording",
  );
  assert.equal(
    result.tests.find((entry) => entry.id === "unbound")!.discovery.status,
    "needs-binding",
  );
  assert.deepEqual(map, before);
  for (const entry of original.tests)
    assert.deepEqual(
      Object.fromEntries(
        Object.keys(entry).map((key) => [
          key,
          result.tests.find((item) => item.id === entry.id)![key as keyof typeof entry],
        ]),
      ),
      entry,
    );
  assert.equal(JSON.stringify(result).includes('"ready"'), false);
});

test("missing capture evidence prevents a recorded route from being offered as recorded", () => {
  const map = fixture();
  delete map.screenVariants["home-android"]!.observation;
  const result = summarizeTestDiscovery(
    "app-map.get",
    { appMap: map },
    summary(map),
    "test list",
  ) as {
    tests: Array<{ id: string; discovery: { status: string; reason: string } }>;
  };
  const entry = result.tests.find((entry) => entry.id === "recorded")!;
  assert.equal(entry.discovery.status, "needs-evidence");
  assert.match(entry.discovery.reason, /Home/);
});

test("other operation paths and existing machine summaries remain untouched", () => {
  const map = fixture();
  const result = summary(map);
  assert.equal(summarizeTestDiscovery("app-map.get", { appMap: map }, result, "map get"), result);
  assert.equal(
    summarizeTestDiscovery("app-map.list", { appMaps: [map] }, result, "test list"),
    result,
  );
  assert.equal(summarizeTestDiscovery("app-map.get", {}, result, "test list"), result);
});

test("native browser-only steps expose the canonical platform blocker", () => {
  const map = fixture();
  map.connections.open!.actions = [
    { id: "offline", kind: "steps", steps: [{ kind: "offline", state: "on" }] },
  ];
  const result = summarizeTestDiscovery(
    "app-map.get",
    { appMap: map },
    summary(map),
    "test list",
  ) as {
    tests: Array<{
      id: string;
      discovery: {
        status: string;
        platforms: Record<string, string>;
        platformBlockers: Record<string, string>;
      };
    }>;
  };
  const recorded = result.tests.find((entry) => entry.id === "recorded")!;
  assert.equal(recorded.discovery.status, "blocked");
  assert.equal(recorded.discovery.platforms.android, "blocked");
  assert.equal(recorded.discovery.platformBlockers.android, "offline is a browser step");
});

test("linked native intent names its recorded Test without treating the local route as recorded", () => {
  const map = fixture();
  const linked = map.tests.recorded! as AppMapScenarioTest;
  linked.steps = [];
  linked.nativeRouteCompanions = [
    { platform: "android", appMapId: "native", testId: "native-expert" },
  ];
  const result = summarizeTestDiscovery(
    "app-map.get",
    { appMap: map },
    summary(map),
    "test list",
  ) as {
    tests: Array<{
      id: string;
      discovery: {
        status: string;
        platforms: Record<string, string>;
        linkedTests: Array<{ platform: string; appMapId: string; testId: string }>;
      };
    }>;
  };
  const recorded = result.tests.find((entry) => entry.id === "recorded")!;
  assert.equal(recorded.discovery.status, "needs-recording");
  assert.equal(recorded.discovery.platforms.android, "linked");
  assert.deepEqual(recorded.discovery.linkedTests, [
    { platform: "android", appMapId: "native", testId: "native-expert" },
  ]);
});
