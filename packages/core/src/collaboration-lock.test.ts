import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { withCollaborationLock } from "./collaboration-lock.js";

test("a stale collaboration lock from a dead process is stolen", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-collab-lock-"));
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "collaboration.lock"), "999999999\n", "utf8");
  const seen: number[] = [];
  await withCollaborationLock(root, async () => {
    seen.push(1);
  });
  assert.deepEqual(seen, [1]);
});

test("collaboration locks serialize overlapping writers", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-collab-lock-serial-"));
  const order: string[] = [];
  let release!: () => void;
  let firstEntered!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const firstHasLock = new Promise<void>((resolve) => (firstEntered = resolve));
  const first = withCollaborationLock(root, async () => {
    order.push("first:start");
    firstEntered();
    await held;
    order.push("first:end");
  });
  await firstHasLock;
  const second = withCollaborationLock(root, async () => {
    order.push("second");
  });
  assert.deepEqual(order, ["first:start"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first:start", "first:end", "second"]);
});
