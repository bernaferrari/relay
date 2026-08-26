import assert from "node:assert/strict";
import test from "node:test";
import { AppMapCombineCellContractError, localExecutionTargetRef } from "@relay/core";
import type { AppMap, AppMapCombineCellState, AppMapCombinePreflightIssue } from "@relay/protocol";
import { combineCellContractHttpError } from "./app-map-combine-runtime-contract.js";
import { HttpError } from "./http.js";

function mapWithProfiles(
  profiles: Array<{ id: string; targetId: string; platform: "android" | "ios" }>,
): AppMap {
  return {
    schemaVersion: 1,
    id: "settings",
    organizationId: "org",
    projectId: "project",
    name: "Settings",
    revision: 3,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: Object.fromEntries(
      profiles.map((profile, index) => [
        `home-${index}`,
        {
          organizationId: "org",
          projectId: "project",
          appMapId: "settings",
          id: `home-${index}`,
          screenId: "home",
          targetProfile: {
            id: profile.id,
            targetId: profile.targetId,
            source: "device",
            platform: profile.platform,
            name: profile.id,
            capabilities: ["snapshot"],
            observedAt: 1,
          },
          observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
          evidenceIds: [],
          evidenceUris: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ),
    connections: {},
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
    createdAt: 1,
    updatedAt: 1,
  };
}

function bindingError(cells: AppMapCombineCellState[] = []): AppMapCombineCellContractError {
  const issue: AppMapCombinePreflightIssue = {
    code: "missing-binding",
    message: "Bind a runtime profile to Prepare once · world-1.",
  };
  return new AppMapCombineCellContractError(issue.message, [issue], cells);
}

test("a failed binding recovery lists the compatible saved profile ids and their target", () => {
  const map = mapWithProfiles([
    { id: "pixel-it", targetId: "pixel-1", platform: "android" },
    { id: "pixel-en", targetId: "pixel-1", platform: "android" },
  ]);
  const error = combineCellContractHttpError(bindingError(), {
    map,
    target: { targetId: "pixel-1", platform: "android" },
  });
  assert.ok(error instanceof HttpError);
  assert.equal(error.status, 409);
  const body = error.body as { recovery?: string };
  assert.ok(body.recovery?.startsWith("Bind an explicit saved targetProfileId"));
  assert.ok(
    body.recovery?.includes("Saved runtime profiles for android:pixel-1: pixel-en, pixel-it."),
    `recovery lists candidates: ${body.recovery}`,
  );
});

test("a failed binding recovery says to capture first when the target has no saved profile", () => {
  const map = mapWithProfiles([{ id: "ipad-en", targetId: "ipad-1", platform: "ios" }]);
  const error = combineCellContractHttpError(bindingError(), {
    map,
    target: { targetId: "pixel-1", platform: "android" },
  });
  const body = error.body as { recovery?: string };
  assert.equal(
    body.recovery,
    "No saved runtime profile for target android:pixel-1 — capture a screen on this target first.",
  );
});

test("cell execution targets contribute candidates when no single target is supplied", () => {
  const map = mapWithProfiles([
    { id: "pixel-en", targetId: "pixel-1", platform: "android" },
    { id: "ipad-en", targetId: "ipad-1", platform: "ios" },
  ]);
  const deviceTarget = localExecutionTargetRef({
    targetId: "pixel-1",
    platform: "android",
  });
  const cells: AppMapCombineCellState[] = [
    {
      cellId: "cell" + "0".repeat(28),
      testId: "script-only",
      testName: "Prepare once",
      values: { language: "en" },
      worldLabel: "world-1",
      target: deviceTarget,
      binding: "missing",
    },
  ];
  const error = combineCellContractHttpError(bindingError(cells), { map });
  const body = error.body as { recovery?: string };
  assert.ok(body.recovery?.includes("Saved runtime profiles for android:pixel-1: pixel-en."));
});

test("without a map the recovery stays on the generic binding instruction", () => {
  const error = combineCellContractHttpError(bindingError());
  const body = error.body as { recovery?: string; code?: string };
  assert.equal(body.code, "APP_MAP_COMBINE_CELL_CONTRACT");
  assert.equal(
    body.recovery,
    "Bind an explicit saved targetProfileId to every selected Test × world cell, then retry. Relay will not borrow another cell's profile.",
  );
});
