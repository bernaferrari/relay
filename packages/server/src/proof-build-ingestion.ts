import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  artifactDigestForProof,
  artifactSourceSha256,
  canonicalSha256,
  saveBuild,
} from "@relay/core";
import {
  changeVerificationBuildSchema,
  proofBuildDefinitionSchema,
  type Build,
  type ChangeVerificationBuild,
} from "@relay/protocol";

const execFileAsync = promisify(execFile);
const EXACT_SHA = /^[a-f0-9]{40}$/u;
const MAX_POLICY_BYTES = 4 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 15 * 60 * 1_000;
const TOOLCHAIN_TIMEOUT_MS = 10_000;
const TOOLCHAIN_OUTPUT_BYTES = 64 * 1024;

type BuildDefinition = ReturnType<typeof proofBuildDefinitionSchema.parse>;

export type ProofBuildIngestionReceipt = {
  schemaVersion: 1;
  buildId: string;
  source: { repositoryRoot: string; sha: string; treeSha: string };
  command: { executable: string; args: readonly string[]; digest: `sha256:${string}` };
  toolchain: {
    version: string;
    node: string;
    platform: string;
    arch: string;
    identityDigest: `sha256:${string}`;
  };
  artifact: {
    reviewedPath: string;
    storedPath: string;
    digest: `sha256:${string}`;
    sourceSha256: string;
  };
};

type SaveBuild = (input: Omit<Build, "createdAt" | "updatedAt">) => Promise<Build>;

async function runGit(root: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return result.stdout.trim();
}

async function assertExactCleanSource(root: string, testedSha: string): Promise<string> {
  if (!EXACT_SHA.test(testedSha)) throw new Error("tested SHA must be an exact Git commit SHA");
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("source workspace must be a real repository directory");
  }
  const realRoot = await realpath(root);
  const top = await realpath(await runGit(root, ["rev-parse", "--show-toplevel"]));
  if (top !== realRoot) throw new Error("source workspace must be the exact repository root");
  const head = await runGit(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (head !== testedSha) throw new Error("tested SHA must equal the source workspace HEAD");
  const status = await runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (status) throw new Error("source workspace must be clean before automatic build ingestion");
  return realRoot;
}

function artifactPath(workspace: string, definition: BuildDefinition): string {
  const path = resolve(workspace, definition.artifactPath);
  if (path === workspace || !path.startsWith(`${workspace}${sep}`)) {
    throw new Error("reviewed artifact path must stay inside the exact-SHA workspace");
  }
  return path;
}

async function readDefinition(workspace: string, definitionId: string): Promise<BuildDefinition> {
  const directory = join(workspace, ".relay");
  const policyPath = join(directory, "change-proof.json");
  const [directoryInfo, policyInfo] = await Promise.all([lstat(directory), lstat(policyPath)]);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error("reviewed .relay directory cannot be a symbolic link");
  }
  if (!policyInfo.isFile() || policyInfo.isSymbolicLink()) {
    throw new Error("reviewed .relay/change-proof.json must be a regular file");
  }
  if (policyInfo.size > MAX_POLICY_BYTES) throw new Error("reviewed Proof policy exceeds 4 MiB");
  const bytes = await readFile(policyPath);
  if (bytes.byteLength > MAX_POLICY_BYTES) throw new Error("reviewed Proof policy exceeds 4 MiB");
  const raw = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  if (!Array.isArray(raw.buildDefinitions) || raw.buildDefinitions.length > 32) {
    throw new Error("reviewed Proof policy must contain at most 32 buildDefinitions");
  }
  const definitions = raw.buildDefinitions.map((value) => proofBuildDefinitionSchema.parse(value));
  if (new Set(definitions.map(({ id }) => id)).size !== definitions.length) {
    throw new Error("reviewed buildDefinitions must have unique ids");
  }
  const definition = definitions.find(({ id }) => id === definitionId);
  if (!definition) throw new Error(`reviewed build definition ${definitionId} was not found`);
  return definition;
}

async function toolchainIdentity(
  definition: BuildDefinition,
  workspace: string,
): Promise<ProofBuildIngestionReceipt["toolchain"]> {
  let version = "unavailable";
  try {
    const result = await execFileAsync(definition.command.executable, ["--version"], {
      cwd: workspace,
      encoding: "utf8",
      timeout: TOOLCHAIN_TIMEOUT_MS,
      maxBuffer: TOOLCHAIN_OUTPUT_BYTES,
    });
    version = `${result.stdout}\n${result.stderr}`.trim().slice(0, 1_024) || "unreported";
  } catch {
    // Some reviewed build executables do not expose a version flag. The
    // explicit unavailable value remains part of the captured identity.
  }
  const identity = {
    version,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };
  return { ...identity, identityDigest: canonicalSha256(identity) };
}

async function runReviewedCommand(definition: BuildDefinition, workspace: string): Promise<void> {
  await execFileAsync(definition.command.executable, [...definition.command.args], {
    cwd: workspace,
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function validateArtifact(
  workspace: string,
  definition: BuildDefinition,
): Promise<{ path: string; digest: `sha256:${string}`; sourceSha256: string }> {
  const path = artifactPath(workspace, definition);
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!info) throw new Error(`reviewed build did not produce ${definition.artifactPath}`);
  if (info.isSymbolicLink()) throw new Error("reviewed build artifact cannot be a symbolic link");
  const expected =
    definition.platform === "android"
      ? info.isFile() && path.toLowerCase().endsWith(".apk")
      : definition.platform === "ios"
        ? info.isDirectory() && path.toLowerCase().endsWith(".app")
        : info.isFile() || info.isDirectory();
  if (!expected) throw new Error("reviewed build produced the wrong artifact format or filename");
  const resolved = await realpath(path);
  const realWorkspace = await realpath(workspace);
  if (!resolved.startsWith(`${realWorkspace}${sep}`)) {
    throw new Error("reviewed build artifact resolves outside the exact-SHA workspace");
  }
  return {
    path,
    digest: await artifactDigestForProof(path),
    sourceSha256: await artifactSourceSha256(path),
  };
}

async function retainArtifact(input: {
  stateRoot: string;
  testedSha: string;
  definition: BuildDefinition;
  artifact: Awaited<ReturnType<typeof validateArtifact>>;
}): Promise<string> {
  await mkdir(input.stateRoot, { recursive: true });
  const stateInfo = await lstat(input.stateRoot);
  if (!stateInfo.isDirectory() || stateInfo.isSymbolicLink()) {
    throw new Error("build state root must be a real directory");
  }
  const parent = join(input.stateRoot, "builds", "ingested");
  await mkdir(parent, { recursive: true });
  const key = createHash("sha256")
    .update(`${input.testedSha}\0${input.definition.id}\0${input.artifact.digest}`)
    .digest("hex");
  const finalDirectory = join(parent, key);
  const destination = join(finalDirectory, basename(input.artifact.path));
  const existing = await lstat(destination).catch(() => undefined);
  if (existing) {
    if ((await artifactDigestForProof(destination)) !== input.artifact.digest) {
      throw new Error("retained build artifact conflicts with its content address");
    }
    return destination;
  }
  const temporary = join(parent, `.ingest-${randomUUID()}`);
  try {
    await mkdir(temporary);
    const staged = join(temporary, basename(input.artifact.path));
    await cp(input.artifact.path, staged, {
      recursive: (await lstat(input.artifact.path)).isDirectory(),
      force: false,
      errorOnExist: true,
      dereference: false,
    });
    if ((await artifactDigestForProof(staged)) !== input.artifact.digest) {
      throw new Error("retained build artifact changed while it was copied");
    }
    await rename(temporary, finalDirectory).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    if ((await artifactDigestForProof(destination)) !== input.artifact.digest) {
      throw new Error("retained build artifact does not match the reviewed output");
    }
    return destination;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function observedEnvironmentRevision(
  definition: BuildDefinition,
  toolchain: ProofBuildIngestionReceipt["toolchain"],
): string {
  const suffix = toolchain.identityDigest.slice("sha256:".length, "sha256:".length + 16);
  return `${definition.environmentRevision.slice(0, 230)}@${suffix}`;
}

export async function ingestReviewedProofBuild(input: {
  projectId: string;
  repositoryRoot: string;
  testedSha: string;
  definitionId: string;
  stateRoot?: string;
  save?: SaveBuild;
}): Promise<{
  build: Build;
  verificationBuild: ChangeVerificationBuild;
  receipt: ProofBuildIngestionReceipt;
}> {
  const repositoryRoot = await assertExactCleanSource(input.repositoryRoot, input.testedSha);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "relay-proof-build-"));
  const workspace = join(temporaryRoot, "workspace");
  let materialized = false;
  try {
    await runGit(repositoryRoot, [
      "worktree",
      "add",
      "--detach",
      "--force",
      workspace,
      input.testedSha,
    ]);
    materialized = true;
    const [head, treeSha, status] = await Promise.all([
      runGit(workspace, ["rev-parse", "--verify", "HEAD^{commit}"]),
      runGit(workspace, ["rev-parse", "--verify", "HEAD^{tree}"]),
      runGit(workspace, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    ]);
    if (head !== input.testedSha || !EXACT_SHA.test(treeSha) || status) {
      throw new Error("isolated build workspace did not materialize the exact clean tested SHA");
    }
    const definition = await readDefinition(workspace, input.definitionId);
    const output = artifactPath(workspace, definition);
    if (await lstat(output).catch(() => undefined)) {
      throw new Error("reviewed artifact path must not exist before the reviewed build command");
    }
    const toolchain = await toolchainIdentity(definition, workspace);
    await runReviewedCommand(definition, workspace);
    if (await runGit(workspace, ["diff", "--name-only", "-z", "HEAD", "--"])) {
      throw new Error("reviewed build command modified tracked source files");
    }
    const artifact = await validateArtifact(workspace, definition);
    const storedPath = await retainArtifact({
      stateRoot:
        input.stateRoot ?? process.env.RELAY_STATE_DIR?.trim() ?? join(repositoryRoot, ".relay"),
      testedSha: input.testedSha,
      definition,
      artifact,
    });
    const environmentRevision = observedEnvironmentRevision(definition, toolchain);
    const buildInput: Omit<Build, "createdAt" | "updatedAt"> = {
      id: definition.id,
      projectId: input.projectId,
      name: definition.name,
      platform: definition.platform,
      sourceUrl: definition.platform === "web" ? definition.webDeployment!.url : storedPath,
      sourceSha256: artifact.sourceSha256,
      sourceSha: input.testedSha,
      configuration: definition.configuration,
      environmentRevision,
      ...(definition.applicationId ? { applicationId: definition.applicationId } : {}),
      ...(definition.platform === "web"
        ? { deploymentDigest: definition.webDeployment!.deploymentDigest }
        : {}),
      status: "ready",
    };
    const build = await (input.save ?? saveBuild)(buildInput);
    const proofArtifactDigest =
      definition.platform === "web" ? definition.webDeployment!.deploymentDigest : artifact.digest;
    const verificationBuild = changeVerificationBuildSchema.parse({
      id: definition.id,
      platform: definition.platform,
      artifactDigest: proofArtifactDigest,
      sourceSha: input.testedSha,
      configuration: definition.configuration,
      environmentRevision,
    });
    const receipt: ProofBuildIngestionReceipt = {
      schemaVersion: 1,
      buildId: definition.id,
      source: { repositoryRoot, sha: input.testedSha, treeSha },
      command: {
        executable: definition.command.executable,
        args: definition.command.args,
        digest: canonicalSha256(definition.command),
      },
      toolchain,
      artifact: {
        reviewedPath: definition.artifactPath,
        storedPath,
        digest: artifact.digest,
        sourceSha256: artifact.sourceSha256,
      },
    };
    return { build, verificationBuild, receipt };
  } finally {
    if (materialized) {
      await runGit(repositoryRoot, ["worktree", "remove", "--force", workspace]).catch(
        () => undefined,
      );
      await runGit(repositoryRoot, ["worktree", "prune"]).catch(() => undefined);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
