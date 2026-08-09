import assert from "node:assert/strict";
import test from "node:test";
import {
  compatibilityMatrixDraftFrom,
  compatibilityMatrixDraftValid,
  compatibilityMatrixId,
  emptyMatrixSelectorDraft,
  selectorsFromCompatibilityMatrixDraft,
  toggleListValue,
} from "./compatibility-matrix-draft";

test("a compatibility matrix round-trips through one canonical draft model", () => {
  const draft = compatibilityMatrixDraftFrom({
    id: "release-smoke",
    projectId: "default",
    name: "Release smoke",
    createdAt: 1,
    updatedAt: 1,
    selectors: [
      { targetIds: ["pixel", "ipad"] },
      {
        platforms: ["browser"],
        osVersionPrefixes: ["18", "19"],
        nameIncludes: ["Chrome", "Safari"],
        requiredCapabilities: ["screenshot", "tap"],
      },
    ],
  });

  assert.equal(draft.primary.mode, "targets");
  assert.equal(draft.additional[0]?.mode, "rules");
  assert.deepEqual(selectorsFromCompatibilityMatrixDraft(draft), [
    { targetIds: ["pixel", "ipad"] },
    {
      platforms: ["browser"],
      osVersionPrefixes: ["18", "19"],
      nameIncludes: ["Chrome", "Safari"],
      requiredCapabilities: ["screenshot", "tap"],
    },
  ]);
});

test("draft validity requires a name and a meaningful selector in every group", () => {
  const primary = emptyMatrixSelectorDraft("targets");
  assert.equal(compatibilityMatrixDraftValid({ name: "Smoke", primary, additional: [] }), false);
  assert.equal(
    compatibilityMatrixDraftValid({
      name: "Smoke",
      primary: { ...primary, targetIds: ["pixel"] },
      additional: [emptyMatrixSelectorDraft("rules")],
    }),
    false,
  );
  assert.equal(
    compatibilityMatrixDraftValid({
      name: "Smoke",
      primary: { ...primary, targetIds: ["pixel"] },
      additional: [{ ...emptyMatrixSelectorDraft("rules"), platforms: ["ios"] }],
    }),
    true,
  );
});

test("matrix ids and list toggles are deterministic and immutable", () => {
  assert.equal(compatibilityMatrixId("  Release smoke / iOS  "), "release-smoke-ios");
  assert.deepEqual(toggleListValue(["ios"], "android"), ["ios", "android"]);
  assert.deepEqual(toggleListValue(["ios", "android"], "ios"), ["android"]);
});
