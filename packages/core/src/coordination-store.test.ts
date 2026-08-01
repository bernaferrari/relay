import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  atomicWriteFile,
  BoundedIdempotencyStore,
  IdempotencyConflict,
  KeyedSerialQueue,
  payloadFingerprint,
} from "./coordination-store.js";

test("keyed serialization preserves same-resource order without blocking other resources", async () => {
  const queue = new KeyedSerialQueue();
  const order: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = queue.run("journey:a", async () => {
    order.push("a:start");
    await blocked;
    order.push("a:end");
  });
  const second = queue.run("journey:a", async () => {
    order.push("a:second");
  });
  await queue.run("journey:b", async () => {
    order.push("b");
  });
  assert.deepEqual(order, ["a:start", "b"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["a:start", "b", "a:end", "a:second"]);
  assert.equal(queue.activeKeys, 0);
});

test("bounded idempotency rejects payload reuse and evicts old entries", () => {
  const store = new BoundedIdempotencyStore<{ id: string }>(2, 100);
  const one = payloadFingerprint({ title: "One" });
  store.set("one", one, { id: "one" }, 1);
  assert.deepEqual(store.get("one", one, 2), { id: "one" });
  assert.throws(
    () => store.get("one", payloadFingerprint({ title: "Different" }), 2),
    IdempotencyConflict,
  );
  store.set("two", payloadFingerprint(2), { id: "two" }, 2);
  store.set("three", payloadFingerprint(3), { id: "three" }, 3);
  assert.equal(store.size, 2);
  assert.equal(store.get("one", one, 102), undefined);
});

test("atomic writes clean temporary files when rename fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-atomic-write-"));
  const destination = join(root, "destination");
  await mkdir(destination);
  try {
    await assert.rejects(() => atomicWriteFile(destination, "content"));
    assert.deepEqual(await readdir(root), ["destination"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
