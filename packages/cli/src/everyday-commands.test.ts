import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { RunTestSnapshot } from "@relay/workflows";
import { ciExitCode, ciTotals, runCiCommand } from "./ci-command.js";
import { parseCli } from "./config.js";
import { CliError, ExitCode, UsageError } from "./errors.js";
import { formatListResult, formatVerdict, type Verdict } from "./everyday-format.js";
import { runCli } from "./index.js";
import type { OperationInvoker } from "./invoke.js";
import { resolveOutcomeNames, verdictExitCode } from "./outcome-runner.js";
import { CliOutput } from "./output.js";

function capture() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk) => (out += String(chunk)));
  stderr.on("data", (chunk) => (err += String(chunk)));
  return { streams: { stdout, stderr }, stdout: () => out, stderr: () => err };
}

function words(id: string, name: string, steps: string[]) {
  return {
    id,
    name,
    kind: "scenario",
    intentSchemaVersion: 1,
    startUrl: "https://shop.example.com",
    createdAt: 1,
    updatedAt: 2,
    steps: steps.map((intent, index) => ({
      id: `${id}-${index}`,
      kind: index === steps.length - 1 ? "validation" : "instruction",
      intent,
      binding: { status: "unresolved", reason: "Runs from its description.", fromText: true },
    })),
  };
}

function shopMap() {
  return {
    id: "shop-web",
    name: "Shop",
    revision: 3,
    updatedAt: Date.now() - 3_600_000,
    screens: {},
    screenVariants: {},
    connections: {},
    tests: {
      "test-checkout": words("test-checkout", "Checkout works", ["Add a shirt", "Total is $20"]),
      "test-search": words("test-search", "Search finds shirts", ["Search shirt", "Shirts listed"]),
      "test-draft": { ...words("test-draft", "Refunds", []), steps: [] },
    },
  };
}

const devices = {
  devices: [
    { id: "pixel", serial: "emulator-5554", name: "Pixel 9", platform: "android", booted: true },
    { id: "ipad", serial: "ipad-1", name: "iPad Pro", platform: "ios", booted: true },
    { id: "iphone", serial: "iphone-1", name: "iPhone 18", platform: "ios", booted: true },
  ],
};

function fakeInvoke(calls: Array<{ id: string; input: unknown }> = []) {
  return async (id: string, input: Record<string, unknown>): Promise<unknown> => {
    calls.push({ id, input });
    if (id === "app-map.list")
      return { appMaps: [shopMap(), { ...shopMap(), id: "blog", name: "Blog", tests: {} }] };
    if (id === "target.devices.list") return devices;
    if (id === "run.verdict.get") return { verdict: verdictFor(String(input.runId)) };
    if (id === "test.create-from-goal") {
      return {
        appId: "shop-web",
        testId: "test-new",
        name: "Cart total",
        steps: [
          { kind: "action", text: "Add a shirt to the cart" },
          { kind: "check", text: "The total is $20" },
        ],
        source: "model",
        createdApp: false,
      };
    }
    if (id === "test.apply-yaml") {
      const yaml = String(input.yaml);
      const name = /name: (.+)/u.exec(yaml)?.[1] ?? "Unnamed";
      if (yaml.includes("bad"))
        throw new UsageError("Step 1 must be text, `check: …`, or `do: …`.");
      return {
        appId: "shop-web",
        testId: `file-${name.toLowerCase()}`,
        name,
        created: true,
        createdApp: false,
        keptRecorded: 0,
      };
    }
    if (id === "test.yaml.get")
      return {
        yaml: "name: Checkout works\nsteps:\n  - Add a shirt\n",
        appId: "shop-web",
        testId: "test-checkout",
      };
    throw new Error(`unexpected ${id}`);
  };
}

function verdictFor(runId: string): Verdict {
  const failed = runId === "run-test-checkout";
  return {
    runId,
    title: failed ? "Checkout works" : "Search finds shirts",
    status: failed ? "failed" : "passed",
    summary: failed ? "The total was wrong." : "Every step passed.",
    durationMs: 12_300,
    device: "Pixel 9",
    steps: [
      { id: "a", title: "Add a shirt", status: "passed" },
      {
        id: "b",
        title: "Total is $20",
        kind: "check",
        status: failed ? "failed" : "passed",
        ...(failed
          ? { expected: "Total is $20", saw: "Total is $25", screenshot: "/tmp/step.png" }
          : {}),
      },
    ],
  };
}

function clientFrom(invoke: ReturnType<typeof fakeInvoke>): OperationInvoker {
  return {
    invoke: (id, input) => invoke(id, input as Record<string, unknown>),
    events: async () => {},
  };
}

function settled(testId: string): RunTestSnapshot {
  return {
    schemaVersion: 1,
    kind: "run-test",
    title: testId,
    phase: "succeeded",
    version: "v1",
    progress: { label: "Done" },
    allowedNextActions: [],
    problems: [],
    execution: { jobId: `job-${testId}`, runId: `run-${testId}` },
    evidenceRefs: [],
  };
}

test("misspelled family subcommands suggest instead of running a Test or Device", () => {
  assert.throws(() => parseCli(["run", "lsit"], {}), /Did you mean 'relay run list'/u);
  assert.throws(() => parseCli(["connect", "lst"], {}), /Did you mean 'relay connect list'/u);
  // An exact subcommand with missing arguments is a usage error, never a Test named "watch".
  assert.throws(
    () => parseCli(["run", "watch"], {}),
    (error: unknown) => {
      assert.ok(error instanceof UsageError);
      assert.doesNotMatch(error.message, /Did you mean/u);
      return true;
    },
  );
  assert.throws(() => parseCli(["rnu", "smoke"], {}), /Did you mean 'relay run'/u);
  const run = parseCli(["run", "Checkout works", "--app", "Shop", "--device", "ios"], {});
  assert.equal(run.command, "outcome");
  if (run.command === "outcome") {
    assert.deepEqual(run.intent, {
      kind: "run-test",
      appMapId: "Shop",
      testId: "Checkout works",
      targetId: "ios",
    });
  }
  const connect = parseCli(["connect", "emulator-5554"], {});
  assert.equal(connect.command === "outcome" && connect.intent.kind, "connect-target");
});

test("relay run --out is accepted and other outcome verbs still refuse it", () => {
  const parsed = parseCli(["run", "smoke", "--out", "./evidence"], {});
  assert.equal(parsed.command === "outcome" && parsed.outDir, "./evidence");
  assert.throws(() => parseCli(["connect", "--out", "x"], {}), /--out is only valid/u);
});

test("names, slugs, and platform words resolve to ids", async () => {
  const resolved = await resolveOutcomeNames(
    { kind: "run-test", appMapId: "shop", testId: "checkout works", targetId: "android" },
    fakeInvoke(),
    {},
  );
  assert.deepEqual(resolved, {
    kind: "run-test",
    appMapId: "shop-web",
    testId: "test-checkout",
    targetId: "emulator-5554",
  });
  const anywhere = await resolveOutcomeNames(
    { kind: "run-test", testId: "Search finds shirts" },
    fakeInvoke(),
    {},
  );
  assert.equal((anywhere as { appMapId?: string }).appMapId, "shop-web");
  await assert.rejects(
    resolveOutcomeNames({ kind: "run-test", testId: "Chekout works" }, fakeInvoke(), {}),
    (error: unknown) =>
      error instanceof CliError &&
      error.exitCode === ExitCode.notFound &&
      /Did you mean “Checkout works”/u.test(error.message),
  );
  await assert.rejects(
    resolveOutcomeNames({ kind: "connect-target", targetId: "ios" }, fakeInvoke(), {}),
    /2 iOS devices are connected[\s\S]*iPad Pro {2}\(ipad-1\)/u,
  );
});

test("relay.json in the caller's directory supplies app and device defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-project-"));
  try {
    await writeFile(join(dir, "relay.json"), JSON.stringify({ app: "Shop", device: "Pixel 9" }));
    const resolved = await resolveOutcomeNames(
      { kind: "run-test", testId: "Checkout works" },
      fakeInvoke(),
      {
        RELAY_CALLER_CWD: dir,
      },
    );
    assert.equal((resolved as { targetId?: string }).targetId, "emulator-5554");
    await writeFile(join(dir, "relay.json"), JSON.stringify({ ap: "Shop" }));
    await assert.rejects(
      resolveOutcomeNames({ kind: "run-test", testId: "x" }, fakeInvoke(), {
        RELAY_CALLER_CWD: dir,
      }),
      /unknown field "ap"/u,
    );
    await writeFile(join(dir, "input.json"), '{"limit":1}');
    const parsed = parseCli(["run", "list", "--input-file", "input.json"], {
      RELAY_CALLER_CWD: dir,
    });
    assert.deepEqual(parsed.command === "invoke" && parsed.input, { limit: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("relay run prints the verdict and its exit code says failed, not just 'error'", () => {
  const verdict = verdictFor("run-test-checkout");
  const text = formatVerdict(verdict);
  assert.match(text, /✗ FAILED {2}Checkout works {2}\(12\.3s · Pixel 9\)/u);
  assert.match(text, /2 {2}Total is \$20 {2}FAILED/u);
  assert.match(
    text,
    /Expected: {3}Total is \$20\n {2}Saw: {8}Total is \$25\n {2}Screenshot: \/tmp\/step\.png/u,
  );
  const result = { ...settled("test-checkout"), verdict };
  assert.equal(verdictExitCode(result), ExitCode.testFailed);
  assert.equal(verdictExitCode({ verdict: { ...verdict, status: "blocked" } }), ExitCode.blocked);
  assert.equal(
    verdictExitCode({ verdict: { ...verdict, status: "passed" }, review: { pending: 1 } }),
    ExitCode.verificationIncomplete,
  );
  const io = capture();
  new CliOutput("human", false, io.streams).result("outcome.run-test", result, false);
  assert.match(io.stdout(), /FAILED {2}Checkout works/u);
});

test("relay ci runs ready Tests, skips drafts, and writes JSON and JUnit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ci-"));
  try {
    const invoke = fakeInvoke();
    const started: string[] = [];
    const io = capture();
    const ci = await runCiCommand({
      options: {
        app: "Shop",
        tests: [],
        device: "android",
        output: "out/result.json",
        junit: "junit.xml",
      },
      client: clientFrom(invoke),
      invoke,
      actorId: "human:test",
      env: { RELAY_CALLER_CWD: dir },
      output: new CliOutput("human", true, io.streams),
      human: true,
      signal: new AbortController().signal,
      pollIntervalMs: 1,
      runTest: async (request) => {
        assert.equal(request.targetId, "emulator-5554");
        started.push(request.testId);
        return settled(request.testId);
      },
    });
    assert.deepEqual(started, ["test-checkout", "test-search"]);
    assert.equal(ci.exitCode, ExitCode.testFailed);
    assert.deepEqual(ci.report.totals, {
      total: 3,
      passed: 1,
      failed: 1,
      blocked: 0,
      cancelled: 0,
      skipped: 1,
    });
    assert.match(ci.text, /✗ failed {2}Checkout works/u);
    assert.match(ci.text, /skipped {2}Refunds/u);
    assert.match(ci.text, /1 passed · 1 failed · 0 blocked · 1 skipped/u);
    const written = JSON.parse(await readFile(join(dir, "out/result.json"), "utf8"));
    assert.equal(written.verdicts.length, 2);
    const junit = await readFile(join(dir, "junit.xml"), "utf8");
    assert.match(junit, /<testsuites name="relay" tests="3" failures="1" errors="0" skipped="1"/u);
    assert.match(junit, /<failure message="The total was wrong\.">/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("relay ci exit codes: blocked-only is 3, all passed is 0, nothing runnable is 3", async () => {
  assert.equal(
    ciExitCode(ciTotals([{ ...verdictFor("x"), status: "blocked" }], 0), false),
    ExitCode.blocked,
  );
  assert.equal(ciExitCode(ciTotals([verdictFor("x")], 2), false), ExitCode.success);
  assert.equal(ciExitCode(ciTotals([], 1), false), ExitCode.blocked);
  assert.equal(ciExitCode(ciTotals([verdictFor("x")], 0), true), ExitCode.cancellation);
  const invoke = fakeInvoke();
  const ci = await runCiCommand({
    options: { app: "shop-web", tests: ["search finds shirts"] },
    client: clientFrom(invoke),
    invoke,
    actorId: "human:test",
    env: {},
    output: new CliOutput("json", true, capture().streams),
    human: false,
    signal: new AbortController().signal,
    pollIntervalMs: 1,
    runTest: async () => {
      throw new Error("No device is connected");
    },
  });
  assert.equal(ci.exitCode, ExitCode.blocked);
  assert.equal(ci.report.verdicts[0]?.reason, "No device is connected");
});

async function everyday(argv: string[], env: Record<string, string> = {}) {
  const io = capture();
  const calls: Array<{ id: string; input: unknown }> = [];
  const invoke = fakeInvoke(calls);
  const code = await runCli(argv, {
    streams: io.streams,
    env,
    registerSignalHandlers: false,
    createClient: () => clientFrom(invoke),
    ensureOutcomeServer: async () => ({ status: "reused" }) as never,
  });
  return { code, calls, stdout: io.stdout(), stderr: io.stderr() };
}

test("relay apps, tests, and devices print tables; app list is an alias", async () => {
  const apps = await everyday(["apps"]);
  assert.equal(apps.code, ExitCode.success);
  assert.match(apps.stdout, /^NAME +TESTS +UPDATED +ID\nShop +3 +1h ago +shop-web/mu);
  assert.equal((await everyday(["app", "list"])).stdout, apps.stdout);
  const tests = await everyday(["tests", "shop"]);
  assert.match(tests.stdout, /Checkout works +ready \(plain English\) +2/u);
  assert.match(tests.stdout, /Refunds +needs recording +0/u);
  const json = JSON.parse((await everyday(["tests", "Shop", "--json"])).stdout);
  assert.equal(json.result.tests.length, 3);
  const listed = await everyday(["devices"]);
  assert.match(listed.stdout, /Pixel 9 +android +emulator-5554/u);
  assert.equal(listed.stderr, "", "fast reads print no progress noise");
  assert.equal(formatListResult({ runs: [] }), "No runs yet.");
});

test("relay new drafts a Test and says how to run it; relay.json supplies the url", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-new-"));
  try {
    await writeFile(join(dir, "relay.json"), JSON.stringify({ url: "https://shop.example.com" }));
    const result = await everyday(["new", "Add a shirt and check the total"], {
      RELAY_CALLER_CWD: dir,
    });
    assert.equal(result.code, ExitCode.success);
    assert.deepEqual(result.calls.at(-1), {
      id: "test.create-from-goal",
      input: { goal: "Add a shirt and check the total", url: "https://shop.example.com" },
    });
    assert.match(result.stdout, /Saved “Cart total” in shop-web/u);
    assert.match(result.stdout, /2\. check {3}The total is \$20/u);
    assert.match(result.stdout, /Run it: {3}relay run "Cart total" --app shop-web/u);
    const alias = await everyday(["test", "new", "Check out", "--app", "Shop", "--json"]);
    assert.equal(JSON.parse(alias.stdout).result.testId, "test-new");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("relay --version and unknown names exit with distinct codes", async () => {
  const version = await everyday(["--version"]);
  assert.match(version.stdout, /^relay \d+\.\d+\.\d+/u);
  const missing = await everyday(["tests", "Shpo", "--json"]);
  assert.equal(missing.code, ExitCode.notFound);
  assert.match(JSON.parse(missing.stdout).error.message, /Did you mean “Shop”/u);
  assert.equal(missing.stderr, "");
});

test("test files: apply a folder, show a Test as a file, and refuse a bad file by path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-files-"));
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "tests", "nested"), { recursive: true });
    await writeFile(
      join(dir, "tests", "cart.yaml"),
      "name: Cart\nurl: https://shop.example.com\nsteps:\n  - Add a shirt\n",
    );
    await writeFile(
      join(dir, "tests", "nested", "search.yml"),
      "name: Search\napp: Shop\nsteps:\n  - Search shirts\n",
    );
    await writeFile(join(dir, "tests", "notes.md"), "ignored");
    const applied = await everyday(["apply", "tests"], { RELAY_CALLER_CWD: dir });
    assert.equal(applied.code, ExitCode.success);
    assert.deepEqual(
      applied.calls.filter((call) => call.id === "test.apply-yaml").length,
      2,
      "both .yaml and .yml are applied; other files are ignored",
    );
    assert.match(applied.stdout, /tests\/cart\.yaml +Cart +shop-web +created/u);
    const single = await everyday(["new", "--file", "tests/cart.yaml"], { RELAY_CALLER_CWD: dir });
    assert.equal(single.code, ExitCode.success);
    const shown = await everyday(["show", "Checkout works"]);
    assert.match(shown.stdout, /^name: Checkout works/u);
    await writeFile(join(dir, "tests", "bad.yaml"), "name: bad\nsteps:\n  - {verify: x}\n");
    const refused = await everyday(["apply", "tests/bad.yaml"], { RELAY_CALLER_CWD: dir });
    assert.equal(refused.code, ExitCode.usage);
    assert.match(refused.stderr, /tests\/bad\.yaml: Step 1/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
