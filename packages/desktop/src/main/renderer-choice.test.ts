import assert from "node:assert/strict";
import test from "node:test";
import { relayDesktopRenderer } from "./renderer-choice.ts";

test("desktop ships the React product renderer by default", () => {
  assert.equal(relayDesktopRenderer({}), "renderer-v2");
  assert.equal(relayDesktopRenderer({ RELAY_UI_V2: "0" }), "renderer-v2");
});

test("desktop legacy renderer requires the explicit rollback flag", () => {
  assert.equal(relayDesktopRenderer({ RELAY_UI_LEGACY: "1" }), "renderer");
  assert.equal(relayDesktopRenderer({ RELAY_UI_LEGACY: "0" }), "renderer-v2");
});
