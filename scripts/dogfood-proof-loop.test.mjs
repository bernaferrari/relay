import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DogfoodError,
  PROOF_EXIT_CODES,
  assertServerReachable,
  buildTestRunArgs,
  cliResultEnvelope,
  createShareLink,
  emitProofReportArtifacts,
  ensureLease,
  extractRunId,
  parseArgs,
  parseProofReport,
  resolveCommit,
  runProofLoop,
  unwrapCliResult,
  verdictToExitCode,
} from "./dogfood-proof-loop.mjs";

const PROOF_REPORT = {
  schemaVersion: 1,
  verdict: "pass",
  sourceRevision: { vcs: "git", sha: "abc1234def5678", prNumber: 7, branch: "feature/x" },
  flows: [{ testId: "settings-tour", title: "Settings tour", status: "passed" }],
  generatedAt: 1_756_000_000_000,
};

function cliScript(responses) {
  const calls = [];
  const cli = async (args) => {
    calls.push(args);
    const key = args.join(" ");
    const respond = responses.find((candidate) => candidate.matches(key));
    if (!respond) return { code: 1, stdout: "", stderr: `no fake response for ${key}` };
    const raw = respond.stdout;
    return {
      code: respond.code ?? 0,
      stdout:
        typeof raw === "function"
          ? raw(key)
          : typeof raw === "string"
            ? raw
            : `${JSON.stringify({ type: "result", ok: true, operationId: "fake", result: raw })}\n`,
      stderr: respond.stderr ?? "",
    };
  };
  return { cli, calls };
}

test("parseArgs requires map, test, and serial and validates --pr", () => {
  assert.deepEqual(parseArgs(["--map", "grok-ios", "--test", "tour", "--serial", "ipad-1"]), {
    map: "grok-ios",
    test: "tour",
    serial: "ipad-1",
  });
  assert.deepEqual(
    parseArgs(
      [
        "--map",
        "m",
        "--test",
        "t",
        "--serial",
        "s",
        "--commit",
        "abc1234",
        "--pr",
        "42",
        "--branch",
        "feat",
      ],
      {},
    ),
    { map: "m", test: "t", serial: "s", commit: "abc1234", pr: 42, branch: "feat" },
  );
  for (const bad of [
    ["--map", "m", "--test", "t"],
    ["--map", "m", "--serial", "s"],
    [],
    ["map", "m", "--test", "t", "--serial", "s"],
    ["--map", "m", "--test", "t", "--serial", "s", "--pr", "0"],
    ["--map", "m", "--test", "t", "--serial", "s", "--pr", "x"],
  ]) {
    assert.throws(() => parseArgs(bad), DogfoodError);
  }
});

test("resolveCommit prefers flags over GITHUB_SHA and falls back to git HEAD or nothing", () => {
  const runCommand = (args) =>
    args[0] === "git" ? "deadbeefcafe1234567890abcdef1234567890ab\n" : "";
  assert.equal(resolveCommit({ commit: "abc1234def56789", env: {} }), "abc1234def56789");
  assert.equal(
    resolveCommit({ env: { GITHUB_SHA: "1234567890abcdef" }, runCommand }),
    "1234567890abcdef",
  );
  assert.equal(resolveCommit({ env: {}, runCommand }), "deadbeefcafe1234567890abcdef1234567890ab");
  assert.equal(resolveCommit({ env: {}, runCommand: undefined }), undefined);
  assert.throws(
    () => resolveCommit({ commit: "NOT_A_SHA", env: {} }),
    (error) => error instanceof DogfoodError && /7-40/.test(error.message),
  );
});

test("buildTestRunArgs pins current target/revision, provenance, and watch mode", () => {
  assert.deepEqual(buildTestRunArgs({ map: "grok-ios", test: "tour", commit: "abc1234", pr: 42 }), [
    "test",
    "run",
    "grok-ios",
    "tour",
    "--target",
    "current",
    "--revision",
    "current",
    "--timeout",
    "240000",
    "--commit",
    "abc1234",
    "--pr",
    "42",
    "--wait",
    "--json",
  ]);
  assert.ok(!buildTestRunArgs({ map: "m", test: "t" }).includes("--commit"));
});

test("verdict mapping mirrors ProofReport exit semantics", () => {
  assert.equal(verdictToExitCode("pass"), 0);
  assert.equal(verdictToExitCode("fail"), 9);
  assert.equal(verdictToExitCode("unproven"), 8);
  assert.equal(verdictToExitCode(undefined), 8);
  assert.deepEqual(PROOF_EXIT_CODES, { pass: 0, fail: 9, unproven: 8 });
});

test("cliResultEnvelope skips progress lines and unwraps to a run id", () => {
  const stdout = [
    '{"type":"snapshot","operationId":"app-map.test.run","snapshot":{"job":{"id":"pending"}}}',
    "relay noise line",
    '{"type":"result","ok":true,"operationId":"app-map.test.run","result":{"job":{"id":"run-1","status":"ok"}}}',
  ].join("\n");
  const payload = unwrapCliResult(cliResultEnvelope(stdout));
  assert.equal(extractRunId(payload), "run-1");
  assert.equal(extractRunId({ jobs: [{ id: "b" }, { nope: true }] }), "b");
  assert.throws(() => extractRunId({ job: {} }), DogfoodError);
  assert.throws(
    () => unwrapCliResult({ type: "error", ok: false, error: { message: "boom", exitCode: 9 } }),
    (error) => error instanceof DogfoodError && error.cliExitCode === 9,
  );
});

test("assertServerReachable fails closed on transport errors and unhealthy payloads", async () => {
  const health = await assertServerReachable({
    relayUrl: "http://127.0.0.1:8787/",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, version: "9.9" }),
    }),
  });
  assert.equal(health.version, "9.9");
  await assert.rejects(
    assertServerReachable({
      relayUrl: "http://127.0.0.1:8787/",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    }),
    /unreachable/,
  );
  await assert.rejects(
    assertServerReachable({
      relayUrl: "http://127.0.0.1:8787/",
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: false }) }),
    }),
    /not healthy/,
  );
});

test("ensureLease reuses an owned active lease before minting a new one", async () => {
  const reuse = cliScript([
    {
      matches: (key) => key.startsWith("lease list"),
      stdout: {
        leases: [
          { id: "lease-1", deviceSerial: "ipad-1", ownerId: "agent:x", status: "leased" },
          { id: "lease-2", deviceSerial: "ipad-1", ownerId: "human:y", status: "leased" },
        ],
      },
    },
  ]);
  assert.deepEqual(await ensureLease({ serial: "ipad-1", actor: "agent:x", cli: reuse.cli }), {
    leaseId: "lease-1",
    created: false,
  });
  assert.equal(reuse.calls.length, 1);

  const mint = cliScript([
    { matches: (key) => key.startsWith("lease list"), stdout: { leases: [] } },
    {
      matches: (key) => key.startsWith("lease create ipad-1"),
      stdout: { lease: { id: "lease-9", deviceSerial: "ipad-1", ownerId: "agent:x" } },
    },
  ]);
  const created = await ensureLease({ serial: "ipad-1", actor: "agent:x", cli: mint.cli });
  assert.deepEqual(created, { leaseId: "lease-9", created: true });
  assert.deepEqual(mint.calls[1], ["lease", "create", "ipad-1", "--actor", "agent:x", "--json"]);
});

test("emitProofReportArtifacts writes json + markdown evidence from report emit", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-dogfood-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const markdown = "# Proof report\n\nVerdict: pass\n";
  const { cli, calls } = cliScript([
    {
      matches: (key) => key.includes("report emit") && key.includes("--json"),
      // report emit prints the bare ProofReport, not an operation envelope.
      stdout: `${JSON.stringify(PROOF_REPORT)}\n`,
    },
    { matches: (key) => key.includes("report emit"), stdout: markdown },
  ]);
  const emitted = await emitProofReportArtifacts({
    runId: "run-1",
    cli,
    outDir: root,
    relayUrl: "http://127.0.0.1:8787",
  });
  assert.equal(emitted.verdict, "pass");
  assert.equal(emitted.evidencePaths.length, 2);
  const bare = JSON.parse(await readFile(join(root, "proof-report.json"), "utf8"));
  assert.equal(bare.verdict, "pass");
  const writtenMarkdown = await readFile(join(root, "proof-report.md"), "utf8");
  assert.match(writtenMarkdown, /# Proof report/u);
  const emitCalls = calls.filter((args) => args[0] === "report");
  assert.deepEqual(emitCalls[0].slice(0, 5), ["report", "emit", "--run", "run-1", "--format"]);

  assert.equal(parseProofReport(`${JSON.stringify(PROOF_REPORT)}\n`).verdict, "pass");
  assert.throws(() => parseProofReport("nothing here"), /No ProofReport/);
});

test("createShareLink surfaces path/url and degrades to a note on failure", async () => {
  const happy = cliScript([
    {
      matches: (key) => key.startsWith("run share create"),
      stdout: {
        share: { id: "share-1", runId: "run-1", status: "active" },
        token: "cap_secret",
        path: "/shared/runs/share-1",
        url: "https://relay.example/shared/runs/share-1",
      },
    },
  ]);
  assert.deepEqual(await createShareLink({ runId: "run-1", cli: happy.cli }), {
    path: "/shared/runs/share-1",
    url: "https://relay.example/shared/runs/share-1",
  });
  const failing = cliScript([{ matches: () => true, code: 6, stderr: "conflict", stdout: "" }]);
  const degraded = await createShareLink({ runId: "run-1", cli: failing.cli });
  assert.ok(degraded.error && !degraded.path);
});

test("runProofLoop end-to-end pass writes evidence, shares, and maps the verdict", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-dogfood-loop-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { cli, calls } = cliScript([
    { matches: (key) => key.startsWith("lease list"), stdout: { leases: [] } },
    { matches: (key) => key.startsWith("lease create"), stdout: { lease: { id: "lease-1" } } },
    {
      matches: (key) => key.startsWith("test run grok-ios settings-tour"),
      stdout: {
        planIdentity: { appMapId: "grok-ios", testId: "settings-tour" },
        job: { id: "run-77", status: "ok", action: "recipe" },
      },
    },
    {
      matches: (key) => key.includes("report emit") && key.includes("--json"),
      stdout: `${JSON.stringify(PROOF_REPORT)}\n`,
    },
    { matches: (key) => key.includes("report emit"), stdout: "# Proof report\n" },
    {
      matches: (key) => key.startsWith("run share create"),
      stdout: {
        share: { id: "share-1", runId: "run-77", status: "active" },
        token: "t",
        path: "/shared/runs/share-1",
      },
    },
  ]);

  const { exitCode, summary } = await runProofLoop({
    inputs: { map: "grok-ios", test: "settings-tour", serial: "ipad-1" },
    relayUrl: "http://127.0.0.1:8787",
    actor: "agent:loop",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, version: "1.0" }),
    }),
    cli,
    outDir: root,
  });

  assert.equal(exitCode, PROOF_EXIT_CODES.pass);
  assert.equal(summary.verdict, "pass");
  assert.equal(summary.runId, "run-77");
  assert.equal(summary.leaseCreated, true);
  assert.equal(summary.shareLink, "http://127.0.0.1:8787/shared/runs/share-1");
  const runCall = calls.find((args) => args[0] === "test");
  assert.deepEqual(runCall.slice(0, 6), [
    "test",
    "run",
    "grok-ios",
    "settings-tour",
    "--target",
    "current",
  ]);
  assert.ok(runCall.includes("--wait"));
  assert.ok(runCall.includes("--json"));
  await readFile(join(root, "proof-report.json"));
  await readFile(join(root, "proof-report.md"));
});

test("a failed watched run exits 9; unreachable server and missing run id exit 8", async (t) => {
  const rootA = await mkdtemp(join(tmpdir(), "relay-dogfood-fail-"));
  t.after(() => rm(rootA, { recursive: true, force: true }));
  const failing = cliScript([
    { matches: (key) => key.startsWith("lease list"), stdout: { leases: [] } },
    { matches: (key) => key.startsWith("lease create"), stdout: { lease: { id: "lease-1" } } },
    {
      matches: (key) => key.startsWith("test run m t"),
      code: 9,
      stdout: "",
      stderr: "relay: The flow reported failure",
    },
  ]);
  const failure = await runProofLoop({
    inputs: { map: "m", test: "t", serial: "s" },
    relayUrl: "http://127.0.0.1:8787",
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    cli: failing.cli,
    outDir: rootA,
  });
  assert.equal(failure.exitCode, PROOF_EXIT_CODES.fail);
  assert.equal(failure.summary.verdict, "fail");

  await assert.rejects(
    runProofLoop({
      inputs: { map: "m", test: "t", serial: "s" },
      relayUrl: "http://127.0.0.1:8787",
      fetchImpl: async () => {
        throw new Error("down");
      },
      cli: cliScript([]).cli,
      outDir: rootA,
    }),
    /unreachable/,
  );

  const noJobId = cliScript([
    { matches: (key) => key.startsWith("lease list"), stdout: { leases: [] } },
    { matches: (key) => key.startsWith("lease create"), stdout: { lease: { id: "lease-1" } } },
    { matches: (key) => key.startsWith("test run m t"), stdout: { unexpected: true } },
  ]);
  const unproven = await runProofLoop({
    inputs: { map: "m", test: "t", serial: "s" },
    relayUrl: "http://127.0.0.1:8787",
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    cli: noJobId.cli,
    outDir: rootA,
  });
  assert.equal(unproven.exitCode, PROOF_EXIT_CODES.unproven);
  assert.equal(unproven.summary.verdict, "unproven");
});
