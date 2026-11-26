import assert from "node:assert/strict";
import test from "node:test";
import { appMapCombineCellId } from "./app-map-combine-cell.js";
import {
  assessAppMapCombineCellTargetBindings,
  localExecutionTargetRef,
} from "./app-map-combine-cell-target-binding.js";

const cells = [
  {
    cellId: appMapCombineCellId("settings", { language: "en" }),
    testId: "settings",
    testName: "Settings",
    values: { language: "en" },
    worldLabel: "English",
  },
  {
    cellId: appMapCombineCellId("settings", { language: "pt-BR" }),
    testId: "settings",
    testName: "Settings",
    values: { language: "pt-BR" },
    worldLabel: "Português (Brasil)",
  },
];

test("per-cell target bindings retain independent Android and iOS local targets", () => {
  const assessed = assessAppMapCombineCellTargetBindings({
    cells,
    bindings: [
      {
        testId: "settings",
        values: { language: "en" },
        target: localExecutionTargetRef({ targetId: "pixel-en", platform: "android" }),
      },
      {
        testId: "settings",
        values: { language: "pt-BR" },
        target: localExecutionTargetRef({ targetId: "ipad-pt", platform: "ios" }),
      },
    ],
    knownTests: new Set(["settings"]),
    knownValues: { language: new Set(["en", "pt-BR"]) },
  });
  assert.deepEqual(assessed.issues, []);
  assert.deepEqual(
    [...assessed.byCellId.values()].map((target) => [target.targetId, target.platform]),
    [
      ["pixel-en", "android"],
      ["ipad-pt", "ios"],
    ],
  );
});

test("target bindings fail closed for a provider session or missing cell", () => {
  const remote = {
    schemaVersion: 1 as const,
    kind: "provider-session" as const,
    provider: { key: "future.provider", scope: "remote" as const },
    targetId: "session-1",
    platform: "ios" as const,
    identity: { kind: "provider-session" as const, value: "session-1" },
  };
  const assessed = assessAppMapCombineCellTargetBindings({
    cells,
    bindings: [{ testId: "settings", values: { language: "en" }, target: remote }],
    knownTests: new Set(["settings"]),
    knownValues: { language: new Set(["en", "pt-BR"]) },
  });
  assert.ok(assessed.issues.some((item) => item.code === "unsupported-target-binding"));
  assert.ok(
    assessed.issues.some(
      (item) => item.code === "missing-target-binding" && item.values?.language === "pt-BR",
    ),
  );
  assert.equal(assessed.byCellId.size, 0);
});
