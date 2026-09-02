import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { Build } from "@relay/protocol";
import { ingestReviewedProofBuild } from "./proof-build-ingestion.js";

const execFileAsync = promisify(execFile);

async function git(root: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd: root, encoding: "utf8" });
  return result.stdout.trim();
}

async function repository(input: {
  command: { executable: string; args: string[] };
  artifactPath?: string;
  beforeCommit?: (root: string) => Promise<void>;
}) {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-ingest-repo-"));
  const stateRoot = await mkdtemp(join(tmpdir(), "relay-proof-ingest-state-"));
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "relay@example.test");
  await git(root, "config", "user.name", "Relay Test");
  await git(root, "remote", "add", "origin", "https://github.com/acme/app.git");
  await mkdir(join(root, ".relay"));
  const definition = {
    id: "android-release",
    name: "Android release",
    platform: "android" as const,
    command: input.command,
    artifactPath: input.artifactPath ?? "dist/app-release.apk",
    configuration: "android.release",
    environmentRevision: "fixture-v1",
    applicationId: "com.acme.app",
  };
  await writeFile(
    join(root, ".relay", "change-proof.json"),
    `${JSON.stringify({ schemaVersion: 1, buildDefinitions: [definition] }, null, 2)}\n`,
  );
  await input.beforeCommit?.(root);
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "fixture");
  const sha = await git(root, "rev-parse", "HEAD");
  return {
    root,
    stateRoot,
    sha,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
      await rm(stateRoot, { recursive: true, force: true });
    },
  };
}

const artifactCommand = {
  executable: process.execPath,
  args: [
    "-e",
    "require('fs').mkdirSync('dist',{recursive:true});require('fs').writeFileSync('dist/app-release.apk','exact-artifact')",
  ],
};

test("ingests one reviewed build only from an isolated exact-SHA worktree", async () => {
  const fixture = await repository({ command: artifactCommand });
  try {
    const saved: Array<Omit<Build, "createdAt" | "updatedAt">> = [];
    const result = await ingestReviewedProofBuild({
      projectId: "project-1",
      repositoryRoot: fixture.root,
      testedSha: fixture.sha,
      definitionId: "android-release",
      stateRoot: fixture.stateRoot,
      save: async (build) => {
        saved.push(build);
        return { ...build, createdAt: 1, updatedAt: 1 };
      },
    });

    assert.equal(saved.length, 1);
    assert.equal(result.build.status, "ready");
    assert.equal(result.build.sourceSha, fixture.sha);
    assert.equal(result.verificationBuild.sourceSha, fixture.sha);
    assert.match(result.verificationBuild.artifactDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(await readFile(result.build.sourceUrl!, "utf8"), "exact-artifact");
    await assert.rejects(readFile(join(fixture.root, "dist/app-release.apk")), /ENOENT/u);
    assert.equal(result.receipt.source.treeSha.length, 40);
    assert.match(result.receipt.policy.digest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(result.receipt.command.executable, process.execPath);
    assert.match(result.receipt.toolchain.identityDigest, /^sha256:[a-f0-9]{64}$/u);
  } finally {
    await fixture.cleanup();
  }
});

test("fails closed on dirty or wrong-SHA source before running the reviewed command", async () => {
  const fixture = await repository({ command: artifactCommand });
  try {
    await writeFile(join(fixture.root, "dirty.txt"), "not committed");
    await assert.rejects(
      ingestReviewedProofBuild({
        projectId: "project-1",
        repositoryRoot: fixture.root,
        testedSha: fixture.sha,
        definitionId: "android-release",
        stateRoot: fixture.stateRoot,
      }),
      /source workspace must be clean/u,
    );
    await rm(join(fixture.root, "dirty.txt"));
    await assert.rejects(
      ingestReviewedProofBuild({
        projectId: "project-1",
        repositoryRoot: fixture.root,
        testedSha: "f".repeat(40),
        definitionId: "android-release",
        stateRoot: fixture.stateRoot,
      }),
      /tested SHA must resolve to the exact commit/u,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("forces a tracked reviewed artifact to be rebuilt instead of accepting stale bytes", async () => {
  const stale = await repository({
    command: { executable: process.execPath, args: ["-e", "// intentionally does not rebuild"] },
    beforeCommit: async (root) => {
      await mkdir(join(root, "dist"));
      await writeFile(join(root, "dist", "app-release.apk"), "tracked-stale-output");
    },
  });
  try {
    await assert.rejects(
      ingestReviewedProofBuild({
        projectId: "project-1",
        repositoryRoot: stale.root,
        testedSha: stale.sha,
        definitionId: "android-release",
        stateRoot: stale.stateRoot,
      }),
      /reviewed build did not produce/u,
    );
  } finally {
    await stale.cleanup();
  }
});

test("rejects symlinked artifacts without registering a build", async () => {
  const symlinked = await repository({
    command: {
      executable: process.execPath,
      args: [
        "-e",
        "require('fs').mkdirSync('dist',{recursive:true});require('fs').symlinkSync('/tmp','dist/app-release.apk')",
      ],
    },
  });
  try {
    await assert.rejects(
      ingestReviewedProofBuild({
        projectId: "project-1",
        repositoryRoot: symlinked.root,
        testedSha: symlinked.sha,
        definitionId: "android-release",
        stateRoot: symlinked.stateRoot,
      }),
      /cannot be a symbolic link/u,
    );
  } finally {
    await symlinked.cleanup();
  }
});

test("materializes an older exact SHA using the current reviewed build policy", async () => {
  const fixture = await repository({ command: artifactCommand });
  try {
    const historicalSha = fixture.sha;
    await writeFile(join(fixture.root, "later.txt"), "current checkout is newer");
    await writeFile(
      join(fixture.root, ".relay", "change-proof.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          buildDefinitions: [
            {
              id: "android-release",
              name: "Android release from current reviewed policy",
              platform: "android",
              command: artifactCommand,
              artifactPath: "dist/app-release.apk",
              configuration: "android.release",
              environmentRevision: "fixture-v2",
              applicationId: "com.acme.app",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    await git(fixture.root, "add", ".");
    await git(fixture.root, "commit", "-qm", "new checkout and reviewed policy");

    const result = await ingestReviewedProofBuild({
      projectId: "project-1",
      repositoryRoot: fixture.root,
      testedSha: historicalSha,
      definitionId: "android-release",
      stateRoot: fixture.stateRoot,
      save: async (build) => ({ ...build, createdAt: 1, updatedAt: 1 }),
    });

    assert.equal(result.build.sourceSha, historicalSha);
    assert.equal(result.build.name, "Android release from current reviewed policy");
    assert.equal(result.verificationBuild.sourceSha, historicalSha);
  } finally {
    await fixture.cleanup();
  }
});

test("ingests from a clean checkout when setup policy is locally ignored", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-ingest-ignored-policy-"));
  const stateRoot = await mkdtemp(join(tmpdir(), "relay-proof-ingest-state-"));
  try {
    await git(root, "init", "-q");
    await git(root, "config", "user.email", "relay@example.test");
    await git(root, "config", "user.name", "Relay Test");
    await writeFile(join(root, ".gitignore"), ".relay/\n");
    await git(root, "add", ".gitignore");
    await git(root, "commit", "-qm", "fixture without tracked policy");
    const sha = await git(root, "rev-parse", "HEAD");
    await mkdir(join(root, ".relay"));
    await writeFile(
      join(root, ".relay", "change-proof.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        buildDefinitions: [
          {
            id: "android-release",
            name: "Ignored local policy",
            platform: "android",
            command: artifactCommand,
            artifactPath: "dist/app-release.apk",
            configuration: "android.release",
            environmentRevision: "fixture-v1",
            applicationId: "com.acme.app",
          },
        ],
      })}\n`,
    );
    assert.equal(await git(root, "status", "--porcelain=v1", "--untracked-files=all"), "");

    const result = await ingestReviewedProofBuild({
      projectId: "project-1",
      repositoryRoot: root,
      testedSha: sha,
      definitionId: "android-release",
      stateRoot,
      save: async (build) => ({ ...build, createdAt: 1, updatedAt: 1 }),
    });

    assert.equal(result.build.name, "Ignored local policy");
    assert.equal(result.build.sourceSha, sha);
    assert.match(result.receipt.policy.digest, /^sha256:[a-f0-9]{64}$/u);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});
