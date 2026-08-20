import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCompiledTest } from "@relay/protocol";
import {
  appMapTestCheckpointOptions,
  appMapTestPlanRelaunchCount,
  appMapTestStartupCopy,
  sameAppMapTestStartup,
  type AppMapTestStartupScreenSource,
} from "./app-map-test-startup-policy";

test("startup policy exposes only named identity checkpoints and reports saved relaunches", () => {
  const map = {
    screens: {
      anonymous: { id: "anonymous", title: "Anonymous" },
      settings: {
        id: "settings",
        title: "Settings",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
      },
      account: {
        id: "account",
        title: "Account",
        identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
      },
    },
  } satisfies AppMapTestStartupScreenSource;
  assert.deepEqual(appMapTestCheckpointOptions(map), [
    { screenId: "account", label: "Account" },
    { screenId: "settings", label: "Settings" },
  ]);

  const plan = {
    rootRecipeId: "root",
    recipes: {
      root: {
        id: "root",
        title: "Root",
        parameters: [],
        steps: [
          { kind: "module", recipeId: "setup" },
          { kind: "app", action: "open", app: "com.example.current", relaunch: false },
        ],
      },
      setup: {
        id: "setup",
        title: "Setup",
        parameters: [],
        steps: [
          { kind: "app", action: "open", app: "com.example.app" },
          { kind: "app", action: "open", app: "com.example.other", relaunch: true },
        ],
      },
      "review-only-cold-recovery": {
        id: "review-only-cold-recovery",
        title: "Review-only recovery",
        parameters: [],
        steps: [{ kind: "app", action: "open", app: "com.example.review", relaunch: true }],
      },
    },
  } satisfies Pick<AppMapCompiledTest, "rootRecipeId" | "recipes">;
  assert.equal(appMapTestPlanRelaunchCount(plan), 2);

  const copy = appMapTestStartupCopy({
    startup: { mode: "verified-checkpoint", screenId: "settings" },
    screenTitle: "Settings",
    relaunchCount: 0,
  });
  assert.equal(copy.label, "Verified checkpoint · Settings");
  assert.match(copy.detail, /stops for review/u);
  assert.match(copy.detail, /no app relaunch/u);
  assert.match(copy.retryDetail, /never converts this checkpoint into a cold retry/u);
  assert.equal(
    sameAppMapTestStartup(
      { mode: "verified-checkpoint", screenId: "settings" },
      { mode: "verified-checkpoint", screenId: "settings" },
    ),
    true,
  );
  assert.equal(
    sameAppMapTestStartup({ mode: "verified-checkpoint", screenId: "settings" }, { mode: "cold" }),
    false,
  );
});
