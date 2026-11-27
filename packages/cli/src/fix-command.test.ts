import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { ApiError } from "@relay/client";
import { buildFixHandoff, runFixCommand, runTestIdentity, type FixVerdict } from "./fix-command.js";
import { ExitCode } from "./errors.js";
import { runCli } from "./index.js";
import type { OperationInvoker } from "./invoke.js";

function capture() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk) => (out += String(chunk)));
  stderr.on("data", (chunk) => (err += String(chunk)));
  return { streams: { stdout, stderr }, stdout: () => out, stderr: () => err };
}

function verdictFixture(overrides: Partial<FixVerdict> = {}): FixVerdict {
  return {
    runId: "run-01JXYZ",
    title: "Checkout works",
    status: "failed",
    summary: "Failed at “Total is $20”: Total is $25",
    reason: "Total is $25",
    durationMs: 12_300,
    device: "Pixel 9",
    steps: [
      { id: "step-add", title: "Add a shirt", kind: "action", status: "passed" },
      {
        id: "step-total",
        title: "Total is $20",
        kind: "check",
        status: "failed",
        expected: "Total is $20",
        saw: "Total is $25",
        screenshot: "/workspace/runs/run-01JXYZ/frames/step-2.png",
        replay: {
          source: "re-resolved",
          detail: "re-resolved after the saved path no longer matched",
        },
      },
    ],
    ...overrides,
  };
}

function clientFixture(handlers: {
  verdict?: (runId: string) => unknown;
  run?: (runId: string) => unknown;
}): {
  client: OperationInvoker;
  calls: Array<{ id: string; input: unknown }>;
} {
  const calls: Array<{ id: string; input: unknown }> = [];
  return {
    calls,
    client: {
      invoke: async (id, input) => {
        calls.push({ id, input });
        const runId = String((input as { runId?: unknown }).runId);
        if (id === "run.verdict.get") {
          if (!handlers.verdict) throw new ApiError(404, `Run ${runId} not found`);
          return { verdict: handlers.verdict(runId) };
        }
        if (id === "run.get") {
          if (!handlers.run) throw new ApiError(404, `Run ${runId} not found`);
          return { run: handlers.run(runId) };
        }
        throw new Error(`unexpected ${id}`);
      },
      events: async () => {},
    } as OperationInvoker,
  };
}

async function fix(
  argv: string[],
  handlers: Parameters<typeof clientFixture>[0],
  env: Record<string, string> = {},
) {
  const io = capture();
  const fixture = clientFixture(handlers);
  const code = await runCli(["fix", ...argv], {
    streams: io.streams,
    env,
    registerSignalHandlers: false,
    createClient: () => fixture.client,
    ensureOutcomeServer: async () => ({ status: "reused" }) as never,
  });
  return { code, stdout: io.stdout(), stderr: io.stderr(), ...fixture };
}

const lineage = { appMapId: "shop-web", testId: "test-checkout" };
/** A run record shaped like the real persisted execution job: identity lives
 * in the action label and the frozen execution-intent artifacts. */
const runRecord = (runId: string) => ({
  id: runId,
  action: "app-map:shop-web:test:test-checkout",
  status: "failed",
  queuedAt: 1,
  artifacts: [],
});

test("relay fix writes the complete failure handoff as markdown", async () => {
  const result = await fix(["run-01JXYZ"], {
    verdict: () => verdictFixture(),
    run: runRecord,
  });
  assert.equal(result.code, ExitCode.success, result.stderr);
  assert.equal(result.stderr, "");
  const out = result.stdout;
  // One-line summary: test name, step, expected vs. saw.
  assert.match(out, /^# Fix the failing Relay test “Checkout works”/u);
  assert.match(
    out,
    /Run `run-01JXYZ` failed step 2 of 2, “Total is \$20”: expected “Total is \$20”, but Relay saw “Total is \$25”\./u,
  );
  assert.match(out, /It ran on Pixel 9 and took 12\.3s\./u);
  // Evidence references the agent can read or pass back.
  assert.match(
    out,
    /Screenshot of the screen at the failure: `\/workspace\/runs\/run-01JXYZ\/frames\/step-2\.png`/u,
  );
  assert.match(out, /`relay_inspect_failure` MCP tool, or run `relay inspect-failure run-01JXYZ`/u);
  assert.match(out, /`relay export run-01JXYZ --out \.\/relay-evidence`/u);
  assert.match(out, /saved path no longer matched, so Relay re-resolved the step live/u);
  // Reproduction and scope discipline.
  assert.match(out, /   ```\n   relay run test-checkout --app shop-web\n   ```/u);
  assert.match(out, /`relay_run_test` with testId `test-checkout` and appMapId `shop-web`/u);
  assert.match(out, /smallest change in this repository that makes step 2 pass: “Total is \$20”/u);
  assert.match(out, /Change the app, not the test/u);
  assert.match(out, /stop and ask first/u);
  // The verdict and the run record were the only reads.
  assert.deepEqual(result.calls, [
    { id: "run.verdict.get", input: { runId: "run-01JXYZ" } },
    { id: "run.get", input: { runId: "run-01JXYZ" } },
  ]);
  // Product vocabulary: never cache, selector, or binding.
  assert.doesNotMatch(out, /cache|selector|binding/iu);
});

test("runTestIdentity mirrors the canonical keying: intent artifacts win over the action label", () => {
  // Direct test execution freezes an app-map-test-execution-intent.
  assert.deepEqual(
    runTestIdentity({
      run: {
        action: "app-map:shop-web:test:test-checkout",
        artifacts: [
          {
            kind: "app-map-test-execution-intent",
            data: { sourcePlan: { appMapId: "shop-web", testId: "test-checkout" } },
          },
        ],
      },
    }),
    lineage,
  );
  // A combine cell keys its identity one level down, under child.sourcePlan.
  assert.deepEqual(
    runTestIdentity({
      run: {
        action: "app-map:shop-web:test:test-checkout:combine:world-1",
        artifacts: [
          {
            kind: "app-map-combine-cell-execution-intent",
            data: { child: { sourcePlan: { appMapId: "shop-web", testId: "test-checkout" } } },
          },
        ],
      },
    }),
    lineage,
  );
  // The intent is immutable provenance; a conflicting action label loses.
  assert.deepEqual(
    runTestIdentity({
      run: {
        action: "app-map:other-app:test:other-test",
        artifacts: [
          {
            kind: "app-map-test-execution-intent",
            data: { sourcePlan: { appMapId: "shop-web", testId: "test-checkout" } },
          },
        ],
      },
    }),
    lineage,
  );
  // Without artifacts the action label carries the identity.
  assert.deepEqual(runTestIdentity({ run: runRecord("run-x") }), lineage);
  // The bare run record works unwrapped, and non-test actions carry nothing.
  assert.deepEqual(runTestIdentity(runRecord("run-x")), lineage);
  assert.equal(runTestIdentity({ run: { action: "recipe:legacy", artifacts: [] } }), undefined);
  assert.equal(runTestIdentity({}), undefined);
  assert.equal(runTestIdentity(undefined), undefined);
});

test("relay fix reads identity from the frozen intent when the action label is not a test", async () => {
  const result = await fix(["run-01JXYZ"], {
    verdict: () => verdictFixture(),
    run: (runId) => ({
      id: runId,
      action: "app-map:shop-web",
      status: "failed",
      queuedAt: 1,
      artifacts: [
        {
          kind: "app-map-test-execution-intent",
          data: { sourcePlan: { ...lineage } },
        },
      ],
    }),
  });
  assert.equal(result.code, ExitCode.success, result.stderr);
  assert.match(result.stdout, /relay run test-checkout --app shop-web/u);
});

test("relay fix omits the screenshot line when the run kept none", async () => {
  const fixture = verdictFixture();
  const step = fixture.steps[1]!;
  delete step.screenshot;
  const result = await fix(["run-01JXYZ"], {
    verdict: () => fixture,
    run: runRecord,
  });
  assert.equal(result.code, ExitCode.success, result.stderr);
  assert.doesNotMatch(result.stdout, /Screenshot/u);
  assert.match(result.stdout, /relay inspect-failure run-01JXYZ/u);
  assert.match(result.stdout, /## Evidence/u);
});

test("relay fix rejects a passed run honestly", async () => {
  const result = await fix(["run-passed"], {
    verdict: (runId) => verdictFixture({ runId, status: "passed", summary: "Passed · 2 of 2" }),
    run: runRecord,
  });
  assert.equal(result.code, ExitCode.validation);
  assert.match(result.stderr, /Run run-passed passed — nothing to fix\./u);
  assert.equal(result.stdout, "");
});

test("relay fix rejects cancelled and running runs honestly", async () => {
  for (const status of ["cancelled", "running"] as const) {
    const result = await fix(["run-x"], {
      verdict: (runId) => verdictFixture({ runId, status }),
      run: runRecord,
    });
    assert.equal(result.code, ExitCode.validation, status);
    assert.match(
      result.stderr,
      status === "cancelled" ? /was cancelled — nothing to fix/u : /is still running/u,
    );
  }
});

test("relay fix reports an unknown run id as not found", async () => {
  const result = await fix(["run-missing"], {});
  assert.equal(result.code, ExitCode.notFound);
  assert.match(result.stderr, /Run run-missing not found/u);
});

test("relay fix --json keeps a stable structured shape", async () => {
  const result = await fix(["run-01JXYZ", "--json"], {
    verdict: () => verdictFixture(),
    run: runRecord,
  });
  assert.equal(result.code, ExitCode.success, result.stderr);
  const envelope = JSON.parse(result.stdout.trim());
  assert.equal(envelope.type, "result");
  assert.equal(envelope.ok, true);
  assert.equal(envelope.operationId, "local.fix");
  const handoff = envelope.result;
  assert.deepEqual(
    Object.keys(handoff).sort(),
    [
      "device",
      "durationMs",
      "failedSteps",
      "prompt",
      "reason",
      "reproduce",
      "runId",
      "status",
      "step",
      "summary",
      "test",
      "title",
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(handoff.step).sort(),
    ["expected", "id", "index", "kind", "replay", "saw", "screenshot", "title"].sort(),
  );
  assert.equal(handoff.runId, "run-01JXYZ");
  assert.equal(handoff.status, "failed");
  assert.deepEqual(handoff.test, lineage);
  assert.equal(handoff.step.index, 2);
  assert.equal(handoff.failedSteps, 1);
  assert.equal(handoff.reproduce, "relay run test-checkout --app shop-web");
  assert.match(handoff.prompt, /^# Fix the failing Relay test/u);
});

test("relay fix selects a failed step by position or id when several failed", async () => {
  const multi = verdictFixture({
    steps: [
      { id: "step-add", title: "Add a shirt", kind: "action", status: "passed" },
      {
        id: "step-total",
        title: "Total is $20",
        kind: "check",
        status: "failed",
        expected: "Total is $20",
        saw: "Total is $25",
      },
      {
        id: "step-receipt",
        title: "Receipt is shown",
        kind: "check",
        status: "failed",
        expected: "Receipt is shown",
        saw: "Cart is still open",
      },
    ],
  });
  const first = await fix(["run-01JXYZ"], { verdict: () => multi, run: runRecord });
  assert.match(first.stdout, /failed step 2 of 3/u);
  assert.match(first.stdout, /2 steps failed in this run; this prompt covers step 2 only\./u);

  const picked = await fix(["run-01JXYZ", "3"], { verdict: () => multi, run: runRecord });
  assert.equal(picked.code, ExitCode.success, picked.stderr);
  assert.match(picked.stdout, /failed step 3 of 3, “Receipt is shown”/u);
  assert.match(picked.stdout, /makes step 3 pass: “Receipt is shown”/u);

  const byId = await fix(["run-01JXYZ", "step-receipt"], {
    verdict: () => multi,
    run: runRecord,
  });
  assert.equal(byId.code, ExitCode.success, byId.stderr);
  assert.match(byId.stdout, /failed step 3 of 3, “Receipt is shown”/u);

  const notFailed = await fix(["run-01JXYZ", "1"], { verdict: () => multi, run: runRecord });
  assert.equal(notFailed.code, ExitCode.validation);
  assert.match(notFailed.stderr, /did not fail in this run — nothing to fix there/u);

  const missing = await fix(["run-01JXYZ", "step-nope"], {
    verdict: () => multi,
    run: runRecord,
  });
  assert.equal(missing.code, ExitCode.validation);
  assert.match(missing.stderr, /has no step “step-nope”/u);
});

test("relay fix hands off a blocked run with the environmental caution", async () => {
  const result = await fix(["run-blocked"], {
    verdict: (runId) =>
      verdictFixture({
        runId,
        status: "blocked",
        summary: "Blocked at “Add a shirt”: The device went offline",
      }),
    run: runRecord,
  });
  assert.equal(result.code, ExitCode.success, result.stderr);
  assert.match(result.stdout, /was blocked at step 2 of 2/u);
  assert.match(result.stdout, /often a device, sign-in, or harness problem rather than app code/u);
});

test("relay fix without saved-Test lineage omits the exact re-run command honestly", async () => {
  const result = await fix(["run-01JXYZ"], {
    verdict: () => verdictFixture(),
    run: (runId) => ({ id: runId, action: "recipe:legacy", status: "failed", queuedAt: 1 }),
  });
  assert.equal(result.code, ExitCode.success, result.stderr);
  assert.doesNotMatch(result.stdout, /relay run test-checkout/u);
  assert.match(
    result.stdout,
    /does not carry the saved Test's identity, so Relay cannot write the exact re-run command/u,
  );
  const json = await fix(["run-01JXYZ", "--json"], {
    verdict: () => verdictFixture(),
    run: (runId) => ({ id: runId, action: "recipe:legacy", status: "failed", queuedAt: 1 }),
  });
  const handoff = JSON.parse(json.stdout.trim()).result;
  assert.equal(handoff.test, undefined);
  assert.equal(handoff.reproduce, undefined);
  assert.match(handoff.prompt, /does not carry the saved Test's identity/u);
});

test("relay fix degrades to no lineage when the run record cannot be read", async () => {
  // run.verdict.get answers but run.get fails: the handoff must not.
  const result = await fix(["run-01JXYZ"], {
    verdict: () => verdictFixture(),
    run: () => {
      throw new Error("boom");
    },
  });
  assert.equal(result.code, ExitCode.success, result.stderr);
  assert.doesNotMatch(result.stdout, /relay run test-checkout/u);
  assert.match(result.stdout, /does not carry the saved Test's identity/u);
});

test("runFixCommand rejects a malformed verdict response", async () => {
  await assert.rejects(
    runFixCommand({
      runId: "run-x",
      invoke: async () => ({ verdict: { status: "failed" } }),
    }),
    /Malformed run\.verdict\.get response/u,
  );
});

test("buildFixHandoff composes the lead line from the evidence that exists", () => {
  const base = verdictFixture();
  const step = base.steps[1]!;
  const expectedOnly = buildFixHandoff({
    verdict: { ...base, steps: [base.steps[0]!, { ...step, saw: undefined }] },
    test: lineage,
  });
  assert.match(
    expectedOnly.prompt,
    /“Total is \$20”: expected “Total is \$20”\.\n/u,
    "expected without saw ends the sentence",
  );
  assert.doesNotMatch(expectedOnly.prompt, /but Relay saw/u);

  const sawOnly = buildFixHandoff({
    verdict: { ...base, steps: [base.steps[0]!, { ...step, expected: undefined }] },
    test: lineage,
  });
  assert.match(sawOnly.prompt, /“Total is \$20”: Relay saw “Total is \$25”\./u);

  const neither = buildFixHandoff({
    verdict: {
      ...base,
      steps: [base.steps[0]!, { ...step, expected: undefined, saw: undefined }],
    },
    test: lineage,
  });
  assert.match(neither.prompt, /failed step 2 of 2, “Total is \$20”\.\n/u);
  // The fix instruction still names the step goal without inventing an expectation.
  assert.match(neither.prompt, /makes step 2 pass: “Total is \$20”/u);
});

test("buildFixHandoff quotes shell-unsafe test identity in the re-run command", () => {
  const handoff = buildFixHandoff({
    verdict: verdictFixture(),
    test: { appMapId: "shop web", testId: "test checkout" },
  });
  assert.equal(handoff.reproduce, 'relay run "test checkout" --app "shop web"');
  assert.match(handoff.prompt, /   relay run "test checkout" --app "shop web"\n/u);
});

test("buildFixHandoff rejects a failed run with no failed step", () => {
  assert.throws(
    () =>
      buildFixHandoff({
        verdict: {
          ...verdictFixture(),
          steps: [{ id: "a", title: "Add a shirt", status: "not-run" }],
        },
      }),
    /recorded no failed step to hand off/u,
  );
});

test("relay fix validates its arguments and flags", async () => {
  const noArgs = await fix([], { verdict: () => verdictFixture(), run: runRecord });
  assert.equal(noArgs.code, ExitCode.usage);
  assert.match(noArgs.stderr, /Expected: relay fix <runId> \[<step>\]/u);

  const extra = await fix(["run-01JXYZ", "2", "3"], {
    verdict: () => verdictFixture(),
    run: runRecord,
  });
  assert.equal(extra.code, ExitCode.usage);

  const badFlag = await fix(["run-01JXYZ", "--app", "shop"], {
    verdict: () => verdictFixture(),
    run: runRecord,
  });
  assert.equal(badFlag.code, ExitCode.usage);
  assert.match(badFlag.stderr, /--app is not an option of relay fix/u);
});
