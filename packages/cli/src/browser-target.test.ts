import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { RunTestSnapshot } from "@relay/workflows";
import { runCiCommand } from "./ci-command.js";
import { ExitCode } from "./errors.js";
import { resolveDevice } from "./everyday-names.js";
import { parseEverydayCommand } from "./everyday-commands.js";
import { resolveOutcomeNames } from "./outcome-runner.js";
import { CliOutput } from "./output.js";

function browserRow(id: string) {
  return { id, serial: id, name: id, platform: "browser", booted: true };
}

test("browser resolution creates one ephemeral managed browser from the test URL when none exists", async () => {
  const calls: Array<{ id: string; input: unknown }> = [];
  const invoke = async (id: string, input: Record<string, unknown>) => {
    calls.push({ id, input });
    if (id === "target.devices.list") return { devices: [] };
    if (id === "target.create") {
      return { target: { id: "browser-local", kind: "browser" } };
    }
    throw new Error(`unexpected ${id}`);
  };
  const targetId = await resolveDevice(invoke, "browser", {
    browserStartUrl: "http://127.0.0.1:5173/app",
  });
  assert.equal(targetId, "browser-local");
  assert.deepEqual(calls[1], {
    id: "target.create",
    input: {
      name: "Relay browser (127.0.0.1:5173)",
      startUrl: "http://127.0.0.1:5173/app",
      headless: true,
      profileRetention: "ephemeral",
    },
  });
});

test("browser resolution reuses one existing browser and still refuses ambiguity", async () => {
  const calls: string[] = [];
  const invoke = async (id: string) => {
    calls.push(id);
    if (id === "target.devices.list") return { devices: [browserRow("browser-existing")] };
    throw new Error(`unexpected ${id}`);
  };
  assert.equal(
    await resolveDevice(invoke, "browser", { browserStartUrl: "http://127.0.0.1:5173/" }),
    "browser-existing",
  );
  assert.deepEqual(calls, ["target.devices.list"]);

  const ambiguous = async (id: string) => {
    if (id === "target.devices.list") return { devices: [browserRow("one"), browserRow("two")] };
    throw new Error(`unexpected ${id}`);
  };
  await assert.rejects(
    resolveDevice(ambiguous, "browser", { browserStartUrl: "http://127.0.0.1:5173/" }),
    /2 browser devices are connected/u,
  );
});

test("relay ci accepts --confirm and forwards once-per-run risk consent", async () => {
  assert.deepEqual(parseEverydayCommand(["ci", "--confirm"]), { verb: "ci", args: [] });
  let seen: { confirmRisk?: true } | undefined;
  const appMap = {
    id: "shop-web",
    name: "Shop",
    screens: {},
    connections: {},
    tests: {
      smoke: {
        id: "smoke",
        name: "Home page loads",
        kind: "scenario",
        intentSchemaVersion: 1,
        startUrl: "http://127.0.0.1:5173/",
        createdAt: 1,
        updatedAt: 1,
        steps: [
          {
            id: "check",
            kind: "validation",
            intent: "The home page renders",
            binding: { status: "unresolved", reason: "Runs from text", fromText: true },
          },
        ],
      },
    },
  };
  const invoke = async (id: string, _input?: Record<string, unknown>) => {
    if (id === "app-map.list") return { appMaps: [appMap] };
    if (id === "target.devices.list") return { devices: [browserRow("browser-existing")] };
    if (id === "run.verdict.get") {
      return {
        verdict: {
          runId: "run-smoke",
          title: "Home page loads",
          status: "passed",
          summary: "Passed",
          durationMs: 1,
          steps: [],
        },
      };
    }
    throw new Error(`unexpected ${id}`);
  };
  const settled: RunTestSnapshot = {
    schemaVersion: 1,
    kind: "run-test",
    title: "Home page loads",
    phase: "succeeded",
    version: "v1",
    progress: { label: "Done" },
    allowedNextActions: [],
    problems: [],
    execution: { jobId: "job-smoke", runId: "run-smoke" },
    evidenceRefs: [],
  };
  const result = await runCiCommand({
    options: { tests: ["smoke"], confirmRisk: true },
    client: { invoke, events: async () => {} },
    invoke: (id, input) => invoke(id, input),
    actorId: "human:test",
    env: {},
    output: new CliOutput("json", true, { stdout: new PassThrough(), stderr: new PassThrough() }),
    human: false,
    signal: new AbortController().signal,
    pollIntervalMs: 1,
    runTest: async (input) => {
      seen = input;
      return settled;
    },
  });
  assert.equal(seen?.confirmRisk, true);
  assert.equal(result.exitCode, ExitCode.success);
});

test("run-test resolution feeds the saved Test URL into managed browser creation", async () => {
  const created: unknown[] = [];
  const invoke = async (id: string, input: Record<string, unknown>) => {
    if (id === "app-map.list") {
      return {
        appMaps: [
          {
            id: "shop-web",
            name: "Shop",
            screens: {},
            connections: {},
            tests: {
              smoke: {
                id: "smoke",
                name: "Home page loads",
                kind: "scenario",
                startUrl: "http://127.0.0.1:5173/",
                steps: [],
              },
            },
          },
        ],
      };
    }
    if (id === "target.devices.list") return { devices: [] };
    if (id === "target.create") {
      created.push(input);
      return { target: { id: "browser-created", kind: "browser" } };
    }
    throw new Error(`unexpected ${id}`);
  };
  const resolved = await resolveOutcomeNames(
    { kind: "run-test", testId: "Home page loads", targetId: "browser" },
    invoke,
    {},
  );
  assert.equal((resolved as { targetId?: string }).targetId, "browser-created");
  assert.equal(created.length, 1);
});
