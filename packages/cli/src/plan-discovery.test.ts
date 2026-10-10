import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { AppMap, AppMapCombine } from "@relay/protocol";
import { runCli } from "./index.js";
import { parseCli } from "./config.js";
import { ExitCode } from "./errors.js";

function fixture(): AppMap {
  const scope = {
    organizationId: "local",
    projectId: "project",
    appMapId: "grok",
    createdAt: 1,
    updatedAt: 2,
  };
  const plan: AppMapCombine = {
    ...scope,
    id: "prompt-checks",
    name: "Prompt checks",
    variableIds: ["prompts"],
    testIds: ["fast"],
    selected: { prompts: ["row-1", "row-2"] },
    strategy: "zip",
    cellRuntimeProfiles: [
      { testId: "fast", values: { prompts: "row-1" }, targetProfileId: "saved-ipad-profile" },
    ],
  };
  return {
    schemaVersion: 1,
    id: "grok",
    organizationId: "local",
    projectId: "project",
    name: "Grok",
    revision: 7,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
    variables: {
      prompts: {
        ...scope,
        id: "prompts",
        name: "Prompt values",
        kind: "custom",
        apply: { kind: "input", inputId: "public-prompts" },
        options: [
          { id: "row-1", value: "First prompt" },
          { id: "row-2", value: "Second prompt" },
        ],
      },
    },
    tests: {},
    combines: { "prompt-checks": plan, other: { ...plan, id: "other", name: "Other Plan" } },
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 2,
  };
}

async function command(argv: string[], response: unknown = { appMap: fixture() }) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let output = "";
  let error = "";
  stdout.on("data", (chunk) => (output += String(chunk)));
  stderr.on("data", (chunk) => (error += String(chunk)));
  const calls: unknown[] = [];
  const code = await runCli(argv, {
    streams: { stdout, stderr },
    createClient: () => ({
      invoke: async (operationId, input) => {
        calls.push({ operationId, input });
        return response;
      },
      events: async () => {},
    }),
    registerSignalHandlers: false,
    env: {},
  });
  return { code, calls, output, error };
}

function receipt(output: string) {
  const lines = output.trim().split("\n");
  assert.equal(lines.length, 1, "stdout contains one JSON receipt");
  return JSON.parse(lines[0]!);
}

test("Plan list uses canonical Combine discovery without target or job calls", async () => {
  const listed = await command(["plan", "list", "grok", "--input", '{"list":"tests"}', "--json"]);
  assert.equal(listed.code, ExitCode.success, listed.output);
  assert.deepEqual(listed.calls, [{ operationId: "app-map.get", input: { appMapId: "grok" } }]);
  const existing = await command(["combine", "list", "grok", "--json"]);
  assert.deepEqual(receipt(listed.output), receipt(existing.output));
  assert.deepEqual(
    receipt(listed.output).result.combines.map((plan: { id: string }) => plan.id),
    ["other", "prompt-checks"],
  );
  assert.doesNotMatch(listed.output, /screens|screenVariants|First prompt/u);
});

test("Plan get selects the exact saved definition and preserves its explicit setup IDs", async () => {
  const map = fixture();
  const before = structuredClone(map);
  const inspected = await command(
    [
      "plan",
      "get",
      "grok",
      "prompt-checks",
      "--input",
      '{"appMapId":"wrong-app","combineId":"other","planId":"other","list":"tests"}',
      "--json",
    ],
    { appMap: map },
  );
  assert.equal(inspected.code, ExitCode.success, inspected.output);
  assert.deepEqual(inspected.calls, [{ operationId: "app-map.get", input: { appMapId: "grok" } }]);
  assert.deepEqual(receipt(inspected.output).result, {
    appMapId: "grok",
    revision: 7,
    combine: map.combines["prompt-checks"],
  });
  assert.deepEqual(map, before);
  assert.doesNotMatch(inspected.output, /Other Plan|screenVariants/u);
});

test("unknown Plan get is a controlled failure after one read", async () => {
  const missing = await command(["plan", "get", "grok", "missing", "--json"]);
  assert.equal(missing.code, ExitCode.validation);
  assert.deepEqual(missing.calls, [{ operationId: "app-map.get", input: { appMapId: "grok" } }]);
  const failure = receipt(missing.output);
  assert.equal(failure.ok, false);
  assert.match(failure.error.message, /Unknown Plan: missing/u);
  assert.doesNotMatch(missing.output, /Prompt checks|First prompt/u);
});

test("Plan get refuses a response from another App", async () => {
  const map = fixture();
  map.id = "other-app";
  const inspected = await command(["plan", "get", "grok", "prompt-checks", "--json"], {
    appMap: map,
  });
  assert.equal(inspected.code, ExitCode.validation);
  assert.equal(receipt(inspected.output).ok, false);
  assert.doesNotMatch(inspected.output, /Prompt checks|First prompt/u);
});

test("Plan discovery requires explicit App and Plan IDs before any read", async () => {
  for (const argv of [
    ["plan", "list"],
    ["plan", "get", "grok"],
    ["plan", "preflight", "grok"],
  ]) {
    const invalid = await command([...argv, "--json"]);
    assert.equal(invalid.code, ExitCode.usage);
    assert.deepEqual(invalid.calls, []);
    assert.match(receipt(invalid.output).error.message, /requires/u);
  }
});

test("Plan preflight keeps canonical device/profile input and blockers without starting", async () => {
  const response = {
    preflight: {
      ok: false,
      appMapId: "grok",
      combineId: "prompt-checks",
      blockers: [{ code: "missing-capture", message: "Capture the starting screen" }],
    },
  };
  const input = '{"serial":"ipad","targetProfileId":"saved-ipad-profile"}';
  const preview = await command(
    ["plan", "preflight", "grok", "prompt-checks", "--input", input, "--json"],
    response,
  );
  assert.equal(preview.code, ExitCode.success, preview.output);
  assert.deepEqual(preview.calls, [
    {
      operationId: "app-map.combine.preflight",
      input: {
        serial: "ipad",
        targetProfileId: "saved-ipad-profile",
        appMapId: "grok",
        combineId: "prompt-checks",
      },
    },
  ]);
  const existing = await command(
    ["combine", "preflight", "grok", "prompt-checks", "--input", input, "--json"],
    response,
  );
  assert.deepEqual(receipt(preview.output), receipt(existing.output));
  assert.equal(receipt(preview.output).result.preflight.ok, false);
});

test("everyday and Plan help show the same required identifiers and read-only discovery", async () => {
  const root = await command(["help", "advanced"]);
  const plan = await command(["plan", "--help"]);
  for (const help of [root, plan]) {
    assert.equal(help.code, ExitCode.success);
    assert.deepEqual(help.calls, []);
    assert.match(help.output, /relay plan list <appMapId>/u);
    assert.match(help.output, /relay plan get <appMapId> <planId>/u);
    assert.match(help.output, /relay plan preflight <appMapId> <planId>/u);
    assert.match(help.output, /relay plan run <appMapId> <planId>/u);
    assert.doesNotMatch(help.output, /relay plan run <planId>/u);
  }
});

test("Plan run remains the existing pilot command with canonical Combine IDs", () => {
  const parsed = parseCli(["plan", "run", "grok", "prompt-checks", "--no-wait"], {});
  assert.equal(parsed.command, "invoke");
  if (parsed.command !== "invoke") return;
  assert.equal(parsed.operationId, "job.combine.start");
  assert.deepEqual(parsed.input, {
    executionMode: "pilot",
    appMapId: "grok",
    combineId: "prompt-checks",
  });
});
