import assert from "node:assert/strict";
import test from "node:test";
import { graphTest } from "./app-map-test-operation-schemas.js";
import {
  BROWSER_LANE_ISOLATION_NOTE,
  leftoverContradictedFacts,
  leftoverContradictsFact,
  MUTATING_ROUTINE_PRESETS,
  mutatingWorkMayShare,
  STARTING_STATE_ROUTINE_PRESETS,
  effectiveSharingPolicy,
} from "./routine-effects.js";

test("leftover Settings/sidebar/Private Chat/signed-out block claiming Home", () => {
  for (const leftover of ["settings", "sidebar", "private-chat", "signed-out"] as const) {
    assert.equal(leftoverContradictsFact([leftover], "home-visible"), true, leftover);
  }
  assert.equal(leftoverContradictsFact(["settings"], "menu-closed"), true);
  assert.equal(leftoverContradictsFact(["signed-out"], "known-account"), true);
  assert.equal(leftoverContradictsFact(["conversation-deleted"], "owned-conversation-available"), true);
  assert.equal(leftoverContradictsFact(["prefs-mutated"], "language-theme-established"), true);
  assert.deepEqual(leftoverContradictedFacts([]), []);
});

test("home-chrome preset does not invent leftover Settings", () => {
  assert.deepEqual(STARTING_STATE_ROUTINE_PRESETS["home-chrome"].establishes, [
    "home-visible",
    "menu-closed",
    "composer-empty",
  ]);
  assert.equal("leftover" in STARTING_STATE_ROUTINE_PRESETS["home-chrome"], false);
});

test("sign-out / delete / pref-change / interrupt default to fail-closed sharing", () => {
  for (const id of ["sign-out", "delete-conversation", "change-prefs", "interrupt"] as const) {
    const effects = MUTATING_ROUTINE_PRESETS[id];
    assert.equal(effectiveSharingPolicy(effects), "fail-closed");
    assert.equal(effects.accountIsolation, "browser-lane-only");
    assert.equal(effects.accountIsolationNote, BROWSER_LANE_ISOLATION_NOTE);
  }
});

test("browser Lane isolation is not server-side account isolation", () => {
  const signOut = MUTATING_ROUTINE_PRESETS["sign-out"];
  const left = { testId: "sign-out", accountId: "grok-lab", laneId: "grok-lab" };
  const otherLane = { testId: "home", accountId: "grok-lab", laneId: "grok-daily-b" };
  const otherAccount = { testId: "home", accountId: "disposable-b", laneId: "grok-lab" };
  assert.equal(mutatingWorkMayShare(signOut, left, otherLane), false);
  assert.equal(
    mutatingWorkMayShare({ ...signOut, sharing: "isolated-lane" }, left, otherLane),
    false,
  );
  assert.equal(
    mutatingWorkMayShare({ ...signOut, sharing: "isolated-account" }, left, otherAccount),
    true,
  );
  assert.match(signOut.accountIsolationNote, /not server-side account isolation/u);
});

test("graph Test startingState is part of the existing Test schema", () => {
  assert.doesNotThrow(() =>
    graphTest.parse({
      name: "Home chrome",
      kind: "scenario",
      intentSchemaVersion: 1,
      startingState: {
        requires: ["known-account", "home-visible"],
        sourceScreenId: "home",
      },
      steps: [
        {
          id: "open",
          intent: "Stay on Home",
          kind: "module",
          binding: { status: "resolved", kind: "routine", routineId: "home-chrome" },
        },
      ],
    }),
  );
  assert.throws(
    () =>
      graphTest.parse({
        name: "Bad leftover",
        kind: "scenario",
        intentSchemaVersion: 1,
        startingState: { leftover: ["grok-settings-invented"] },
        steps: [
          {
            id: "open",
            intent: "Stay on Home",
            kind: "module",
            binding: { status: "resolved", kind: "routine", routineId: "home-chrome" },
          },
        ],
      }),
    /leftover/u,
  );
});
