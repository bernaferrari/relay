import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { renderHelp } from "./help.js";
import { parseOutcomeCliIntent } from "./outcome-command.js";
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
        "recording-ref",
        "v4",
        "merge",
        "tap-menu,tap-settings",
        "Open Settings",
      ]),
      expected: {
        kind: "edit-recording",
        ref: "recording-ref",
        expectedVersion: "v4",
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
      input: tokens(["continue-repeat", "workflow-ref", "v2"], {}, ["--confirm"]),
      expected: {
        kind: "continue-repeat",
        ref: "workflow-ref",
        expectedVersion: "v2",
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
      input: tokens(["export-evidence", "run-1"]),
      expected: { kind: "export-evidence", runId: "run-1" },
    },
  ] as const;

  for (const testCase of cases) {
    assert.deepEqual(parseOutcomeCliIntent(testCase.input), testCase.expected);
  }
});

test("outcome CLI help describes its bounded implicit daemon behavior", () => {
  const help = renderHelp();
  assert.match(help, /Outcome commands start or reuse the default loopback Relay daemon/u);
  assert.match(help, /Explicit server URLs remain caller-managed/u);
  assert.match(help, /App, Device, Test, Checkpoint, Run, and Report/u);
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

test("report emit accepts only its documented github-check format", async () => {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  await assert.rejects(
    runReportCommand(["report", "emit", "--format", "github-check"], streams, {}),
    /requires --run/u,
  );
  await assert.rejects(
    runReportCommand(["report", "emit", "--format=yaml", "--run", "missing"], streams, {}),
    /only "github-check"/u,
  );
});
