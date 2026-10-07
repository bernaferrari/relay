import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GROK_ANDROID_APP_POLICY } from "./app-identity-policy.js";
import type { SnapshotNode } from "./device.js";
import { nativeHomeIdentityNodes } from "./screen-identity-native-home.js";
import { observeScreenIdentity } from "./screen-identity.js";

const baseline = JSON.parse(
  readFileSync(new URL("./fixtures/grok-chat-home-keyboard.json", import.meta.url), "utf8"),
).nodes as SnapshotNode[];
const advisory = JSON.parse(
  readFileSync(new URL("./fixtures/grok-home-advisory.json", import.meta.url), "utf8"),
).nodes as SnapshotNode[];
const identity = (nodes: SnapshotNode[]) =>
  observeScreenIdentity(nodes, { policy: GROK_ANDROID_APP_POLICY });

test("real Home advisory and changing suggestions preserve qualified workspace identity", () => {
  assert.notEqual(
    observeScreenIdentity(baseline).fingerprint,
    observeScreenIdentity(advisory).fingerprint,
  );
  assert.equal(identity(baseline).fingerprint, identity(advisory).fingerprint);
  const before = structuredClone(advisory);
  const retained = nativeHomeIdentityNodes(advisory, "ai.x.grok");
  assert.ok(retained && retained.length < advisory.length);
  assert.equal(
    retained.some((node) => node.label?.startsWith("Grok is experiencing")),
    false,
  );
  assert.deepEqual(advisory, before, "complete evidence remains unchanged, including the notice");
});

test("Home body policy cannot admit different navigation, mode, typed prompt or permission overlay", () => {
  const variants = [
    advisory.map((node) => ({ ...node, selected: false })),
    advisory.map((node) =>
      node.label === "Fast" ? { ...node, label: "Expert", value: "Expert" } : node,
    ),
    advisory.map((node) =>
      node.identifier === "chat_text_input" ? { ...node, value: "An unsent prompt" } : node,
    ),
    advisory.map((node) => ({ ...node, bundleId: "other.app" })),
    [
      ...advisory,
      {
        bundleId: "com.android.permissioncontroller",
        label: "Allow",
        type: "android.widget.Button",
      },
    ],
    [...advisory, { bundleId: "ai.x.grok", type: "android.app.Dialog", label: "Sign in" }],
  ];
  for (const nodes of variants)
    assert.notEqual(identity(nodes).fingerprint, identity(advisory).fingerprint);
});

test("Home identity needs unique enabled owned controls and complete header/composer", () => {
  for (const label of [
    "Ask",
    "Imagine",
    "Build",
    "Private Chat",
    "Show navigation drawer",
    "Launch gallery selector",
    "Ask anything",
    "Start dictation",
    "Start Grok Voice",
  ]) {
    const missing = advisory.filter((node) => node.label !== label);
    assert.equal(nativeHomeIdentityNodes(missing, "ai.x.grok"), undefined, label);
    const disabled = advisory.map((node) =>
      node.label === label ? { ...node, enabled: false } : node,
    );
    assert.equal(nativeHomeIdentityNodes(disabled, "ai.x.grok"), undefined, label);
  }
  const duplicate = [
    ...advisory,
    { ...advisory.find((node) => node.label === "Ask")!, index: 999 },
  ];
  assert.equal(nativeHomeIdentityNodes(duplicate, "ai.x.grok"), undefined);
  assert.equal(
    observeScreenIdentity(advisory).nodes.some((node) =>
      node.label?.startsWith("grok is experiencing"),
    ),
    true,
    "generic maps retain every notice",
  );
});
