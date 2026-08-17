import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PassThrough } from "node:stream";
import test from "node:test";
import { ExitCode } from "./errors.js";
import { runCli } from "./index.js";

function capture() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  stdout.on("data", (chunk) => (out += String(chunk)));
  stderr.on("data", (chunk) => {
    void chunk;
  });
  return { streams: { stdout, stderr }, stdout: () => out };
}

test("relay db path prints the control sqlite location", async () => {
  const io = capture();
  const root = await mkdtemp(join(tmpdir(), "relay-db-cli-"));
  try {
    const code = await runCli(["db", "path", "--json"], {
      streams: io.streams,
      registerSignalHandlers: false,
      env: { RELAY_STATE_DIR: root },
    });
    assert.equal(code, ExitCode.success);
    assert.equal(JSON.parse(io.stdout()).path, join(root, "control.sqlite"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("relay db events reads the durable control log", async () => {
  const io = capture();
  const root = await mkdtemp(join(tmpdir(), "relay-db-events-"));
  try {
    const path = join(root, "control.sqlite");
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE control_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        at INTEGER NOT NULL,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        resource TEXT,
        resource_id TEXT,
        payload TEXT NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO control_events(id, at, project_id, type, resource, resource_id, payload) VALUES(?,?,?,?,?,?,?)",
    ).run("evt-1", 1, "p", "lease.changed", "lease", "lease-1", "{}");
    db.close();
    const code = await runCli(["db", "events", "--json"], {
      streams: io.streams,
      registerSignalHandlers: false,
      env: { RELAY_STATE_DIR: root },
    });
    assert.equal(code, ExitCode.success);
    const rows = JSON.parse(io.stdout()) as Array<{ id: string; resource_id: string }>;
    assert.equal(rows[0]?.id, "evt-1");
    assert.equal(rows[0]?.resource_id, "lease-1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
