import assert from "node:assert/strict";
import test from "node:test";
import {
  inferAccessibilityApp,
  presentAccessibilityNode,
  presentPersistedSnapshot,
} from "./accessibility-defaults.js";

test("a node only writes fields that differ from the document defaults", () => {
  const presented = presentAccessibilityNode(
    {
      type: "android.widget.TextView",
      label: "Data Controls",
      value: "Data Controls",
      bundleId: "ai.x.grok",
      enabled: true,
      visibleToUser: true,
      rect: { x: 0, y: 0, width: 10, height: 10 },
    },
    { app: "ai.x.grok", enabled: true, visible: true },
  );
  assert.deepEqual(presented, {
    type: "TextView",
    label: "Data Controls",
    rect: { x: 0, y: 0, width: 10, height: 10 },
  });
});

test("a foreign app is an override on the same key as the default", () => {
  const presented = presentAccessibilityNode(
    {
      type: "android.widget.TextView",
      label: "14:30",
      bundleId: "com.android.systemui",
      enabled: true,
      visibleToUser: true,
    },
    { app: "ai.x.grok", enabled: true, visible: true },
  );
  assert.equal(presented.app, "com.android.systemui");
  assert.equal(presented.bundleId, undefined);
  assert.equal(presented.enabled, undefined);
});

test("disabled or hidden nodes write the exception", () => {
  const presented = presentAccessibilityNode(
    { label: "Hidden", enabled: false, visibleToUser: false, bundleId: "ai.x.grok" },
    { app: "ai.x.grok", enabled: true, visible: true },
  );
  assert.equal(presented.enabled, false);
  assert.equal(presented.visible, false);
  assert.equal(presented.app, undefined);
});

test("inferAccessibilityApp prefers treeApp then the dominant non-chrome bundle", () => {
  assert.equal(
    inferAccessibilityApp({ treeApp: "ai.x.grok" }, [{ bundleId: "com.android.systemui" }]),
    "ai.x.grok",
  );
  assert.equal(
    inferAccessibilityApp({}, [
      { bundleId: "com.android.systemui" },
      { bundleId: "ai.x.grok" },
      { bundleId: "ai.x.grok" },
    ]),
    "ai.x.grok",
  );
});

test("presentPersistedSnapshot hoists defaults and keeps a full node list", () => {
  const presented = presentPersistedSnapshot({
    treeApp: "ai.x.grok",
    capturedAt: 1,
    inspectable: true,
    nodes: [
      { type: "android.widget.TextView", label: "Data Controls", bundleId: "ai.x.grok", enabled: true },
      { type: "android.widget.TextView", label: "14:30", bundleId: "com.android.systemui" },
    ],
  });
  assert.deepEqual(presented.defaults, { app: "ai.x.grok", enabled: true, visible: true });
  assert.equal(presented.nodes.length, 2);
  assert.equal(presented.nodes[0]?.app, undefined);
  assert.equal(presented.nodes[1]?.app, "com.android.systemui");
});
