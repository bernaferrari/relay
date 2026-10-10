import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { renderHelp } from "./help.js";
import { parseOutcomeCliIntent } from "./outcome-command.js";
import type { GoalSessionCancelIntent, GoalSessionStartIntent } from "@relay/workflows";
import { runReportCommand } from "./report-commands.js";

function tokens(
  positionals: string[],
  values: Record<string, string> = {},
  switches: string[] = [],
) {
  return {
    positionals,
    values: new Map(Object.entries(values)),
    switches: new Set(switches),
  };
}

test("every outcome CLI command maps named arguments to one workflow intent", () => {
  const cases = [
    {
      input: tokens(["connect", "pixel-9"]),
      expected: { kind: "connect-target", targetId: "pixel-9" },
    },
    {
      input: tokens(["observe", "pixel-9"]),
      expected: { kind: "observe-target", targetId: "pixel-9" },
    },
    {
      input: tokens(
        ["explore"],
        { "--url": "https://example.test", "--goal": "Reach settings", "--max-steps": "3" },
        ["--confirm"],
      ),
      expected: {
        kind: "goal-explore",
        startUrl: "https://example.test",
        goal: "Reach settings",
        maxSteps: 3,
      },
    },
    {
      input: tokens(
        ["explore"],
        {
          "--url": "https://example.test",
          "--goal": "Reach settings",
          "--agents": "4",
          "--judge": "jev",
        },
        ["--confirm"],
      ),
      expected: {
        kind: "goal-explore",
        startUrl: "https://example.test",
        goal: "Reach settings",
        agents: 4,
      },
    },
    {
      input: tokens(["goal", "resume", "goal-123"], {}, ["--confirm"]),
      expected: { kind: "goal-resume", sessionId: "goal-123" },
    },
    {
      input: tokens(["goal", "inspect", "goal-123"]),
      expected: { kind: "goal-inspect", sessionId: "goal-123" },
    },
    {
      input: tokens(["goal", "reproduce", "goal-123"], {}, ["--confirm"]),
      expected: { kind: "goal-reproduce", sessionId: "goal-123" },
    },
    {
      input: tokens(
        ["goal", "promote", "goal-123"],
        { "--map": "checkout", "--title": "Empty cart regression" },
        ["--confirm"],
      ),
      expected: {
        kind: "goal-promote",
        sessionId: "goal-123",
        appMapId: "checkout",
        title: "Empty cart regression",
        confirmControl: true,
      },
    },
    {
      input: tokens(["explore"], { "--resume": "explore-123" }, ["--confirm"]),
      expected: { kind: "goal-explore-resume", explorationId: "explore-123" },
    },
    {
      input: tokens(["explore"], { "--inspect": "explore-123" }),
      expected: { kind: "goal-explore-inspect", explorationId: "explore-123" },
    },
    {
      input: tokens(
        ["record", "Settings localization"],
        { "--map": "settings", "--device": "ipad" },
        ["--confirm"],
      ),
      expected: {
        kind: "record-test",
        appMapId: "settings",
        title: "Settings localization",
        confirmControl: true,
        targetId: "ipad",
      },
    },
    {
      input: tokens([
        "edit-recording",
        "recording-workflow",
        "4",
        "merge",
        "tap-menu,tap-settings",
        "Open Settings",
      ]),
      expected: {
        kind: "edit-recording",
        workflowId: "recording-workflow",
        expectedVersion: 4,
        edit: {
          kind: "merge",
          actionIds: ["tap-menu", "tap-settings"],
          intent: "Open Settings",
        },
      },
    },
    {
      input: tokens(["run", "smoke"], { "--map": "checkout", "--device": "pixel-9" }),
      expected: {
        kind: "run-test",
        appMapId: "checkout",
        testId: "smoke",
        targetId: "pixel-9",
      },
    },
    {
      input: tokens(["repeat", "locale-smoke"], {
        "--map": "settings",
        "--device": "ipad",
        "--in": "language=ja,pt-BR",
        "--lens": "visual",
      }),
      expected: {
        kind: "repeat-test",
        appMapId: "settings",
        testId: "locale-smoke",
        repeat: { dimensions: [{ id: "language", values: ["ja", "pt-BR"] }] },
        evidence: "visual",
        targetId: "ipad",
      },
    },
    {
      input: tokens(["continue-repeat", "workflow-id", "2"], {}, ["--confirm"]),
      expected: {
        kind: "continue-repeat",
        workflowId: "workflow-id",
        expectedVersion: 2,
        confirmRemaining: true,
      },
    },
    {
      input: tokens(["inspect-failure", "run-1"]),
      expected: { kind: "inspect-failure", runId: "run-1" },
    },
    {
      input: tokens(["propose-repair", "run-1", "check-2", "disable", "Known animation"]),
      expected: {
        kind: "propose-repair",
        runId: "run-1",
        checkId: "check-2",
        proposal: "disable",
        reason: "Known animation",
      },
    },
    {
      input: tokens(["export", "run-1"]),
      expected: { kind: "export-evidence", runId: "run-1" },
    },
    {
      input: tokens(["replay-lab", "all", "oldest.json", "newest.json"]),
      expected: {
        kind: "replay-lab",
        analysis: "all",
        paths: ["oldest.json", "newest.json"],
      },
    },
    {
      input: tokens(["proof", "analyze", "run", "run-1", "run-2"]),
      expected: {
        kind: "proof-analyze",
        selection: { kind: "runs", runIds: ["run-1", "run-2"] },
      },
    },
    {
      input: tokens(["proof", "analyze", "revision", "abcdef0"]),
      expected: {
        kind: "proof-analyze",
        selection: { kind: "source-revision", sourceRevision: { vcs: "git", sha: "abcdef0" } },
      },
    },
  ] as const;

  for (const testCase of cases) {
    assert.deepEqual(parseOutcomeCliIntent(testCase.input), testCase.expected);
  }
  // Retired spellings no longer parse as outcome commands.
  for (const retired of [
    ["export-evidence", "run-1"],
    ["inspect-workflow", "workflow-1"],
    ["verify-change", "run", "run-1"],
  ]) {
    assert.equal(parseOutcomeCliIntent(tokens(retired)), undefined, retired.join(" "));
  }
});

test("outcome CLI help describes its bounded implicit daemon behavior", () => {
  const help = renderHelp("advanced");
  assert.match(help, /Outcome commands start or reuse the default loopback Relay daemon/u);
  assert.match(help, /Explicit server URLs remain caller-managed/u);
  assert.doesNotMatch(help, /An App Map is screens and paths/u);
  assert.doesNotMatch(help, /does not start a server automatically/u);
});

test("Repeat flags produce the canonical ordered multi-dimensional specification", () => {
  assert.deepEqual(
    parseOutcomeCliIntent(
      tokens(["repeat", "release-smoke"], {
        "--each": "language=supported\u0000theme=light,dark",
        "--strategy": "pairwise",
        "--pilot": "language=pt-BR,theme=dark",
        "--resume": "untouched",
      }),
    ),
    {
      kind: "repeat-test",
      testId: "release-smoke",
      repeat: {
        dimensions: [
          { id: "language", values: "supported" },
          { id: "theme", values: ["light", "dark"] },
        ],
        strategy: "pairwise",
        pilot: { mode: "specified", case: { language: "pt-BR", theme: "dark" } },
        resume: "untouched",
      },
    },
  );
});

test("Run risk consent is explicit and does not affect safe Runs by default", () => {
  assert.deepEqual(parseOutcomeCliIntent(tokens(["run", "checkout"], {}, ["--confirm"])), {
    kind: "run-test",
    testId: "checkout",
    confirmRisk: true,
  });
  assert.deepEqual(parseOutcomeCliIntent(tokens(["run", "checkout"])), {
    kind: "run-test",
    testId: "checkout",
  });
});

test("Repeat CLI rejects ambiguous or malformed dimension policies", () => {
  assert.throws(
    () =>
      parseOutcomeCliIntent(
        tokens(["repeat", "smoke"], {
          "--each": "language=supported",
          "--in": "language=en",
        }),
      ),
    /accepts --each or compatible --in/u,
  );
  assert.throws(
    () =>
      parseOutcomeCliIntent(
        tokens(["repeat", "smoke"], {
          "--each": "language=en\u0000language=it",
        }),
      ),
    /name each dimension once/u,
  );
});

test("proof report accepts only its documented github-check format", async () => {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  await assert.rejects(
    runReportCommand(["proof", "report", "--format", "github-check"], streams, {}),
    /requires --run/u,
  );
  await assert.rejects(
    runReportCommand(["proof", "report", "--format=yaml", "--run", "missing"], streams, {}),
    /only "github-check"/u,
  );
});

test("goal cancel parses with explicit confirmation only", () => {
  const cancelled = parseOutcomeCliIntent(
    tokens(["goal", "cancel", "goal-1"], {}, ["--confirm"]),
  ) as GoalSessionCancelIntent;
  assert.equal(cancelled.kind, "goal-cancel");
  assert.equal(cancelled.sessionId, "goal-1");
  assert.throws(() => parseOutcomeCliIntent(tokens(["goal", "cancel", "goal-1"])));
});

test("goal start carries plain task values; explore carries distinct missions", () => {
  const start = parseOutcomeCliIntent(
    tokens(
      ["goal", "run"],
      {
        "--url": "https://example.test",
        "--goal": "Sign in",
        "--value": "username=member@example.test\u0000note=hello",
      },
      ["--confirm"],
    ),
  ) as GoalSessionStartIntent;
  assert.equal(start.kind, "goal-start");
  assert.deepEqual(start.values, {
    username: "member@example.test",
    note: "hello",
  });

  const explore = parseOutcomeCliIntent(
    tokens(
      ["explore"],
      {
        "--url": "https://example.test",
        "--goal": "Explore the app",
        "--mission": "Member permissions\u0000Back-navigation behavior",
      },
      ["--confirm"],
    ),
  ) as { kind: "goal-explore"; missions?: string[] };
  assert.deepEqual(explore.missions, ["Member permissions", "Back-navigation behavior"]);

  assert.throws(() =>
    parseOutcomeCliIntent(
      tokens(
        ["goal", "run"],
        { "--url": "https://example.test", "--goal": "x", "--value": "novalue" },
        ["--confirm"],
      ),
    ),
  );
  assert.throws(() =>
    parseOutcomeCliIntent(
      tokens(
        ["goal", "run"],
        { "--url": "https://example.test", "--goal": "x", "--mission": "m" },
        ["--confirm"],
      ),
    ),
  );
});
