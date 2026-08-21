import assert from "node:assert/strict";
import test from "node:test";
import type { LocaleMatrixCaseTargetBinding } from "./locale-matrix-admission";
import {
  bindingsForLocaleMatrixCases,
  localeMatrixAdmissionCohorts,
  localeMatrixAdmissionSelection,
  localeMatrixAdmissionWorkItems,
  upsertLocaleMatrixCaseTargetBinding,
} from "./locale-matrix-admission";

const cases = [
  { caseIndex: 0, locale: "en" },
  { caseIndex: 1, locale: "Italiano\n(Italy)" },
  { caseIndex: 2, locale: "en" },
];
const durationCohort = { testId: "settings-test", action: "settings-test" };

function target(targetId: string, platform: "android" | "ios" = "android") {
  return {
    schemaVersion: 1 as const,
    kind: "local-device" as const,
    provider: { key: "relay.local.agent-device" as const, scope: "local" as const },
    targetId,
    platform,
    identity: { kind: "device-serial" as const, value: targetId },
  };
}

test("locale admission distinguishes duplicate locale text by frozen case index", () => {
  const bindings: LocaleMatrixCaseTargetBinding[] = [
    { caseIndex: 0, locale: "en", executionTarget: target("pixel-a") },
    { caseIndex: 1, locale: "Italiano\n(Italy)", executionTarget: target("ipad-b", "ios") },
    { caseIndex: 2, locale: "en", executionTarget: target("pixel-a") },
  ];
  assert.deepEqual(
    bindingsForLocaleMatrixCases(bindings, cases).map((binding) => [
      binding.caseIndex,
      binding.executionTarget.targetId,
    ]),
    [
      [0, "pixel-a"],
      [1, "ipad-b"],
      [2, "pixel-a"],
    ],
  );
  assert.deepEqual(
    localeMatrixAdmissionWorkItems({ cases, bindings, durationCohort })?.map((item) => item.id),
    ["locale:0", "locale:1", "locale:2"],
  );
  assert.deepEqual(localeMatrixAdmissionCohorts({ cases, bindings, durationCohort }), [
    { targetId: "pixel-a", platform: "android", ...durationCohort },
    { targetId: "ipad-b", platform: "ios", ...durationCohort },
  ]);
});

test("locale admission fails closed for a missing, stale, or duplicate case binding", () => {
  const partial = [
    { caseIndex: 0, locale: "en", executionTarget: target("pixel-a") },
    { caseIndex: 1, locale: "Italiano\n(Italy)", executionTarget: target("ipad-b", "ios") },
  ];
  const selection = localeMatrixAdmissionSelection({ cases, bindings: partial, durationCohort });
  assert.equal("issue" in selection, true);
  assert.match("issue" in selection ? selection.issue : "", /every materialized locale case/u);
  const duplicate = [
    ...partial,
    { caseIndex: 0, locale: "en", executionTarget: target("ipad-b", "ios") },
  ];
  assert.equal(
    localeMatrixAdmissionWorkItems({ cases: [cases[0]!], bindings: duplicate, durationCohort }),
    undefined,
  );
  const rebound = upsertLocaleMatrixCaseTargetBinding(partial, cases[1]!, target("pixel-c"));
  assert.equal(rebound.filter((binding) => binding.caseIndex === 1).length, 1);
  assert.equal(
    rebound.find((binding) => binding.caseIndex === 1)?.executionTarget.targetId,
    "pixel-c",
  );
});
