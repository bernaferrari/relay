import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Device } from "./device/device.js";
import {
  getAction,
  isActionId,
  listActionsWithTrace,
  registerAction,
  runAction,
} from "./actions.js";

const device = {} as Device;

describe("core action registry", () => {
  it("registers, executes, traces, and unregisters extension actions", async () => {
    const unregister = registerAction(
      {
        id: "example-action",
        title: "Example action",
        description: "Exercise the generic registry.",
        category: "test",
        tracePlan: {
          glyphs: ["ok"],
          kind: "Verify",
          tone: "pass",
          planned: [{ title: "Verify example", glyphs: ["ok"] }],
        },
      },
      async () => "done",
    );
    try {
      assert.equal(isActionId("example-action"), true);
      assert.equal(getAction("example-action")?.title, "Example action");
      const traced = listActionsWithTrace().find((action) => action.id === "example-action");
      assert.deepEqual(traced?.planned, [{ title: "Verify example", glyphs: ["ok"] }]);
      assert.deepEqual(await runAction(device, "example-action"), {
        ok: true,
        action: "example-action",
        result: "done",
      });
    } finally {
      unregister();
    }
    assert.equal(isActionId("example-action"), false);
  });

  it("uses the generic fallback trace plan and reports unknown actions", async () => {
    const unregister = registerAction(
      {
        id: "fallback-action",
        title: "Fallback action",
        description: "Exercise the fallback trace plan.",
        category: "test",
      },
      async () => undefined,
    );
    try {
      const traced = listActionsWithTrace().find((action) => action.id === "fallback-action");
      assert.deepEqual(traced?.glyphs, ["ai", "wait"]);
      assert.deepEqual(await runAction(device, "missing-action"), {
        ok: false,
        action: "missing-action",
        error: "Unknown action id: missing-action",
      });
    } finally {
      unregister();
    }
  });
});
