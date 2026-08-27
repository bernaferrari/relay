import assert from "node:assert/strict";
import test from "node:test";
import { ensureLocalRelayServer, type LocalServerDependencies } from "./local-server.js";

test("a healthy implicit loopback Relay is reused through the authoritative bootstrap", async () => {
  let runs = 0;
  const result = await ensureLocalRelayServer("http://127.0.0.1:8787", {
    readHealth: async () => ({ ok: true, product: "relay", pid: 42 }),
    runEnsure: async () => {
      runs += 1;
      return { stdout: '{"status":"already-running"}\n', stderr: "" };
    },
  });
  assert.deepEqual(result, { status: "already-running", pid: 42 });
  assert.equal(runs, 1);
});

test("an unavailable loopback Relay starts through bounded execFile arguments", async () => {
  let invocation: Parameters<LocalServerDependencies["runEnsure"]>[0] | undefined;
  const result = await ensureLocalRelayServer("http://localhost:8787", {
    readHealth: async () => ({ ok: true, product: "relay", pid: 77 }),
    runEnsure: async (input) => {
      invocation = input;
      return { stdout: '{"status":"started"}\n', stderr: "" };
    },
  });
  assert.deepEqual(result, { status: "started", pid: 77 });
  assert.equal(invocation?.executable, process.execPath);
  assert.deepEqual(invocation?.arguments.slice(-1), ["--reuse"]);
  assert.equal(invocation?.arguments.length, 2);
  assert.equal(invocation?.timeoutMs, 30_000);
  assert.equal(invocation?.env.RELAY_PORT, "8787");
});

test("remote endpoints are never started and bootstrap failures are actionable", async () => {
  let invoked = false;
  const dependencies: LocalServerDependencies = {
    readHealth: async () => undefined,
    runEnsure: async () => {
      invoked = true;
      throw Object.assign(new Error("exit 1"), { stderr: '{"status":"refused"}\n' });
    },
  };
  await assert.rejects(
    ensureLocalRelayServer("https://relay.example", dependencies),
    /only for the implicit loopback/u,
  );
  assert.equal(invoked, false);
  await assert.rejects(
    ensureLocalRelayServer("http://127.0.0.1:8787", dependencies),
    /ensure-server\.mjs/u,
  );
});
