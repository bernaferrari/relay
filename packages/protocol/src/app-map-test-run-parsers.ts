import type { AppMapOperationMap } from "./app-map-operation-map.js";
import type { AppMapParserDependencies } from "./app-map-operation-parsers.js";
import type { RuntimeParser } from "./operation-contract.js";

type AppMapOperationId = keyof AppMapOperationMap;
type AppMapOperationInput<Id extends AppMapOperationId> = AppMapOperationMap[Id]["input"];
type AppMapOperationOutput<Id extends AppMapOperationId> = AppMapOperationMap[Id]["output"];

export function createAppMapTestRunParsers(dependencies: AppMapParserDependencies) {
  const { fail, number, objectParser, record, string } = dependencies;

  function validateAppMapTestEdits(input: Record<string, unknown>, label: string): void {
    const edits = input.edits;
    if (!Array.isArray(edits) || edits.length === 0 || edits.length > 100) {
      fail(`${label} edits`, "must contain between 1 and 100 semantic edits");
    }
    const semanticEdits = edits as unknown[];
    for (const [index, raw] of semanticEdits.entries()) {
      const edit = record(raw, `${label} edit ${index}`);
      const kind = string(edit.kind, `${label} edit ${index} kind`);
      if (kind === "test.patch") {
        record(edit.patch, `${label} edit ${index} patch`);
      } else if (kind === "step.add") {
        record(edit.step, `${label} edit ${index} step`);
        if (edit.placement !== undefined)
          record(edit.placement, `${label} edit ${index} placement`);
        if (edit.index !== undefined) number(edit.index, `${label} edit ${index} index`);
      } else if (kind === "step.patch") {
        string(edit.stepId, `${label} edit ${index} stepId`);
        record(edit.patch, `${label} edit ${index} patch`);
      } else if (kind === "step.remove") {
        string(edit.stepId, `${label} edit ${index} stepId`);
      } else if (kind === "step.reorder") {
        const orderedStepIds = edit.orderedStepIds;
        if (!Array.isArray(orderedStepIds)) {
          fail(`${label} edit ${index} orderedStepIds`, "must be an array");
        }
        (orderedStepIds as unknown[]).forEach((id, stepIndex) =>
          string(id, `${label} edit ${index} orderedStepIds ${stepIndex}`),
        );
        if (edit.placement !== undefined)
          record(edit.placement, `${label} edit ${index} placement`);
      } else if (kind === "step.bind") {
        string(edit.stepId, `${label} edit ${index} stepId`);
        record(edit.binding, `${label} edit ${index} binding`);
      } else if (kind === "step.unbind") {
        string(edit.stepId, `${label} edit ${index} stepId`);
        string(edit.reason, `${label} edit ${index} reason`);
        if (edit.candidates !== undefined && !Array.isArray(edit.candidates)) {
          fail(`${label} edit ${index} candidates`, "must be an array");
        }
      } else {
        fail(`${label} edit ${index} kind`, "is unsupported");
      }
    }
  }

  const appMapTestEditInputParser = objectParser<AppMapOperationInput<"app-map.test.edit">>(
    "Test edit",
    (input) => {
      string(input.appMapId, "Test edit appMapId");
      string(input.testId, "Test edit testId");
      number(input.expectedRevision, "Test edit expectedRevision");
      if (input.eventId !== undefined) string(input.eventId, "Test edit eventId");
      validateAppMapTestEdits(input, "Test");
    },
  );

  const appMapTestProposeInputParser = objectParser<AppMapOperationInput<"app-map.test.propose">>(
    "Test proposal",
    (input) => {
      string(input.appMapId, "Test proposal appMapId");
      string(input.testId, "Test proposal testId");
      number(input.expectedRevision, "Test proposal expectedRevision");
      if (input.eventId !== undefined) string(input.eventId, "Test proposal eventId");
      if (input.proposalId !== undefined) string(input.proposalId, "Test proposal proposalId");
      if (input.title !== undefined) string(input.title, "Test proposal title");
      if (input.description !== undefined) string(input.description, "Test proposal description");
      validateAppMapTestEdits(input, "Test proposal");
    },
  );

  const appMapTestProposeOutputParser = objectParser<AppMapOperationOutput<"app-map.test.propose">>(
    "Test proposal response",
    (output) => {
      record(output.appMap, "Test proposal App Map");
      string(output.proposalId, "Test proposal proposalId");
    },
  );

  const appMapTestRunInputParser = objectParser<AppMapOperationInput<"app-map.test.run">>(
    "Test run",
    (input) => {
      string(input.appMapId, "Test run appMapId");
      string(input.testId, "Test run testId");
      if (number(input.expectedRevision, "Test run expectedRevision") < 0) {
        fail("Test run expectedRevision", "must be non-negative");
      }
      const target = record(input.target, "Test run target");
      string(target.targetId, "Test run targetId");
      if (target.kind !== "device" && target.kind !== "browser") {
        fail("Test run target kind", "must be device or browser");
      }
      if (
        target.platform !== "android" &&
        target.platform !== "ios" &&
        target.platform !== "browser"
      ) {
        fail("Test run target platform", "must be android, ios, or browser");
      }
      if (
        (target.kind === "browser" && target.platform !== "browser") ||
        (target.kind === "device" && target.platform === "browser")
      ) {
        fail("Test run target", "kind and platform do not describe the same target");
      }
      if (input.targetProfileId !== undefined) {
        string(input.targetProfileId, "Test run targetProfileId");
      }
      if (input.surfaceCapture !== undefined) {
        const policy = record(input.surfaceCapture, "Test run surfaceCapture");
        const screenIds = policy.forceRecaptureScreenIds;
        if (!Array.isArray(screenIds) || screenIds.length === 0 || screenIds.length > 50) {
          fail(
            "Test run surfaceCapture forceRecaptureScreenIds",
            "must contain between 1 and 50 screen ids",
          );
        }
        const selectedScreenIds = screenIds as unknown[];
        const seen = new Set<string>();
        for (const [index, value] of selectedScreenIds.entries()) {
          const screenId = string(
            value,
            `Test run surfaceCapture forceRecaptureScreenIds ${index}`,
          );
          if (seen.has(screenId)) {
            fail(
              "Test run surfaceCapture forceRecaptureScreenIds",
              `contains duplicate screen id ${screenId}`,
            );
          }
          seen.add(screenId);
        }
      }
      if (input.startup !== undefined) {
        const startup = record(input.startup, "Test run startup");
        if (startup.mode === "cold") {
          if (startup.screenId !== undefined) {
            fail("Test run startup screenId", "is only valid for verified-checkpoint mode");
          }
        } else if (startup.mode === "verified-checkpoint") {
          string(startup.screenId, "Test run startup screenId");
        } else {
          fail("Test run startup mode", "must be cold or verified-checkpoint");
        }
      }
      if (input.in !== undefined) {
        if (input.startup !== undefined) {
          fail("Test run startup", "cannot be combined with in; run the Test once or omit startup");
        }
        const worlds = record(input.in, "Test run in");
        const entries = Object.entries(worlds);
        if (!entries.length) fail("Test run in", "must name at least one Variable");
        for (const [variableId, rawValueIds] of entries) {
          string(variableId, "Test run in Variable");
          if (!Array.isArray(rawValueIds) || rawValueIds.length === 0) {
            fail(`Test run in ${variableId}`, "must be a non-empty array of value ids");
          }
          const valueIds = rawValueIds as unknown[];
          const seen = new Set<string>();
          for (const [index, valueId] of valueIds.entries()) {
            const id = string(valueId, `Test run in ${variableId} ${index}`);
            if (seen.has(id)) {
              fail(`Test run in ${variableId}`, `contains duplicate value id ${id}`);
            }
            seen.add(id);
          }
        }
      }
      if (input.lens !== undefined) {
        const lens = string(input.lens, "Test run lens");
        if (
          lens !== "visual" &&
          lens !== "smoke" &&
          lens !== "every-screen" &&
          lens !== "failures-only" &&
          lens !== "final-screen" &&
          lens !== "none"
        ) {
          fail(
            "Test run lens",
            "must be visual, smoke, every-screen, failures-only, final-screen, or none",
          );
        }
      }
      if (input.executionMode !== undefined) {
        const mode = string(input.executionMode, "Test run executionMode");
        if (mode !== "pilot" && mode !== "all") {
          fail("Test run executionMode", "must be pilot or all");
        }
      }
      if (input.cell !== undefined) string(input.cell, "Test run cell");
      if (input.sourceRevision !== undefined) {
        const revision = record(input.sourceRevision, "Test run sourceRevision");
        if (revision.vcs !== "git") fail("Test run sourceRevision vcs", "must be 'git'");
        const sha = string(revision.sha, "Test run sourceRevision sha");
        if (!/^[0-9a-f]{7,40}$/.test(sha)) {
          fail("Test run sourceRevision sha", "must be 7-40 lowercase hex characters");
        }
        if (revision.prNumber !== undefined) {
          const pr = number(revision.prNumber, "Test run sourceRevision prNumber");
          if (!Number.isInteger(pr) || pr < 1) {
            fail("Test run sourceRevision prNumber", "must be a positive integer");
          }
        }
        if (revision.branch !== undefined) {
          string(revision.branch, "Test run sourceRevision branch");
        }
        if (revision.artifactDigest !== undefined) {
          string(revision.artifactDigest, "Test run sourceRevision artifactDigest");
        }
      }
    },
  );

  const appMapTestRunOutputParser = objectParser<AppMapOperationOutput<"app-map.test.run">>(
    "Test run response",
    (output) => {
      const identity = record(output.planIdentity, "Test run plan identity");
      string(identity.appMapId, "Test run plan identity appMapId");
      number(identity.appMapRevision, "Test run plan identity appMapRevision");
      string(identity.testId, "Test run plan identity testId");
      string(identity.rootRecipeId, "Test run plan identity rootRecipeId");
      record(output.plan, "Test run plan");
      record(output.job, "Test run job");
    },
  );

  return {
    appMapTestEditInputParser,
    appMapTestProposeInputParser,
    appMapTestProposeOutputParser,
    appMapTestRunInputParser,
    appMapTestRunOutputParser,
  };
}
