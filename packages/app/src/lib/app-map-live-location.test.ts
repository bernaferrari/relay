import assert from "node:assert/strict";
import test from "node:test";
import {
  applicationIdsMatch,
  expectedAndroidApplicationId,
  matchLiveScreen,
} from "./app-map-live-location";

const settings = {
  id: "settings",
  identity: {
    fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    aliases: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
  },
};
const appearance = {
  id: "appearance",
  identity: {
    fingerprint: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  },
};

test("no live fingerprint is none, not unknown", () => {
  assert.deepEqual(matchLiveScreen([settings, appearance]), { kind: "none" });
  assert.deepEqual(matchLiveScreen([settings], ""), { kind: "none" });
});

test("an exact fingerprint lights exactly one screen", () => {
  assert.deepEqual(matchLiveScreen([settings, appearance], settings.identity.fingerprint), {
    kind: "here",
    screenId: "settings",
  });
});

test("an approved alias is the same screen", () => {
  assert.deepEqual(matchLiveScreen([settings, appearance], settings.identity.aliases[0]), {
    kind: "here",
    screenId: "settings",
  });
});

test("a 16-char summary still matches the full fingerprint", () => {
  assert.deepEqual(matchLiveScreen([settings], settings.identity.fingerprint.slice(0, 16)), {
    kind: "here",
    screenId: "settings",
  });
});

test("an unmapped fingerprint is unknown, not a guess", () => {
  assert.deepEqual(
    matchLiveScreen(
      [settings, appearance],
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    ),
    { kind: "unknown" },
  );
});

test("two screens sharing a fingerprint stay unknown", () => {
  assert.deepEqual(
    matchLiveScreen(
      [settings, { id: "dup", identity: { fingerprint: settings.identity.fingerprint } }],
      settings.identity.fingerprint,
    ),
    { kind: "unknown" },
  );
});

test("a visual alias is a second vote when the tree fingerprint is missing", () => {
  assert.deepEqual(matchLiveScreen([settings, appearance], [null, settings.identity.aliases[0]]), {
    kind: "here",
    screenId: "settings",
  });
});

test("semantic and visual votes for the same screen stay here, not unknown", () => {
  assert.deepEqual(
    matchLiveScreen(
      [settings, appearance],
      [settings.identity.fingerprint, settings.identity.aliases[0]],
    ),
    { kind: "here", screenId: "settings" },
  );
});

test("the dominant package-qualified resource id identifies the mapped Android app", () => {
  assert.equal(
    expectedAndroidApplicationId([
      {
        observation: {
          nodes: [
            { identifier: "ai.x.grok:id/action_bar_root" },
            { identifier: "android:id/content" },
            { identifier: "ai.x.grok:id/settings" },
          ],
        },
      },
      { observation: { nodes: [{ identifier: "com.android.settings:id/title" }] } },
    ]),
    "ai.x.grok",
  );
  assert.equal(applicationIdsMatch("AI.X.GROK", "ai.x.grok"), true);
});
