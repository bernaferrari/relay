import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DiscoveryHereOption } from "./discovery-turn.js";
import { createDiscoverySession, patchDiscoveryScope, readDiscoverySession } from "./discovery.js";
import {
  cancelDiscoveryExplore,
  decideSoftRecover,
  defaultExploreDepth,
  isHardEdgeLabel,
  needsExploreGrounding,
  pickNextExploreOption,
  readDiscoveryExploreOutcome,
  resetDiscoveryExploreJobsForTests,
  resolveExploreMaxDepth,
  resolveExploreMode,
  resolveExploreStrategy,
  scoreExploreOption,
  startDiscoveryExplore,
} from "./discovery-explore-job.js";

function option(
  partial: Partial<DiscoveryHereOption> & Pick<DiscoveryHereOption, "id" | "label">,
): DiscoveryHereOption {
  return {
    opened: false,
    target: { label: partial.label },
    ...partial,
  };
}

test("defaultExploreDepth matches  strategy names", () => {
  assert.equal(defaultExploreDepth("surface"), 2);
  assert.equal(defaultExploreDepth("journey"), 6);
  assert.equal(defaultExploreDepth("hard-edges"), 4);
});

test("resolveExploreStrategy prefers start options over scope", () => {
  assert.equal(
    resolveExploreStrategy({ maxScreens: 1, maxTransitions: 1, maxDurationMs: 1 }),
    "surface",
  );
  assert.equal(
    resolveExploreStrategy(
      { maxScreens: 1, maxTransitions: 1, maxDurationMs: 1, strategy: "journey" },
      { strategy: "hard-edges" },
    ),
    "hard-edges",
  );
  assert.equal(
    resolveExploreStrategy({
      maxScreens: 1,
      maxTransitions: 1,
      maxDurationMs: 1,
      strategy: "journey",
    }),
    "journey",
  );
});

test("resolveExploreMode defaults to semantic; model stays available", () => {
  assert.equal(
    resolveExploreMode({ maxScreens: 1, maxTransitions: 1, maxDurationMs: 1 }),
    "semantic",
  );
  assert.equal(
    resolveExploreMode(
      { maxScreens: 1, maxTransitions: 1, maxDurationMs: 1, mode: "semantic" },
      { mode: "model" },
    ),
    "model",
  );
});

test("resolveExploreMaxDepth uses strategy default when scope omits maxDepth", () => {
  const scope = { maxScreens: 10, maxTransitions: 10, maxDurationMs: 60_000 };
  assert.equal(resolveExploreMaxDepth("surface", scope), 2);
  assert.equal(resolveExploreMaxDepth("journey", scope, { maxDepth: 3 }), 3);
});

test("hard-edge labels prefer settings and permissions-like copy", () => {
  assert.equal(isHardEdgeLabel("App Permissions"), true);
  assert.equal(isHardEdgeLabel("Empty state"), true);
  assert.equal(isHardEdgeLabel("Ask"), false);
});

test("needsExploreGrounding flags Menu and unlabeled point targets", () => {
  assert.equal(
    needsExploreGrounding({ label: "Menu", target: { point: { x: 12, y: 40 }, label: "Menu" } }),
    true,
  );
  assert.equal(
    needsExploreGrounding({ label: "Appearance", target: { label: "Appearance" } }),
    false,
  );
  assert.equal(
    needsExploreGrounding({ label: "Private", target: { point: { x: 1, y: 2 } } }),
    true,
  );
});

test("pickNextExploreOption skips opened and prefers semantic / hard-edges", () => {
  const options: DiscoveryHereOption[] = [
    option({ id: "a", label: "Imagine", opened: true }),
    option({ id: "b", label: "Random Row" }),
    option({ id: "c", label: "Menu" }),
    option({ id: "d", label: "App Permissions" }),
  ];
  const surface = pickNextExploreOption(options, "surface");
  assert.equal(surface?.id, "c");

  const hard = pickNextExploreOption(options, "hard-edges");
  assert.equal(hard?.id, "d");

  assert.equal(
    pickNextExploreOption(
      options.filter((item) => item.opened),
      "surface",
    ),
    null,
  );
});

test("scoreExploreOption ranks hard-edges above generic rows", () => {
  const permission = option({ id: "p", label: "Permissions" });
  const chat = option({ id: "c", label: "Start chatting" });
  assert.ok(scoreExploreOption(permission, "hard-edges") > scoreExploreOption(chat, "hard-edges"));
  assert.equal(
    scoreExploreOption({ ...permission, opened: true }, "surface"),
    Number.NEGATIVE_INFINITY,
  );
});

test("decideSoftRecover allows one attempt then stops with left_app", () => {
  assert.equal(
    decideSoftRecover({
      originApp: "ai.x.grok",
      foregroundApp: "ai.x.grok",
      softRecoveries: 0,
    }),
    "ok",
  );
  assert.equal(
    decideSoftRecover({
      originApp: "ai.x.grok",
      foregroundApp: "com.android.settings",
      softRecoveries: 0,
    }),
    "attempt_recover",
  );
  assert.equal(
    decideSoftRecover({
      originApp: "ai.x.grok",
      foregroundApp: "com.android.settings",
      softRecoveries: 1,
    }),
    "left_app",
  );
});

test("patchDiscoveryScope stores explore strategy fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-explore-scope-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const session = await createDiscoverySession({
      id: "explore-scope",
      name: "Scope",
      targetId: "phone",
    });
    const patched = await patchDiscoveryScope(session.id, {
      strategy: "journey",
      mode: "model",
      maxDepth: 5,
    });
    assert.equal(patched.scope.strategy, "journey");
    assert.equal(patched.scope.mode, "model");
    assert.equal(patched.scope.maxDepth, 5);
    assert.equal((await readDiscoverySession(session.id))?.scope.strategy, "journey");
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("createDiscoverySession rejects unknown explore strategy", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-explore-bad-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    await assert.rejects(
      () =>
        createDiscoverySession({
          id: "bad-strat",
          name: "Bad",
          targetId: "phone",
          scope: { strategy: "warp-speed" as "surface" },
        }),
      /invalid discovery explore strategy/,
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("startDiscoveryExplore refuses without App Map", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-explore-start-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  resetDiscoveryExploreJobsForTests();
  try {
    const bare = await createDiscoverySession({
      id: "explore-bare",
      name: "Bare",
      targetId: "phone",
    });
    await assert.rejects(() => startDiscoveryExplore(bare.id), /App Map to register screens/);
  } finally {
    resetDiscoveryExploreJobsForTests();
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("startDiscoveryExplore applies strategy options onto a mapped session", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-explore-opts-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  resetDiscoveryExploreJobsForTests();
  try {
    const session = await createDiscoverySession({
      id: "explore-opts",
      name: "With map",
      targetId: "phone-no-device",
      agent: {
        workerId: "w1",
        appMapId: "map-1",
        goal: "Map settings surface",
        provider: "relay",
        source: "cli",
      },
    });

    const started = await startDiscoveryExplore(session.id, {
      strategy: "hard-edges",
      mode: "model",
      maxDepth: 3,
    });
    assert.equal(started.status, "running");
    assert.equal(started.scope.strategy, "hard-edges");
    assert.equal(started.scope.mode, "model");
    assert.equal(started.scope.maxDepth, 3);
    assert.equal(readDiscoveryExploreOutcome(session.id)?.strategy, "hard-edges");

    await cancelDiscoveryExplore(session.id);
    assert.equal((await readDiscoverySession(session.id))?.status, "stopped");
    assert.equal(readDiscoveryExploreOutcome(session.id)?.stopReason?.code, "cancelled");
    // Give the yielded job a tick to observe cancel without touching a device.
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    resetDiscoveryExploreJobsForTests();
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
