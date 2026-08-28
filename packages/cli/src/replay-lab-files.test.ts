import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TracePack } from "@relay/protocol";
import { ReplayLabFileError, readReplayLabTracePacks } from "./replay-lab-files.js";

function tracePack(digit: string): TracePack {
  const digest = `sha256:${digit.repeat(64)}` as const;
  return {
    schemaVersion: 1,
    kind: "relay-trace-pack",
    digest,
    createdAt: 1,
    source: {
      runId: `run-${digit}`,
      runSchemaVersion: 5,
      status: "ok",
      action: "test",
      inputDigest: "a".repeat(64),
      writtenAt: 1,
    },
    redaction: { status: "applied-at-persistence", redactedChannels: [] },
    completeness: { status: "complete", channels: {}, missing: [], artifacts: [] },
    objects: [
      {
        path: "run.json",
        kind: "frozen-run",
        mediaType: "application/json",
        encoding: "json",
        digest,
        bytes: 2,
        content: {},
      },
    ],
  };
}

test("CLI reads only explicit bounded TracePack JSON files and unwraps export envelopes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-replay-files-"));
  const firstPath = join(directory, "first.json");
  const latestPath = join(directory, "latest.json");
  try {
    await writeFile(firstPath, JSON.stringify({ tracePack: tracePack("a") }));
    await writeFile(latestPath, JSON.stringify({ result: { tracePack: tracePack("b") } }));
    const packs = await readReplayLabTracePacks([firstPath, latestPath]);
    assert.deepEqual(
      packs.map((pack) => pack.source.runId),
      ["run-a", "run-b"],
    );
    await assert.rejects(
      readReplayLabTracePacks([firstPath, firstPath]),
      (error: unknown) =>
        error instanceof ReplayLabFileError && error.code === "REPLAY_LAB_DUPLICATE_SOURCE",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
