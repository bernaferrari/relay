import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MAX_UPLOAD_FILE_BYTES, resolveWorkspaceUploadFile } from "./browser-actuation.js";

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "relay-upload-file-"));
  await mkdir(join(root, "fixtures"), { recursive: true });
  await writeFile(join(root, "fixtures", "avatar.png"), "png-bytes");
  return root;
}

test("a workspace-relative file resolves to its real path inside the workspace", async () => {
  const root = await workspace();
  try {
    // macOS tmpdir is itself a symlink; the contract returns real paths.
    const realFile = await realpath(join(root, "fixtures", "avatar.png"));
    const resolved = await resolveWorkspaceUploadFile("fixtures/avatar.png", root);
    assert.equal(resolved, realFile);
    // Nested ../ that stays inside the workspace is still inside it.
    const nested = await resolveWorkspaceUploadFile("fixtures/../fixtures/avatar.png", root);
    assert.equal(nested, realFile);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("absolute paths are traversal by contract", async () => {
  const root = await workspace();
  try {
    await assert.rejects(resolveWorkspaceUploadFile("/etc/passwd", root), /workspace-relative/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dot-dot escapes are rejected even when the file exists", async () => {
  const root = await workspace();
  const outside = await mkdtemp(join(tmpdir(), "relay-upload-outside-"));
  try {
    await writeFile(join(outside, "secret.txt"), "secret");
    const escape = `../${outside.split("/").at(-1)}/secret.txt`;
    await assert.rejects(resolveWorkspaceUploadFile(escape, root), /escapes the workspace root/u);
    await assert.rejects(
      resolveWorkspaceUploadFile("../../etc/passwd", root),
      /escapes the workspace root|does not exist/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("a symlink inside the workspace cannot point outside it", async () => {
  const root = await workspace();
  const outside = await mkdtemp(join(tmpdir(), "relay-upload-outside-"));
  try {
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(join(outside, "secret.txt"), join(root, "fixtures", "link.txt"));
    await assert.rejects(
      resolveWorkspaceUploadFile("fixtures/link.txt", root),
      /escapes the workspace root/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("missing files, directories, and oversize files fail closed", async () => {
  const root = await workspace();
  try {
    await assert.rejects(
      resolveWorkspaceUploadFile("fixtures/missing.png", root),
      /does not exist/u,
    );
    await assert.rejects(resolveWorkspaceUploadFile("fixtures", root), /is not a file/u);
    const big = join(root, "fixtures", "big.bin");
    await writeFile(big, Buffer.alloc(MAX_UPLOAD_FILE_BYTES + 1, 1));
    await assert.rejects(resolveWorkspaceUploadFile("fixtures/big.bin", root), /small-file limit/u);
    await assert.rejects(resolveWorkspaceUploadFile("  ", root), /non-empty/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
