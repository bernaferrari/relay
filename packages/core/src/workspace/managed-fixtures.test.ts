import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  importManagedFixture,
  listManagedFixtures,
  resolveManagedFixtureFile,
} from "./managed-fixtures.js";

async function withStore(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "relay-fixture-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("managed files round trip, deduplicate and remain project scoped", async () =>
  withStore(async () => {
    const input = { name: "sample.txt", base64: Buffer.from("test content").toString("base64") };
    const fixture = await importManagedFixture("one", input);
    assert.deepEqual(await importManagedFixture("one", input), fixture);
    assert.deepEqual(await listManagedFixtures("one"), [fixture]);
    assert.deepEqual(await listManagedFixtures("two"), []);
    await assert.rejects(resolveManagedFixtureFile(fixture.file, "two"));
    const path = await resolveManagedFixtureFile(fixture.file, "one");
    assert.equal(await readFile(path, "utf8"), "test content");
    await writeFile(path, "tampered");
    await assert.rejects(resolveManagedFixtureFile(fixture.file, "one"), /contents changed/);
  }));

test("imports reject paths, malformed data, empty files and excess bytes", async () =>
  withStore(async () => {
    for (const name of ["../escape", "/escape", "a/b", "a\\b", ".", ".."]) {
      await assert.rejects(importManagedFixture("one", { name, base64: "aGVsbG8=" }));
    }
    for (const base64 of ["", "!!!!", "aGVsbG8", "aGVsbG8=\n"]) {
      await assert.rejects(importManagedFixture("one", { name: "sample.txt", base64 }));
    }
    const oversized = Buffer.alloc(25 * 1024 * 1024 + 1).toString("base64");
    await assert.rejects(importManagedFixture("one", { name: "sample.bin", base64: oversized }));
  }));

test("managed references reject traversal and symbolic links", async () =>
  withStore(async (root) => {
    const fixture = await importManagedFixture("one", { name: "sample.txt", base64: "aGVsbG8=" });
    await assert.rejects(resolveManagedFixtureFile("fixture:../../escape", "one"), /Invalid/);
    const path = await resolveManagedFixtureFile(fixture.file, "one");
    const outside = join(root, "outside.txt");
    await writeFile(outside, "hello");
    await rm(path);
    await symlink(outside, path);
    await assert.rejects(resolveManagedFixtureFile(fixture.file, "one"), /symbolic link/);
    assert.deepEqual(await listManagedFixtures("one"), []);
  }));
