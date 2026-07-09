import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { runRecipeStep } from "./recipe-runner.js";
import type { Device } from "./device.js";

// Keep controlled() single-attempt so error paths are fast and deterministic.
before(() => {
  process.env.GROK_DEVICE_RETRY_ATTEMPTS = "1";
});
after(() => {
  delete process.env.GROK_DEVICE_RETRY_ATTEMPTS;
});

/**
 * Minimal stub covering the SDK surface the expect step touches:
 * interactions.find (presence probe) and command.wait (waitFor + sleep).
 */
function stubDevice(impl: {
  find?: () => Promise<unknown>;
  wait?: () => Promise<unknown>;
}): Device {
  return {
    interactions: { find: impl.find ?? (() => Promise.resolve({})) },
    command: { wait: impl.wait ?? (() => Promise.resolve({})) },
  } as unknown as Device;
}

const noLog = { log: () => {} };

describe("runRecipeStep expect — error classification", () => {
  it('gone passes when find reports "No match" (element absent)', async () => {
    const device = stubDevice({
      find: () => Promise.reject(new Error('No match for query "Welcome"')),
    });
    await runRecipeStep(
      device,
      { kind: "expect", target: { text: "Welcome" }, condition: "gone" },
      noLog,
    );
  });

  it("gone propagates infrastructure errors instead of passing or asserting", async () => {
    const device = stubDevice({
      find: () => Promise.reject(new Error("no active session — run doctor")),
    });
    await assert.rejects(
      () =>
        runRecipeStep(
          device,
          { kind: "expect", target: { text: "Welcome" }, condition: "gone" },
          noLog,
        ),
      (err: Error) => {
        assert.match(err.message, /no active session/);
        assert.doesNotMatch(err.message, /still visible/);
        return true;
      },
    );
  });

  it("visible converts a genuine wait timeout into the assertion message", async () => {
    const device = stubDevice({
      wait: () => Promise.reject(new Error('Timed out waiting for text "Sign in"')),
    });
    await assert.rejects(
      () =>
        runRecipeStep(
          device,
          { kind: "expect", target: { label: "Sign in" }, condition: "visible" },
          noLog,
        ),
      /expect: "label "Sign in"" not visible after 5s/,
    );
  });

  it("visible propagates infrastructure errors with their original message", async () => {
    const device = stubDevice({
      wait: () => Promise.reject(new Error("no active session — run doctor")),
    });
    await assert.rejects(
      () =>
        runRecipeStep(
          device,
          { kind: "expect", target: { label: "Sign in" }, condition: "visible" },
          noLog,
        ),
      (err: Error) => {
        assert.match(err.message, /no active session/);
        assert.doesNotMatch(err.message, /not visible after/);
        return true;
      },
    );
  });
});
