import assert from "node:assert/strict";
import test from "node:test";
import {
  dataSourceModeOptions,
  dataSourceModePatch,
  dataSourceScopePatch,
} from "./data-source-mode";

test("shared data exposes every source mode", () => {
  assert.deepEqual(
    dataSourceModeOptions.map(({ value }) => value),
    ["Default", "List", "AI"],
  );
});

test("private scope is fixed and restores the previous shared mode", () => {
  const privateSelection = dataSourceScopePatch({ scope: "shared", mode: "List" }, "private");
  assert.deepEqual(privateSelection, {
    scope: "private",
    mode: "Default",
    sharedMode: "List",
  });

  assert.deepEqual(dataSourceScopePatch(privateSelection, "shared"), {
    scope: "shared",
    mode: "List",
    sharedMode: "List",
  });
});

test("choosing a shared source updates the mode that survives a private round trip", () => {
  const selected = { scope: "shared" as const, ...dataSourceModePatch("AI") };
  assert.equal(
    dataSourceScopePatch(dataSourceScopePatch(selected, "private"), "shared").mode,
    "AI",
  );
});
