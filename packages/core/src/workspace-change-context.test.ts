import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { inspectWorkspaceChange } from "./workspace-change-context.js";

const execFileAsync = promisify(execFile);

async function git(root: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd: root, encoding: "utf8" });
  return result.stdout.trim();
}

test("active worktree resolves exact change identity without renderer navigation authority", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "relay-workspace-change-"));
  try {
    await git(root, "init", "-b", "main");
    await git(root, "config", "user.name", "Relay Test");
    await git(root, "config", "user.email", "relay@example.test");
    await writeFile(join(root, "README.md"), "base\n");
    await git(root, "add", "README.md");
    await git(root, "commit", "-m", "Initial state");
    const baseSha = await git(root, "rev-parse", "HEAD");
    await git(root, "remote", "add", "origin", "git@github.com:acme/settings.git");
    await git(root, "update-ref", "refs/remotes/origin/main", baseSha);
    await git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    await git(root, "switch", "-c", "feature/arabic-settings");
    await writeFile(join(root, "README.md"), "arabic settings\n");
    await git(root, "add", "README.md");
    await git(root, "commit", "-m", "Add Arabic settings");
    await mkdir(join(root, "nested"));

    const context = await inspectWorkspaceChange({ startPath: join(root, "nested") });

    assert.equal(context.status, "resolved");
    assert.equal(context.workspace.name, root.split("/").at(-1));
    assert.equal(context.repository, "acme/settings");
    assert.equal(context.branch, "feature/arabic-settings");
    assert.deepEqual(context.base, { label: "main", sha: baseSha });
    assert.equal(context.head?.label, "Add Arabic settings");
    assert.deepEqual(context.changedFiles, ["README.md"]);
    assert.equal(context.readyForProof, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uncommitted workspace state remains visible and blocks a frozen Proof", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "relay-workspace-dirty-"));
  try {
    await git(root, "init", "-b", "main");
    await git(root, "config", "user.name", "Relay Test");
    await git(root, "config", "user.email", "relay@example.test");
    await writeFile(join(root, "base.txt"), "base\n");
    await git(root, "add", "base.txt");
    await git(root, "commit", "-m", "Base");
    const baseSha = await git(root, "rev-parse", "HEAD");
    await git(root, "remote", "add", "origin", "https://github.com/acme/settings.git");
    await git(root, "update-ref", "refs/remotes/origin/main", baseSha);
    await git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    await writeFile(join(root, "head.txt"), "head\n");
    await git(root, "add", "head.txt");
    await git(root, "commit", "-m", "Head");
    await writeFile(join(root, "uncommitted.txt"), "not frozen\n");

    const context = await inspectWorkspaceChange({ startPath: root });

    assert.equal(context.localChangeCount, 1);
    assert.deepEqual(context.localChanges, ["uncommitted.txt"]);
    assert.equal(context.readyForProof, false);
    assert.match(context.blockers.join("\n"), /not part of the frozen head/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a workspace already at its comparison revision is inspectable but not provable", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "relay-workspace-no-change-"));
  try {
    await git(root, "init", "-b", "main");
    await git(root, "config", "user.name", "Relay Test");
    await git(root, "config", "user.email", "relay@example.test");
    await writeFile(join(root, "README.md"), "current\n");
    await git(root, "add", "README.md");
    await git(root, "commit", "-m", "Current state");
    const headSha = await git(root, "rev-parse", "HEAD");
    await git(root, "remote", "add", "origin", "https://github.com/acme/settings.git");
    await git(root, "update-ref", "refs/remotes/origin/main", headSha);
    await git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");

    const context = await inspectWorkspaceChange({ startPath: root });

    assert.equal(context.status, "resolved");
    assert.equal(context.changeRef, undefined);
    assert.equal(context.readyForProof, false);
    assert.match(context.blockers.join("\n"), /same as its comparison revision/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("comparison freezes the common ancestor instead of the moving branch tip", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "relay-workspace-merge-base-"));
  try {
    await git(root, "init", "-b", "main");
    await git(root, "config", "user.name", "Relay Test");
    await git(root, "config", "user.email", "relay@example.test");
    await writeFile(join(root, "shared.txt"), "shared\n");
    await git(root, "add", "shared.txt");
    await git(root, "commit", "-m", "Shared state");
    const commonAncestor = await git(root, "rev-parse", "HEAD");
    await git(root, "switch", "-c", "feature/settings");
    await writeFile(join(root, "feature.txt"), "feature\n");
    await git(root, "add", "feature.txt");
    await git(root, "commit", "-m", "Feature work");
    await git(root, "switch", "main");
    await writeFile(join(root, "upstream.txt"), "upstream\n");
    await git(root, "add", "upstream.txt");
    await git(root, "commit", "-m", "Upstream work");
    const movingTip = await git(root, "rev-parse", "HEAD");
    await git(root, "remote", "add", "origin", "https://github.com/acme/settings.git");
    await git(root, "update-ref", "refs/remotes/origin/main", movingTip);
    await git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    await git(root, "switch", "feature/settings");

    const context = await inspectWorkspaceChange({ startPath: root });

    assert.deepEqual(context.base, { label: "main", sha: commonAncestor });
    assert.deepEqual(context.changedFiles, ["feature.txt"]);
    assert.equal(context.readyForProof, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
