import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppMap, RecipeStep } from "@relay/protocol";
import { appMapCombineCellId } from "./app-map-combine-cell.js";
import { preflightAppMapCombine } from "./app-map-combine-preflight.js";
import { persistAuthoringEvidence } from "./authoring-evidence.js";
import { resetControlDatabaseCache, writeProjectVariables } from "./collaboration.js";
import { observeScreenIdentity } from "./screen-identity.js";
import type { SnapshotNode } from "./device.js";

const label = "Quick responses · Grok 4.7";
const target = { targetId: "ipad-fixture", platform: "ios" as const };
const currentProfile = "saved-ipad-landscape";
const otherProfile = "saved-ipad-portrait";
const values = ["Explain paper airplanes", "Explain ocean tides"];

function nodes(includeSelector: boolean, width = 1112, height = 834): SnapshotNode[] {
  return [
    {
      index: 0,
      type: "Application",
      label: "Grok",
      rect: { x: 0, y: 0, width, height },
      logicalCoordinates: true,
    },
    {
      index: 1,
      parentIndex: 0,
      type: "Button",
      identifier: "toolbar.model.selector.button",
      label: "Auto",
      enabled: true,
      hittable: true,
      visibleToUser: true,
      rect: { x: 600, y: 30, width: 120, height: 44 },
      logicalCoordinates: true,
    },
    ...(includeSelector
      ? [
          {
            index: 2,
            parentIndex: 0,
            type: "Button",
            label,
            enabled: true,
            hittable: true,
            visibleToUser: true,
            rect: { x: 600, y: 130, width: 220, height: 54 },
            logicalCoordinates: true,
          },
        ]
      : []),
  ];
}

async function fixture(includeCurrentSelector = false, includeOtherSelector = true) {
  const scope = {
    organizationId: "local",
    projectId: "plan-offline-fixture",
    appMapId: "grok-ios",
  };
  const entity = (id: string) => ({ ...scope, id, createdAt: 1, updatedAt: 1 });
  const variant = async (
    id: string,
    profileId: string,
    includeSelector: boolean,
    width: number,
    height: number,
  ) => {
    const raw = nodes(includeSelector, width, height);
    const observation = observeScreenIdentity(raw);
    const tree = await persistAuthoringEvidence({
      kind: "snapshot",
      capturedAt: 1,
      data: JSON.stringify({ nodes: raw }),
      mime: "application/json",
    });
    return {
      ...entity(id),
      screenId: "home",
      targetProfile: {
        id: profileId,
        ...target,
        source: "device" as const,
        name: "iPad",
        model: "Physical device",
        osVersion: "17.7.11",
        viewport: { width, height },
        capabilities: ["screenshot" as const, "snapshot" as const],
        observedAt: 1,
      },
      observation,
      evidenceIds: [tree.id],
      evidenceUris: [tree.uri],
      rawAccessibilityTree: {
        id: tree.id,
        uri: tree.uri,
        sha256: tree.sha256!,
        mime: "application/json" as const,
        bytes: tree.bytes!,
        observationId: `${id}-observation`,
        capturedAt: 1,
      },
    };
  };
  await writeProjectVariables(scope.projectId, {
    expectedRevision: 0,
    value: [
      { id: "public-chat-prompts", name: "chat_prompt", scope: "shared", source: "list", values },
    ],
  });
  const current = await variant("home-current", currentProfile, includeCurrentSelector, 1112, 834);
  const other = await variant("home-other", otherProfile, includeOtherSelector, 834, 1112);
  const map: AppMap = {
    schemaVersion: 1,
    id: scope.appMapId,
    name: "Grok iPad",
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    revision: 399,
    createdAt: 1,
    updatedAt: 1,
    screens: {
      home: {
        ...entity("home"),
        title: "Grok home",
        identity: { schemaVersion: 1, fingerprint: current.observation.fingerprint },
        variantIds: [current.id, other.id],
      },
    },
    screenVariants: { [current.id]: current, [other.id]: other },
    connections: {
      fast: {
        ...entity("fast"),
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "home" },
        state: "ready",
        actions: [
          {
            id: "choose-fast",
            kind: "steps",
            steps: [
              { id: "tap-fast", kind: "tap", target: { label } },
              { id: "type-prompt", kind: "type", text: "{{chat_prompt}}" },
            ],
          },
        ],
      },
    },
    tests: {
      fast: {
        ...entity("fast"),
        name: "Fast completed response",
        kind: "scenario",
        intentSchemaVersion: 1,
        capture: { mode: "none" },
        steps: [
          {
            id: "choose-fast",
            kind: "instruction",
            intent: "Choose Fast",
            binding: { status: "resolved", kind: "connections", connectionIds: ["fast"] },
          },
        ],
      },
    },
    variables: {
      prompts: {
        ...entity("prompts"),
        name: "Chat prompts",
        kind: "custom",
        apply: { kind: "input", inputId: "public-chat-prompts" },
        options: values.map((value, index) => ({ id: `value-${index + 1}`, value })),
      },
    },
    combines: {
      checks: {
        ...entity("checks"),
        name: "iPad prompt checks",
        variableIds: ["prompts"],
        testIds: ["fast"],
        strategy: "zip",
        selected: { prompts: ["value-1", "value-2"] },
        cellRuntimeProfiles: ["value-1", "value-2"].map((value) => ({
          testId: "fast",
          values: { prompts: value },
          targetProfileId: currentProfile,
        })),
      },
    },
    notes: {},
    groups: {},
    caseStacks: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
  };
  return { map, combine: map.combines.checks! };
}

async function isolated(work: () => Promise<void>) {
  const state = await mkdtemp(join(tmpdir(), "relay-plan-cell-readiness-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = state;
  resetControlDatabaseCache();
  try {
    await work();
  } finally {
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(state, { recursive: true, force: true });
  }
}

test("two bound public prompt cases remain blocked when only another profile captured the Fast selector", async () =>
  isolated(async () => {
    const { map, combine } = await fixture();
    const before = JSON.stringify(map);
    const preflight = await preflightAppMapCombine(map, combine, {
      target,
      defaultTargetProfileId: currentProfile,
    });
    assert.equal(preflight.ok, false);
    assert.equal(preflight.checks, 2);
    assert.equal(preflight.blockers.length, 2);
    assert.deepEqual(
      new Set(preflight.blockers.map((issue) => issue.cellId)),
      new Set(
        ["value-1", "value-2"].map((value) => appMapCombineCellId("fast", { prompts: value })),
      ),
    );
    for (const issue of preflight.blockers) {
      assert.equal(issue.code, "invalid-test");
      assert.equal(issue.testId, "fast");
      assert.equal(issue.targetProfileId, currentProfile);
      assert.match(issue.message, /Choose Fast/);
      assert.ok(issue.message.includes(label));
      assert.doesNotMatch(issue.message, /relay-evidence:\/\/|[a-f0-9]{64}/u);
    }
    assert.ok(
      preflight.cells.every((cell) => cell.binding === "bound" && cell.preflight === "blocked"),
    );
    assert.equal(
      JSON.stringify(map),
      before,
      "preflight does not rewrite the Plan or its evidence",
    );
  }));

test("real current-profile raw evidence makes both saved cases ready without replacing their IDs", async () =>
  isolated(async () => {
    const { map, combine } = await fixture(true);
    const preflight = await preflightAppMapCombine(map, combine, {
      target,
      defaultTargetProfileId: currentProfile,
    });
    assert.equal(preflight.ok, true, JSON.stringify(preflight.blockers));
    assert.equal(preflight.checks, 2);
    assert.ok(
      preflight.cells.every((cell) => cell.binding === "bound" && cell.preflight === "ready"),
    );
    assert.deepEqual(
      preflight.cells.map((cell) => cell.values.prompts),
      ["value-1", "value-2"],
    );
  }));

test("each authored case keeps its own saved profile when no requested column overrides it", async () =>
  isolated(async () => {
    const { map, combine } = await fixture();
    combine.cellRuntimeProfiles![1]!.targetProfileId = otherProfile;
    const preflight = await preflightAppMapCombine(map, combine);
    assert.equal(preflight.ok, false);
    assert.equal(preflight.blockers.length, 1);
    assert.equal(preflight.blockers[0]?.values?.prompts, "value-1");
    assert.equal(preflight.blockers[0]?.targetProfileId, currentProfile);
    assert.equal(
      preflight.cells.find((cell) => cell.values.prompts === "value-1")?.preflight,
      "blocked",
    );
    assert.equal(
      preflight.cells.find((cell) => cell.values.prompts === "value-2")?.preflight,
      "ready",
    );
  }));

test("pilot selection checks only its exact case and rejects an unknown case", async () =>
  isolated(async () => {
    const { map, combine } = await fixture(true, false);
    combine.cellRuntimeProfiles![1]!.targetProfileId = otherProfile;
    const selectedCellIds = [appMapCombineCellId("fast", { prompts: "value-1" })];
    const pilot = await preflightAppMapCombine(map, combine, { selectedCellIds });
    assert.equal(pilot.ok, true, JSON.stringify(pilot.blockers));
    assert.equal(pilot.cells.find((cell) => cell.values.prompts === "value-1")?.preflight, "ready");
    assert.equal(
      pilot.cells.find((cell) => cell.values.prompts === "value-2")?.preflight,
      undefined,
    );
    const unknown = await preflightAppMapCombine(map, combine, { selectedCellIds: ["not-a-case"] });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.blockers.filter((issue) => issue.code === "foreign-binding").length, 1);
    const blank = await preflightAppMapCombine(map, combine, { selectedCellIds: [" "] });
    assert.equal(blank.ok, false, "a malformed pilot selection must not expand to every case");
    assert.ok(blank.blockers.some((issue) => issue.code === "foreign-binding"));
  }));

test("a pilot retains basic saved-profile validity for unrequested cases", async () =>
  isolated(async () => {
    const { map, combine } = await fixture(true);
    combine.cellRuntimeProfiles![1]!.targetProfileId = "missing-old-profile";
    const selectedCellIds = [appMapCombineCellId("fast", { prompts: "value-1" })];
    const preflight = await preflightAppMapCombine(map, combine, { selectedCellIds });
    assert.equal(preflight.ok, false);
    assert.equal(preflight.blockers.length, 1, JSON.stringify(preflight.blockers));
    assert.equal(preflight.blockers[0]?.code, "mismatched-binding");
    assert.equal(preflight.blockers[0]?.values?.prompts, "value-2");
    assert.equal(preflight.blockers[0]?.targetProfileId, "missing-old-profile");
    assert.equal(
      preflight.cells.find((cell) => cell.values.prompts === "value-1")?.preflight,
      "ready",
    );
    assert.equal(
      preflight.cells.find((cell) => cell.values.prompts === "value-2")?.preflight,
      "blocked",
    );
  }));

test("requested profile columns use exact saved identity and deduplicate repeated evidence findings", async () =>
  isolated(async () => {
    const { map, combine } = await fixture();
    const column = {
      profileId: "iPad",
      targetProfileId: currentProfile,
      target: { serial: target.targetId, platform: "ios" as const, targetKind: "device" as const },
    };
    const preflight = await preflightAppMapCombine(map, combine, {
      profileTargets: [column, column],
    });
    assert.equal(preflight.ok, false);
    assert.equal(preflight.blockers.length, 2);
    const mismatch = await preflightAppMapCombine(map, combine, {
      profileTargets: [{ ...column, target: { ...column.target, serial: "another-ipad" } }],
    });
    assert.equal(mismatch.ok, false);
    assert.ok(mismatch.blockers.some((issue) => issue.code === "mismatched-binding"));
  }));

test("warning-only recorded coordinates do not become offline blockers", async () =>
  isolated(async () => {
    const { map, combine } = await fixture(true);
    const action = map.connections.fast!.actions[0]!;
    assert.equal(action.kind, "steps");
    if (action.kind !== "steps") throw new Error("Expected authored steps");
    action.steps = [
      {
        id: "tap-coordinate",
        kind: "tap",
        target: { point: { x: 650, y: 150 } },
      } satisfies RecipeStep,
    ];
    const preflight = await preflightAppMapCombine(map, combine, {
      target,
      defaultTargetProfileId: currentProfile,
    });
    assert.equal(preflight.ok, true, JSON.stringify(preflight.blockers));
    assert.equal(preflight.warnings.filter((issue) => issue.code === "invalid-test").length, 2);
    assert.ok(preflight.cells.every((cell) => cell.preflight === "ready"));
  }));

test("conflicting saved profile identities cannot inherit another cell's successful proof", async () =>
  isolated(async () => {
    const { map, combine } = await fixture(true);
    const other = map.screenVariants["home-other"]!;
    assert(other.observation);
    other.targetProfile.id = currentProfile;
    other.screenId = "other";
    map.screens.home!.variantIds = ["home-current"];
    map.screens.other = {
      ...map.screens.home!,
      id: "other",
      title: "Other screen",
      identity: { schemaVersion: 1, fingerprint: other.observation.fingerprint },
      variantIds: [other.id],
    };
    const preflight = await preflightAppMapCombine(map, combine, {
      target,
      defaultTargetProfileId: currentProfile,
    });
    assert.equal(preflight.ok, false);
    assert.equal(preflight.blockers.length, 2, JSON.stringify(preflight.blockers));
    assert.ok(preflight.blockers.every((issue) => issue.code === "mismatched-binding"));
    assert.ok(preflight.cells.every((cell) => cell.preflight === "blocked"));
  }));
