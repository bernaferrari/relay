/** Runtime contract for the target-free locale matrix materialization read. */
import { createOperationBuilders } from "./operation-builders.js";
import type { OperationInput, OperationOutput, RelayOperationMap } from "./operation-map.js";
import {
  boolean,
  fail,
  number,
  objectParser,
  record,
  string,
} from "./operation-parser-primitives.js";

type LocaleMatrixMaterializationOperationId = "job.locale-matrix.materialize";

function optionalString(value: unknown, label: string): void {
  if (value !== undefined) string(value, label);
}

function optionalBoolean(value: unknown, label: string): void {
  if (value !== undefined) boolean(value, label);
}

function optionalRevision(value: unknown, label: string): void {
  if (value === undefined) return;
  const parsed = number(value, label);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(label, "must be a non-negative integer");
}

function assertLocales(value: unknown, label: string): void {
  if (!Array.isArray(value) || !value.length) fail(label, "must be a non-empty array");
  value.forEach((locale, index) => string(locale, `${label} ${index}`));
}

function assertScope(value: unknown, label: string): void {
  const scope = record(value, label);
  assertLocales(scope.locales, `${label} locales`);
  optionalString(scope.app, `${label} app`);
  optionalString(scope.appLocale, `${label} appLocale`);
  optionalBoolean(scope.relaunch, `${label} relaunch`);
  if (scope.entryPath !== undefined && !Array.isArray(scope.entryPath)) {
    fail(`${label} entryPath`, "must be an array");
  }
  if (scope.languagePath !== undefined && !Array.isArray(scope.languagePath)) {
    fail(`${label} languagePath`, "must be an array");
  }
  if (scope.exitPath !== undefined && !Array.isArray(scope.exitPath)) {
    fail(`${label} exitPath`, "must be an array");
  }
  if (scope.languageOptions !== undefined)
    record(scope.languageOptions, `${label} languageOptions`);
  optionalString(scope.restoreLocale, `${label} restoreLocale`);
  optionalBoolean(scope.restoreAfterEach, `${label} restoreAfterEach`);
  optionalBoolean(scope.restoreAtEnd, `${label} restoreAtEnd`);
  optionalBoolean(scope.screenshotEachLocale, `${label} screenshotEachLocale`);
}

const inputParser = objectParser<OperationInput<LocaleMatrixMaterializationOperationId>>(
  "locale matrix materialization input",
  (input) => {
    optionalString(input.recipe, "locale matrix recipe");
    optionalString(input.appMapId, "locale matrix App Map id");
    optionalString(input.flowId, "locale matrix flow id");
    optionalString(input.testId, "locale matrix Test id");
    optionalString(input.variableId, "locale matrix language Variable id");
    optionalRevision(input.expectedAppMapRevision, "locale matrix expected App Map revision");
    const sourceCount = [
      Boolean(input.recipe),
      Boolean(input.appMapId && input.flowId),
      Boolean(input.appMapId && input.testId && input.variableId),
    ].filter(Boolean).length;
    if (sourceCount !== 1) {
      fail(
        "locale matrix source",
        "requires exactly one recipe, appMapId plus flowId, or appMapId plus testId and variableId",
      );
    }
    if (input.testId !== undefined && !(input.appMapId && input.variableId)) {
      fail("locale matrix Test source", "requires appMapId and variableId");
    }
    if (input.variableId !== undefined && !(input.appMapId && input.testId)) {
      fail("locale matrix language Variable source", "requires appMapId and testId");
    }
    if (input.locales !== undefined) assertLocales(input.locales, "locale matrix locales");
    optionalString(input.profileId, "locale matrix profile id");
    if (input.preset !== undefined && input.preset !== "grok") {
      fail("locale matrix preset", "must be grok");
    }
    if (input.scope !== undefined) assertScope(input.scope, "locale matrix scope");
    optionalString(input.projectId, "locale matrix project id");
  },
);

const outputParser = objectParser<OperationOutput<LocaleMatrixMaterializationOperationId>>(
  "locale matrix materialization response",
  (input) => {
    if (input.schemaVersion !== 1) fail("locale matrix materialization schemaVersion", "must be 1");
    number(input.materializedAt, "locale matrix materialization materializedAt");
    const source = record(input.source, "locale matrix materialization source");
    if (source.kind === "recipe") {
      string(source.recipeId, "locale matrix materialization recipe id");
    } else if (source.kind === "app-map-flow") {
      string(source.appMapId, "locale matrix materialization App Map id");
      string(source.flowId, "locale matrix materialization flow id");
      const revision = number(
        source.appMapRevision,
        "locale matrix materialization App Map revision",
      );
      if (!Number.isSafeInteger(revision) || revision < 0) {
        fail("locale matrix materialization App Map revision", "must be a non-negative integer");
      }
      string(source.recipeId, "locale matrix materialization compiled recipe id");
    } else if (source.kind === "app-map-test") {
      string(source.appMapId, "locale matrix materialization App Map id");
      string(source.testId, "locale matrix materialization Test id");
      string(source.variableId, "locale matrix materialization language Variable id");
      const revision = number(
        source.appMapRevision,
        "locale matrix materialization App Map revision",
      );
      if (!Number.isSafeInteger(revision) || revision < 0) {
        fail("locale matrix materialization App Map revision", "must be a non-negative integer");
      }
      string(source.recipeId, "locale matrix materialization compiled recipe id");
    } else {
      fail("locale matrix materialization source kind", "is unsupported");
    }
    assertScope(input.scope, "locale matrix materialization scope");
    if (!Array.isArray(input.cases) || !input.cases.length) {
      fail("locale matrix materialization cases", "must be a non-empty array");
    }
    let previous = -1;
    input.cases.forEach((value, index) => {
      const item = record(value, `locale matrix materialization case ${index}`);
      const caseIndex = number(item.caseIndex, `locale matrix materialization case ${index} index`);
      if (!Number.isSafeInteger(caseIndex) || caseIndex < 0 || caseIndex !== previous + 1) {
        fail(
          `locale matrix materialization case ${index} index`,
          "must be contiguous and deterministically ordered",
        );
      }
      previous = caseIndex;
      string(item.locale, `locale matrix materialization case ${index} locale`);
    });
    const cohort = record(input.durationCohort, "locale matrix materialization duration cohort");
    string(cohort.testId, "locale matrix materialization duration cohort testId");
    string(cohort.action, "locale matrix materialization duration cohort action");
    if (
      input.targetPlatform !== undefined &&
      input.targetPlatform !== "android" &&
      input.targetPlatform !== "ios"
    ) {
      fail("locale matrix materialization targetPlatform", "must be android or ios");
    }
  },
);

const { command } = createOperationBuilders<
  Pick<RelayOperationMap, LocaleMatrixMaterializationOperationId>
>();

/** POST is deliberate because materialization accepts a full taught scope, but
 * it is an idempotent read with no target capabilities or lease. */
export const localeMatrixMaterializationOperationDefinition = command(
  "job.locale-matrix.materialize",
  "Materialize exact locale matrix cases",
  "POST",
  "/jobs/locale-matrix/materialize",
  {
    category: "evidence",
    minimumRole: "viewer",
    idempotency: "inherent",
    input: inputParser,
    output: outputParser,
  },
);
