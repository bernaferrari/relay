import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import { appMapCombineCellId } from "./app-map-combine-cell.js";
import {
  AppMapCombineCellContractError,
  prepareAppMapCombineCells,
} from "./app-map-combine-cell-prepare.js";
import { AppMapTargetProfileError } from "./app-map-native-companion-compile.js";
import { AppMapCombineWorldError } from "./app-map-combine-from-test.js";
import { localExecutionTargetRef } from "./app-map-combine-cell-target-binding.js";
import {
  bindPreparedCombineCellInputs,
  combineCellRuntimeInputValues,
} from "./app-map-combine-cell-inputs.js";
import { freezeRecipeInputs } from "./frozen-recipe-inputs.js";
import { persistAuthoringEvidence } from "./authoring-evidence.js";

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
  try {
    await work();
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(state, { recursive: true, force: true });
  }
}

const caseId = (row: string) => appMapCombineCellId("fast", { prompts: row });

function bindDifferentProfiles(combine: AppMap["combines"][string]) {
  combine.cellRuntimeProfiles![1]!.targetProfileId = otherProfile;
}

const offlineBlocked = (error: unknown) =>
  error instanceof AppMapCombineCellContractError &&
  error.issues.some((issue) => issue.code === "compile-failed");
const invalidProfile = (error: unknown) =>
  error instanceof AppMapTargetProfileError ||
  (error instanceof AppMapCombineCellContractError &&
    error.issues.some((issue) => issue.code === "mismatched-binding"));

test("an explicit pilot prepares only its proven case while preserving all-cell profile validation", async () =>
  isolated(async () => {
    const { map, combine } = await fixture(true, false);
    bindDifferentProfiles(combine);
    const before = JSON.stringify(map);
    const prepared = await prepareAppMapCombineCells({
      map,
      combine,
      target,
      selectedCellIds: [caseId("value-1")],
    });
    assert.deepEqual(
      prepared.cells.map((cell) => cell.cellId),
      [caseId("value-1")],
    );
    assert.deepEqual(prepared.selectedCells, prepared.cells);
    assert.equal(prepared.matrix.cases.length, 2);
    assert.equal(prepared.cellStates.length, 2);
    assert.equal(prepared.cellStates[0]?.preflight, "ready");
    assert.equal(prepared.cellStates[1]?.binding, "bound");
    assert.equal(
      prepared.cellStates[1]?.preflight,
      undefined,
      "unselected proof has not been assessed",
    );
    assert.equal(prepared.cellStates[1]?.targetProfileId, otherProfile);
    const cell = prepared.cells[0]!;
    assert.equal(cell.worldIndex, 0);
    assert.equal(cell.targetProfileId, currentProfile);
    assert.equal(cell.childIntent.selectedRuntimeTargetProfile?.id, currentProfile);
    assert.equal(cell.outerIntent.selectedRuntimeTargetProfile.id, currentProfile);
    assert.equal(cell.childIntent.preflight.summary.blockers, 0);
    assert.equal(
      JSON.stringify(map),
      before,
      "preparation must not repair or rebind the saved Plan",
    );
  }));

test("choosing the unproven case or the default full Plan fails exact offline proof", async () =>
  isolated(async () => {
    const { map, combine } = await fixture(true, false);
    bindDifferentProfiles(combine);
    for (const selectedCellIds of [[caseId("value-2")], undefined, []]) {
      await assert.rejects(
        prepareAppMapCombineCells({ map, combine, target, selectedCellIds }),
        offlineBlocked,
      );
    }
  }));

test("an unselected missing CAS is not loaded or borrowed from the selected profile", async () =>
  isolated(async () => {
    const { map, combine } = await fixture(true, true);
    bindDifferentProfiles(combine);
    // A selected Test still requires integrity of every source frozen into its
    // own plan. This missing source belongs to an unselected companion plan.
    const companion = structuredClone(map);
    companion.id = "grok-ios-companion";
    for (const entities of [
      companion.screens,
      companion.screenVariants,
      companion.connections,
      companion.tests,
      companion.variables,
      companion.combines,
    ]) {
      for (const entity of Object.values(entities)) entity.appMapId = companion.id;
    }
    companion.screenVariants = { "home-other": companion.screenVariants["home-other"]! };
    companion.screens.home!.variantIds = ["home-other"];
    delete map.screenVariants["home-other"];
    map.screens.home!.variantIds = ["home-current"];
    map.tests.fast!.nativeRouteCompanions = [
      { platform: "ios", appMapId: companion.id, testId: "fast" },
    ];
    const source = companion.screenVariants["home-other"]!.rawAccessibilityTree!;
    await rm(join(process.env.RELAY_STATE_DIR!, "authoring-evidence", source.sha256));
    let metadataReads = 0;
    const readAppMap = async (id: string) => {
      metadataReads += 1;
      return id === companion.id ? companion : null;
    };
    const pilot = await prepareAppMapCombineCells({
      map,
      combine,
      target,
      readAppMap,
      selectedCellIds: [caseId("value-1")],
    });
    assert.equal(metadataReads, 1, "the unselected companion metadata still resolves");
    assert.equal(pilot.cells.length, 1);
    assert.equal(pilot.cells[0]?.targetProfileId, currentProfile);
    await assert.rejects(
      prepareAppMapCombineCells({
        map,
        combine,
        target,
        readAppMap,
        selectedCellIds: [caseId("value-2")],
      }),
      offlineBlocked,
    );
  }));

test("unknown, conflicting, and target-mismatched unselected profiles still reject startup", async () =>
  isolated(async () => {
    const { map, combine } = await fixture(true, false);
    bindDifferentProfiles(combine);
    combine.cellRuntimeProfiles![1]!.targetProfileId = "missing-profile";
    await assert.rejects(
      prepareAppMapCombineCells({ map, combine, target, selectedCellIds: [caseId("value-1")] }),
      invalidProfile,
    );
    combine.cellRuntimeProfiles![1]!.targetProfileId = otherProfile;
    const other = map.screenVariants["home-other"]!;
    map.screenVariants.conflict = {
      ...structuredClone(other),
      id: "conflict",
      targetProfile: { ...other.targetProfile, osVersion: "18" },
    };
    await assert.rejects(
      prepareAppMapCombineCells({ map, combine, target, selectedCellIds: [caseId("value-1")] }),
      invalidProfile,
    );
    delete map.screenVariants.conflict;
    other.targetProfile.targetId = "another-ipad";
    await assert.rejects(
      prepareAppMapCombineCells({ map, combine, target, selectedCellIds: [caseId("value-1")] }),
      invalidProfile,
    );
  }));

test("malformed requested cases cannot silently expand; duplicate exact cases deduplicate", async () =>
  isolated(async () => {
    const { map, combine } = await fixture(true, false);
    bindDifferentProfiles(combine);
    for (const selectedCellIds of [[" "], ["foreign-case"], [caseId("value-1"), ""]]) {
      await assert.rejects(
        prepareAppMapCombineCells({ map, combine, target, selectedCellIds }),
        (error: unknown) =>
          error instanceof AppMapCombineCellContractError &&
          error.issues.some((issue) => issue.code === "foreign-binding"),
      );
    }
    const pilot = await prepareAppMapCombineCells({
      map,
      combine,
      target,
      selectedCellIds: [caseId("value-1"), caseId("value-1")],
    });
    assert.equal(pilot.cells.length, 1);
    const normalized = await prepareAppMapCombineCells({
      map,
      combine,
      target,
      selectedCellIds: [`  ${caseId("value-1")}  `],
    });
    assert.deepEqual(normalized.selectedCellIds, [caseId("value-1")]);
  }));

test("the canonical named cell selects before compilation and keeps named-selector precedence", async () =>
  isolated(async () => {
    const { map, combine } = await fixture(true, false);
    bindDifferentProfiles(combine);
    const prepared = await prepareAppMapCombineCells({
      map,
      combine,
      target,
      cell: "fast:value-1",
      selectedCellIds: [caseId("value-2")],
    });
    assert.deepEqual(prepared.selectedCellIds, [caseId("value-1")]);
    assert.equal(prepared.cells.length, 1);
    await assert.rejects(
      prepareAppMapCombineCells({ map, combine, target, cell: "foreign" }),
      (error: unknown) =>
        error instanceof AppMapCombineWorldError && error.code === "unknown-value",
    );
    await assert.rejects(
      prepareAppMapCombineCells({ map, combine, target, cell: "value-2" }),
      offlineBlocked,
    );
  }));

test("default full preparation freezes both public values with unchanged Test and action identity", async () =>
  isolated(async () => {
    const { map, combine } = await fixture(true, false);
    const prepared = await prepareAppMapCombineCells({ map, combine, target });
    assert.equal(prepared.cells.length, 2);
    assert.equal(prepared.selectedCellIds.length, 2);
    assert.equal(
      prepared.cells[0]!.childIntent.sourcePlan.recipeGraphDigest,
      prepared.cells[1]!.childIntent.sourcePlan.recipeGraphDigest,
    );
    const definitions = {
      revision: 7,
      value: [
        {
          id: "public-chat-prompts",
          name: "chat_prompt",
          scope: "shared" as const,
          source: "list" as const,
          values,
        },
      ],
    };
    for (const [index, cell] of prepared.cells.entries()) {
      const runtimeValues = combineCellRuntimeInputValues({ cell, definitions: definitions.value });
      const inputs = await freezeRecipeInputs({
        recipeGraph: cell.childIntent.recipeGraph,
        definitions,
        runtimeValues,
        seed: 12,
      });
      assert(inputs);
      bindPreparedCombineCellInputs(cell, inputs);
      assert.equal(cell.runtimeInputs?.variables.chat_prompt, values[index]);
      assert.equal(cell.outerIntent.child.frozenInputs?.values.chat_prompt, values[index]);
      assert.equal(cell.targetProfileId, currentProfile);
      assert.equal(cell.childIntent.sourcePlan.testId, "fast");
    }
  }));

test("resume validates only persisted frozen cases and cannot borrow changed unselected bindings", async () =>
  isolated(async () => {
    const { map, combine } = await fixture(true, false);
    bindDifferentProfiles(combine);
    const first = await prepareAppMapCombineCells({
      map,
      combine,
      target,
      selectedCellIds: [caseId("value-1")],
    });
    const frozenCase = first.cells[0]!;
    combine.cellRuntimeProfiles![0]!.targetProfileId = "changed-selected-profile";
    combine.cellRuntimeProfiles![1]!.targetProfileId = "changed-unselected-profile";
    const resumed = await prepareAppMapCombineCells({
      map,
      combine,
      frozenCellIds: first.cells.map((cell) => cell.cellId),
      selectedCellIds: first.selectedCellIds,
      cellRuntimeProfiles: [
        {
          testId: frozenCase.testId,
          values: frozenCase.values,
          targetProfileId: frozenCase.targetProfileId,
        },
      ],
      cellTargetBindings: [
        {
          testId: frozenCase.testId,
          values: frozenCase.values,
          target: localExecutionTargetRef(target),
        },
      ],
    });
    assert.equal(resumed.cells.length, 1);
    assert.equal(resumed.cells[0]!.outerIntent.digest, frozenCase.outerIntent.digest);
    assert.deepEqual(
      resumed.cellStates.map((cell) => cell.cellId),
      [frozenCase.cellId],
    );
    await assert.rejects(
      prepareAppMapCombineCells({ map, combine, target, selectedCellIds: first.selectedCellIds }),
      invalidProfile,
    );
    for (const frozenCellIds of [[], [" "], ["foreign-case"]]) {
      await assert.rejects(
        prepareAppMapCombineCells({ map, combine, target, frozenCellIds }),
        (error: unknown) =>
          error instanceof AppMapCombineCellContractError &&
          error.issues.some((issue) => issue.code === "foreign-binding"),
      );
    }
    await assert.rejects(
      prepareAppMapCombineCells({
        map,
        combine,
        target,
        frozenCellIds: [frozenCase.cellId],
        selectedCellIds: [caseId("value-2")],
      }),
      (error: unknown) =>
        error instanceof AppMapCombineCellContractError &&
        error.issues.some((issue) => issue.code === "foreign-binding"),
    );
  }));
