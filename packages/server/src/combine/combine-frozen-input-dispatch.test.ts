import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const fixture = fileURLToPath(new URL("./combine-frozen-input-fixture.ts", import.meta.url));
const loader = fileURLToPath(new URL("./combine-frozen-input-sdk-loader.mjs", import.meta.url));

test(
  "public Plan dispatch and fresh-process resume consume immutable prompt rows, while a new Plan run uses explicitly updated rows",
  { timeout: 130_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "relay-frozen-input-dispatch-"));
    const environment = (store: string) => ({
      ...process.env,
      // The child uses an absolute Node path. Platform tools are deliberately
      // absent even if an unexpected collector escapes the SDK test transport.
      PATH: "",
      RELAY_STATE_DIR: join(store, "state"),
      RELAY_RUNS_DIR: join(store, "runs"),
      RELAY_WORKSPACE_ROOT: store,
      RELAY_TESTS_DIR: join(store, "tests"),
      AGENT_DEVICE_STATE_DIR: join(store, "agent-device"),
      AGENT_DEVICE_IOS_RUNNER_LEASE_DIR: join(store, "leases"),
      AGENT_DEVICE_SESSION: "frozen-input-fixture",
      RELAY_SKIP_BROWSER_WARMUP: "1",
      RELAY_AUTO_VISUAL_EVIDENCE: "0",
      RELAY_AUTO_STATE_DELAY_MS: "0",
      RELAY_FROZEN_INPUT_FIXTURE_ROOT: store,
    });
    const phase = async (name: string, store = root) => {
      const result = await run(
        process.execPath,
        ["--import", "tsx", "--import", loader, fixture, name],
        {
          env: environment(store),
          timeout: 60_000,
          signal: t.signal,
          killSignal: "SIGKILL",
          maxBuffer: 1024 * 1024,
        },
      );
      const line = result.stdout.split("\n").find((item) => item.startsWith("FIXTURE_RESULT "));
      assert.ok(
        line,
        `${name} did not return its proof receipt: ${result.stdout}\n${result.stderr}`,
      );
      return JSON.parse(line.slice("FIXTURE_RESULT ".length)) as {
        pid: number;
        typed: string[];
        pending: number;
        rejected: string[];
      };
    };
    try {
      const admitted = await phase("admit");
      assert.deepEqual(admitted.typed, ["  First prompt\nwith preserved spacing.\n"]);
      assert.equal(admitted.pending, 1);
      for (const reason of ["authored", "gap", "profile", "cas", "timestamp"]) {
        const branch = await mkdtemp(join(tmpdir(), "relay-frozen-input-negative-"));
        try {
          await cp(root, branch, { recursive: true });
          const rejected = await phase(`reject-${reason}`, branch);
          assert.deepEqual(rejected.rejected, [reason]);
          assert.deepEqual(rejected.typed, []);
        } finally {
          await rm(branch, { recursive: true, force: true });
        }
      }
      const resumed = await phase("resume");
      assert.notEqual(admitted.pid, resumed.pid, "resume must reload state in a new process");
      assert.deepEqual(resumed.typed, [
        "Second prompt — a different public value",
        "New first prompt",
        "New second prompt",
      ]);
      assert.deepEqual(resumed.rejected, ["retired-row", "unknown-cell", "missing-input"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
