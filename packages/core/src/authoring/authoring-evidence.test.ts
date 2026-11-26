import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { persistAuthoringEvidence, readAuthoringEvidence } from "./authoring-evidence.js";

test("content-addressed authoring evidence is concurrency-safe and rejects corrupt finals", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-authoring-cas-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    const data = Buffer.from("same immutable evidence");
    const writes = await Promise.all(
      Array.from({ length: 8 }, () =>
        persistAuthoringEvidence({ kind: "snapshot", capturedAt: 1, data }),
      ),
    );
    assert.equal(new Set(writes.map(({ sha256 }) => sha256)).size, 1);
    assert.deepEqual(await readAuthoringEvidence(writes[0]!.sha256!), data);

    const corruptData = Buffer.from("expected content");
    const corruptHash = createHash("sha256").update(corruptData).digest("hex");
    const evidenceDirectory = join(root, "authoring-evidence");
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(join(evidenceDirectory, corruptHash), "partial or corrupt");
    await assert.rejects(
      persistAuthoringEvidence({ kind: "snapshot", capturedAt: 2, data: corruptData }),
      /is corrupt/,
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
