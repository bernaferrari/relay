import { describe, expect, it } from "vitest";
import type {
  AppMap,
  AppMapCombine,
  AppMapScenarioTest,
  ScreenVariant,
  TargetProfile,
} from "@relay/protocol";
import {
  stagePreparedAppMapCombineCells,
  type StagedAppMapCombineCellBatch,
} from "../../packages/core/src/app-map-combine-cell-run.js";
import { prepareAppMapCombineCells } from "../../packages/core/src/app-map-combine-cell-prepare.js";
import { summarizeJob } from "../../packages/core/src/session-summary.js";
import { runWithOperationContext } from "../../packages/core/src/operation-context.js";
import {
  findPreviousApprovedRepeatCapture,
  type RepeatCaptureJob,
} from "../../packages/core/src/repeat-result-review.js";

function scope(appMapId: string, id: string) {
  return { organizationId: "org", projectId: "project", appMapId, id };
}

function fixture(appMapId: string): AppMap {
  const test: AppMapScenarioTest = {
    ...scope(appMapId, "settings-localization"),
    name: "Settings",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "prepare",
        kind: "script",
        intent: "Prepare without a selector",
        binding: { status: "resolved", kind: "script", source: "return true" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const profile: TargetProfile = {
    id: "pixel-9",
    targetId: "pixel-serial",
    source: "device",
    platform: "android",
    name: "Pixel 9",
    capabilities: ["snapshot"],
    observedAt: 1,
  };
  const variant: ScreenVariant = {
    ...scope(appMapId, "home-pixel"),
    screenId: "home",
    targetProfile: profile,
    observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
    evidenceIds: [],
    evidenceUris: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const combine: AppMapCombine = {
    ...scope(appMapId, "language-settings"),
    name: "Language × Settings",
    variableIds: ["language"],
    testIds: [test.id],
    selected: { language: ["pt-BR"] },
    cellRuntimeProfiles: [
      {
        testId: test.id,
        values: { language: "pt-BR" },
        targetProfileId: profile.id,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  return {
    schemaVersion: 1,
    id: appMapId,
    organizationId: "org",
    projectId: "project",
    name: appMapId,
    revision: 3,
    notes: {},
    groups: {},
    screens: {
      home: {
        ...scope(appMapId, "home"),
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
        variantIds: [variant.id],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    screenVariants: { [variant.id]: variant },
    connections: {},
    caseStacks: {},
    variables: {
      language: {
        ...scope(appMapId, "language"),
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "com.example" },
        options: [{ id: "pt-BR", label: "Português" }],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    tests: { [test.id]: test },
    combines: { [combine.id]: combine },
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

async function stage(appMapId: string): Promise<StagedAppMapCombineCellBatch> {
  const map = fixture(appMapId);
  const combine = map.combines["language-settings"]!;
  const prepared = await prepareAppMapCombineCells({
    map,
    combine,
    target: { targetId: "pixel-serial", platform: "android" },
  });
  const cell = prepared.cells[0]!;
  return runWithOperationContext(
    {
      schemaVersion: 1,
      actorId: "human:reviewer",
      actorKind: "human",
      organizationId: "org",
      projectId: "project",
      operationId: "job.combine.start",
      requestId: `stage-${appMapId}`,
      idempotencyKey: `stage-${appMapId}`,
      issuedAt: 1,
    },
    () =>
      stagePreparedAppMapCombineCells({
        cells: [cell],
        combineId: "language-settings",
        title: "Language × Settings",
        targetForCell: () => cell.executionTarget,
        queuedTargetProfile: () => ({
          ...cell.selectedRuntimeTargetProfile,
          source: "device",
          name: "Pixel 9",
          capabilities: ["snapshot"],
          observedAt: 1,
        }),
      }),
  );
}

function reviewJob(
  staged: StagedAppMapCombineCellBatch,
  input: { queuedAt: number; approved?: boolean },
): RepeatCaptureJob & { action: string; status: string; logs: string[] } {
  const job = staged.jobs[0]!;
  job.queuedAt = input.queuedAt;
  const summary = summarizeJob(job);
  return {
    ...summary,
    status: "ok",
    logs: [],
    frames: [
      {
        path: `${job.id}.png`,
        caption: "screen:Data Controls",
        capturedAt: input.queuedAt,
      },
    ],
    ...(input.approved
      ? {
          review: {
            schemaVersion: 1,
            status: "approved",
            capability: "visual-baseline",
            reason: "Approved checkpoint",
            requestedAt: input.queuedAt,
            decidedAt: input.queuedAt + 1,
            decidedBy: { id: "human:reviewer", kind: "human" },
          } as const,
        }
      : {}),
  };
}

describe("Repeat case identity", () => {
  it("survives stage → summary and prevents a cross-AppMap visual baseline", async () => {
    const approvedMapA = await stage("map-a");
    const currentMapA = await stage("map-a");
    const currentMapB = await stage("map-b");
    try {
      const approvedA = reviewJob(approvedMapA, { queuedAt: 10, approved: true });
      const currentA = reviewJob(currentMapA, { queuedAt: 100 });
      const currentB = reviewJob(currentMapB, { queuedAt: 100 });

      expect(approvedA.action).toBe(currentB.action);
      expect(approvedA.matrixCase).toMatchObject({
        kind: "combine",
        appMapId: "map-a",
        testId: "settings-localization",
        combineId: "language-settings",
        values: { language: "pt-BR" },
      });
      expect(
        findPreviousApprovedRepeatCapture([approvedA, currentA], currentA, "Data Controls")?.job.id,
      ).toBe(approvedA.id);
      expect(
        findPreviousApprovedRepeatCapture([approvedA, currentB], currentB, "Data Controls"),
      ).toBeNull();
    } finally {
      approvedMapA.rollback();
      currentMapA.rollback();
      currentMapB.rollback();
    }
  });
});
