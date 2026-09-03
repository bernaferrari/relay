import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  artifactDigestForProof,
  artifactSourceSha256,
  assertAuthoritativeWebDeploymentMatches,
  bindVerifiedWebDeploymentToProof,
  buildTargetProfiles,
  canonicalSha256,
  findWorkspaceRoot,
  issueWebBuildProviderReceiptFromAuthority,
  inspectWorkspaceChange,
  listAppMaps,
  listDevices,
  listTargets,
  readBuild,
  saveBuild,
  saveBuilds,
  type AuthoritativeWebDeploymentLookup,
} from "@relay/core";
import {
  VERIFY_CHANGE_POLICY,
  proofSetupIntentSchema,
  proofSetupPreviewSchema,
  proofBuildDefinitionSchema,
  type OperationInput,
  type ProofSetupIntent,
  type ProofSetupPreview,
} from "@relay/protocol";
import { prepareCurrentChangeVerification } from "./change-proof-preparation.js";

const execFileAsync = promisify(execFile);
const POLICY_PATH = ".relay/change-proof.json" as const;
const COMMAND_TIMEOUT_MS = 15 * 60 * 1_000;

type CommandRunner = (executable: string, args: readonly string[], cwd: string) => Promise<void>;

type PolicyFileOperations = {
  lstat(path: string): ReturnType<typeof lstat>;
  mkdir(path: string): Promise<unknown>;
  readFile(path: string): Promise<Buffer>;
  realpath(path: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
  writeFile(path: string, contents: string): Promise<void>;
};

const policyFileOperations: PolicyFileOperations = {
  lstat,
  mkdir: (path) => mkdir(path),
  readFile: (path) => readFile(path),
  realpath,
  rename,
  rm: (path) => rm(path, { force: true }),
  writeFile: (path, contents) => writeFile(path, contents, { encoding: "utf8", flag: "wx" }),
};

const runCommand: CommandRunner = async (executable, args, cwd) => {
  await execFileAsync(executable, [...args], {
    cwd,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
};

function portablePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function absoluteRepositoryPath(root: string, value: string): string {
  const path = resolve(root, value);
  if (path === root || !path.startsWith(`${root}${sep}`)) {
    throw new Error("build.artifactPath must stay inside the repository");
  }
  return path;
}

async function fileDigest(path: string): Promise<`sha256:${string}` | null> {
  try {
    const bytes = await readFile(path);
    return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function safePolicyPaths(
  root: string,
  files: PolicyFileOperations,
  createDirectory: boolean,
): Promise<{ directory: string; policy: string }> {
  const directory = join(root, ".relay");
  const policy = join(directory, "change-proof.json");
  const rootInfo = await files.lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("Proof setup repository root must be a real directory, not a symlink");
  }
  const realRoot = await files.realpath(root);
  let directoryInfo = await files.lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!directoryInfo && createDirectory) {
    await files.mkdir(directory);
    directoryInfo = await files.lstat(directory);
  }
  if (directoryInfo && (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink())) {
    throw new Error(".relay must be a real repository directory, not a symlink");
  }
  if (directoryInfo && (await files.realpath(directory)) !== join(realRoot, ".relay")) {
    throw new Error(".relay resolves outside its exact repository path");
  }
  const policyInfo = await files.lstat(policy).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (policyInfo && (!policyInfo.isFile() || policyInfo.isSymbolicLink())) {
    throw new Error(".relay/change-proof.json must be a regular file, not a symlink");
  }
  return { directory, policy };
}

async function atomicReplacePolicy(input: {
  root: string;
  document: ProofSetupPreview["policy"]["document"];
  files: PolicyFileOperations;
}): Promise<void> {
  const paths = await safePolicyPaths(input.root, input.files, true);
  const temporary = join(paths.directory, `change-proof.${randomUUID()}.tmp`);
  try {
    await input.files.writeFile(temporary, serializedPolicy(input.document));
    const revalidated = await safePolicyPaths(input.root, input.files, false);
    if (revalidated.directory !== paths.directory || revalidated.policy !== paths.policy) {
      throw new Error("Proof policy path changed during atomic replacement");
    }
    await input.files.rename(temporary, paths.policy);
  } finally {
    await input.files.rm(temporary);
  }
}

async function restorePolicy(input: {
  root: string;
  previous: Buffer | null;
  files: PolicyFileOperations;
}): Promise<void> {
  const paths = await safePolicyPaths(input.root, input.files, false);
  if (input.previous === null) {
    await input.files.rm(paths.policy);
    return;
  }
  const temporary = join(paths.directory, `change-proof.rollback.${randomUUID()}.tmp`);
  try {
    await input.files.writeFile(temporary, input.previous.toString("utf8"));
    await safePolicyPaths(input.root, input.files, false);
    await input.files.rename(temporary, paths.policy);
  } finally {
    await input.files.rm(temporary);
  }
}

function serializedPolicy(document: ProofSetupPreview["policy"]["document"]): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function serializedPolicyDigest(
  document: ProofSetupPreview["policy"]["document"],
): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(serializedPolicy(document)).digest("hex")}`;
}

async function exactChange(root: string, baseRef?: string) {
  const change = await inspectWorkspaceChange({ startPath: root, ...(baseRef ? { baseRef } : {}) });
  if (!change.readyForProof || !change.repository || !change.changeRef) {
    throw new Error(change.blockers.join(" ") || "The active workspace change is not ready.");
  }
  if (change.changedFiles.length !== change.changedFileCount) {
    throw new Error("The active change exceeds the bounded Proof setup file list.");
  }
  return change;
}

async function discoverCommands(root: string) {
  try {
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      packageManager?: unknown;
      scripts?: unknown;
    };
    if (
      !manifest.scripts ||
      typeof manifest.scripts !== "object" ||
      Array.isArray(manifest.scripts)
    ) {
      return [];
    }
    const manager =
      typeof manifest.packageManager === "string"
        ? manifest.packageManager.split("@", 1)[0] || "npm"
        : "npm";
    return Object.entries(manifest.scripts)
      .filter(
        ([name, value]) =>
          typeof value === "string" && /(^|:)(build|assemble|archive|package)(:|$)/iu.test(name),
      )
      .slice(0, 32)
      .map(([name]) => ({
        executable: manager,
        args: ["run", name],
        source: `package.json#scripts.${name}`,
      }));
  } catch {
    return [];
  }
}

async function discoverArtifacts(root: string) {
  const found: Array<{ path: string; platform: "android" | "ios" | "web" }> = [];
  const ignored = new Set([".git", ".relay", "node_modules", "vendor"]);
  let visited = 0;
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 5 || visited > 4_000 || found.length >= 64) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > 4_000 || found.length >= 64) return;
      if (ignored.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".apk")) {
        found.push({ path: portablePath(root, path), platform: "android" });
      } else if (entry.isDirectory() && entry.name.toLowerCase().endsWith(".app")) {
        found.push({ path: portablePath(root, path), platform: "ios" });
      } else if (
        entry.isDirectory() &&
        new Set(["dist", "build", "out", ".next"]).has(entry.name.toLowerCase())
      ) {
        found.push({ path: portablePath(root, path), platform: "web" });
      } else if (entry.isDirectory()) {
        await visit(path, depth + 1);
      }
    }
  };
  await visit(root, 0);
  return found.sort((left, right) => left.path.localeCompare(right.path));
}

export async function inspectProofSetup(input: {
  projectId: string;
  baseRef?: string;
  root?: string;
}) {
  const root = input.root ?? findWorkspaceRoot();
  const change = await exactChange(root, input.baseRef);
  const [commands, artifacts, appMaps, devices, targets] = await Promise.all([
    discoverCommands(root),
    discoverArtifacts(root),
    listAppMaps(input.projectId),
    listDevices().catch(() => []),
    listTargets(),
  ]);
  const profiles = buildTargetProfiles({ devices, targets });
  return {
    schemaVersion: 1 as const,
    change: {
      repository: change.repository!,
      testedSha: change.changeRef!.testedSha,
      changedFiles: change.changedFiles,
    },
    policy: { path: POLICY_PATH, digest: await fileDigest(join(root, POLICY_PATH)) },
    candidates: {
      commands,
      artifacts,
      tests: appMaps.flatMap((appMap) =>
        Object.values(appMap.tests).map((test) => ({
          appMapId: appMap.id,
          testId: test.id,
          name: test.name,
        })),
      ),
      targets: profiles.map((profile) => ({
        targetId: profile.targetId,
        profileId: profile.id,
        name: profile.name,
        platform: profile.platform,
        targetCase: {
          id: `target-case:${profile.id}`,
          executionTarget:
            profile.source === "device"
              ? {
                  schemaVersion: 1 as const,
                  kind: "local-device" as const,
                  provider: { key: "relay.local.agent-device" as const, scope: "local" as const },
                  targetId: profile.targetId,
                  platform: profile.platform as "android" | "ios",
                  identity: { kind: "device-serial" as const, value: profile.targetId },
                }
              : {
                  schemaVersion: 1 as const,
                  kind: "local-browser" as const,
                  provider: { key: "relay.local.browser" as const, scope: "local" as const },
                  targetId: profile.targetId,
                  platform: "browser" as const,
                  identity: { kind: "browser-target" as const, value: profile.targetId },
                },
          targetProfile: profile,
          dimensions: {},
          required: true,
        },
      })),
    },
    requiredFields: [
      "build.command",
      "build.artifactPath",
      "build.configuration",
      "build.environmentRevision",
      "associations (reviewed Test-to-change mappings)",
      "targetCases (explicit required/advisory targets)",
    ],
  };
}

async function validateReviewedAssociations(
  projectId: string,
  associations: ProofSetupIntent["associations"],
): Promise<void> {
  const appMaps = await listAppMaps(projectId);
  for (const association of associations) {
    if (association.review.status !== "reviewed") {
      throw new Error(`associations.${association.id}.review.status must be reviewed`);
    }
    const appMap = appMaps.find(({ id }) => id === association.appMapId);
    if (!appMap?.tests[association.testId]) {
      throw new Error(
        `associations.${association.id} names missing Test ${association.appMapId}/${association.testId}`,
      );
    }
  }
}

function previewAuthority(value: Omit<ProofSetupPreview, "previewDigest">): ProofSetupPreview {
  return proofSetupPreviewSchema.parse({ ...value, previewDigest: canonicalSha256(value) });
}

export async function previewProofSetup(input: {
  projectId: string;
  intent: OperationInput<"proof.setup.preview">;
  root?: string;
  run?: CommandRunner;
  change?: typeof exactChange;
  validateTests?: typeof validateReviewedAssociations;
  lookupWebDeployment?: AuthoritativeWebDeploymentLookup;
}): Promise<ProofSetupPreview> {
  const root = input.root ?? findWorkspaceRoot();
  const intent = proofSetupIntentSchema.parse(input.intent);
  const policyPath = (await safePolicyPaths(root, policyFileOperations, false)).policy;
  const change = await (input.change ?? exactChange)(root, intent.baseRef);
  await (input.validateTests ?? validateReviewedAssociations)(input.projectId, intent.associations);
  const builds = intent.builds ?? [intent.build!];
  const artifacts: Array<{
    path: string;
    digest: `sha256:${string}`;
    sourceSha256: string;
  }> = [];
  const policyBuilds: Array<{
    id: string;
    platform: "android" | "ios" | "web";
    artifactDigest: `sha256:${string}`;
    sourceSha: string;
    configuration: string;
    environmentRevision: string;
  }> = [];
  const resolvedBuilds: Array<ReturnType<typeof proofBuildDefinitionSchema.parse>> = [];
  for (const build of builds) {
    await (input.run ?? runCommand)(build.command.executable, build.command.args, root);
    const artifactPath = absoluteRepositoryPath(root, build.artifactPath);
    const artifactInfo = await lstat(artifactPath).catch(() => null);
    const expectedArtifact =
      build.platform === "android"
        ? artifactInfo?.isFile() && artifactPath.toLowerCase().endsWith(".apk")
        : build.platform === "ios"
          ? artifactInfo?.isDirectory() && artifactPath.toLowerCase().endsWith(".app")
          : Boolean(artifactInfo?.isFile() || artifactInfo?.isDirectory());
    if (!expectedArtifact) {
      throw new Error(
        `builds.${build.id}.artifactPath must name the generated ${build.platform === "android" ? ".apk file" : build.platform === "ios" ? ".app directory" : "web output file or directory"}: ${build.artifactPath}`,
      );
    }
    const artifactDigest = await artifactDigestForProof(artifactPath);
    const sourceSha256 = await artifactSourceSha256(artifactPath);
    artifacts.push({ path: build.artifactPath, digest: artifactDigest, sourceSha256 });
    const webExpected =
      build.platform === "web"
        ? {
            sourceUrl: build.webDeployment!.url,
            sourceSha: change.changeRef!.testedSha,
            configuration: build.configuration,
            ...(build.webDeployment!.deploymentDigest
              ? {
                  deploymentDigest: build.webDeployment!.deploymentDigest as `sha256:${string}`,
                }
              : {}),
          }
        : undefined;
    const webDeployment = webExpected
      ? await (input.lookupWebDeployment
          ? input.lookupWebDeployment(webExpected)
          : Promise.reject(
              new Error("Provider-verified web setup requires an authoritative deployment lookup"),
            ))
      : undefined;
    if (webExpected && webDeployment) {
      assertAuthoritativeWebDeploymentMatches(webExpected, webDeployment);
    }
    const resolvedBuild =
      build.platform === "web"
        ? {
            ...build,
            environmentRevision: webDeployment!.environmentRevision,
            webDeployment: {
              url: webDeployment!.sourceUrl,
              deploymentDigest: webDeployment!.deploymentDigest,
            },
          }
        : build;
    resolvedBuilds.push(resolvedBuild);
    const proofArtifactDigest =
      build.platform === "web"
        ? bindVerifiedWebDeploymentToProof({
            deployment: {
              id: webDeployment!.deploymentId,
              url: webDeployment!.sourceUrl,
              sourceSha: webDeployment!.sourceSha,
              deploymentDigest: webDeployment!.deploymentDigest,
              configuration: webDeployment!.configuration,
              environmentRevision: webDeployment!.environmentRevision,
            },
            changeTestedSha: change.changeRef!.testedSha,
          }).artifactDigest
        : artifactDigest;
    policyBuilds.push({
      id: resolvedBuild.id,
      platform: build.platform,
      artifactDigest: proofArtifactDigest,
      sourceSha: change.changeRef!.testedSha,
      configuration: build.configuration,
      environmentRevision: resolvedBuild.environmentRevision,
    });
  }
  if (new Set(resolvedBuilds.map(({ id }) => id)).size !== resolvedBuilds.length) {
    throw new Error("Provider deployment ids must be unique across the reviewed Proof builds");
  }
  const document = {
    schemaVersion: 1 as const,
    repository: change.repository!,
    changed: {},
    associations: intent.associations,
    buildDefinitions: resolvedBuilds,
    builds: policyBuilds,
    targetCases: intent.targetCases,
    policy: intent.policy ?? VERIFY_CHANGE_POLICY,
  };
  return previewAuthority({
    schemaVersion: 1,
    ...(intent.baseRef ? { baseRef: intent.baseRef } : {}),
    testedSha: change.changeRef!.testedSha,
    command: resolvedBuilds[0]!.command,
    artifact: artifacts[0]!,
    build: {
      id: resolvedBuilds[0]!.id,
      name: resolvedBuilds[0]!.name,
      platform: resolvedBuilds[0]!.platform,
      configuration: resolvedBuilds[0]!.configuration,
      environmentRevision: resolvedBuilds[0]!.environmentRevision,
      ...(resolvedBuilds[0]!.applicationId
        ? { applicationId: resolvedBuilds[0]!.applicationId }
        : {}),
      ...(resolvedBuilds[0]!.webDeployment
        ? { webDeployment: resolvedBuilds[0]!.webDeployment }
        : {}),
    },
    commands: resolvedBuilds.map(({ command }) => command),
    artifacts,
    builds: resolvedBuilds.map((build) => ({
      id: build.id,
      name: build.name,
      platform: build.platform,
      configuration: build.configuration,
      environmentRevision: build.environmentRevision,
      ...(build.applicationId ? { applicationId: build.applicationId } : {}),
      ...(build.webDeployment ? { webDeployment: build.webDeployment } : {}),
    })),
    policy: {
      path: POLICY_PATH,
      document,
      digest: serializedPolicyDigest(document),
      previousDigest: await fileDigest(policyPath),
    },
  });
}

export async function applyProofSetup(input: {
  projectId: string;
  request: OperationInput<"proof.setup.apply">;
  root?: string;
  change?: typeof exactChange;
  save?: typeof saveBuild;
  saveMany?: typeof saveBuilds;
  read?: typeof readBuild;
  prepare?: typeof prepareCurrentChangeVerification;
  validateTests?: typeof validateReviewedAssociations;
  /** Trusted provider adapter used to revalidate web deployment facts at
   * apply-time before Relay signs the persisted Build receipt. */
  lookupWebDeployment?: AuthoritativeWebDeploymentLookup;
  files?: Partial<PolicyFileOperations>;
}) {
  const root = input.root ?? findWorkspaceRoot();
  const files = { ...policyFileOperations, ...input.files };
  const { confirm: _confirm, ...previewInput } = input.request;
  const preview = proofSetupPreviewSchema.parse(previewInput);
  const { previewDigest: _claimedDigest, ...unsigned } = preview;
  if (canonicalSha256(unsigned) !== preview.previewDigest) {
    throw new Error("preview.previewDigest does not match the reviewed Proof setup preview");
  }
  const change = await (input.change ?? exactChange)(root, preview.baseRef);
  if (change.changeRef!.testedSha !== preview.testedSha) {
    throw new Error("preview.testedSha no longer matches the active repository revision");
  }
  if (preview.policy.document.repository !== change.repository) {
    throw new Error("preview.policy.document.repository does not match the active repository");
  }
  await (input.validateTests ?? validateReviewedAssociations)(
    input.projectId,
    preview.policy.document.associations,
  );
  if (preview.policy.path !== POLICY_PATH) {
    throw new Error("Proof setup policy path must be exactly .relay/change-proof.json");
  }
  const safePaths = await safePolicyPaths(root, files, false);
  const policyPath = safePaths.policy;
  const previousPolicy = await files.readFile(policyPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const currentPolicyDigest = previousPolicy
    ? (`sha256:${createHash("sha256").update(previousPolicy).digest("hex")}` as const)
    : null;
  if (
    currentPolicyDigest !== preview.policy.previousDigest &&
    currentPolicyDigest !== preview.policy.digest
  ) {
    throw new Error(".relay/change-proof.json changed after preview; preview the setup again");
  }
  if (serializedPolicyDigest(preview.policy.document) !== preview.policy.digest) {
    throw new Error("preview.policy.digest does not match preview.policy.document");
  }
  const previewBuilds = preview.builds ?? [preview.build];
  const previewArtifacts = preview.artifacts ?? [preview.artifact];
  const previewCommands = preview.commands ?? [preview.command];
  if (
    canonicalSha256(preview.build) !== canonicalSha256(previewBuilds[0]) ||
    canonicalSha256(preview.artifact) !== canonicalSha256(previewArtifacts[0]) ||
    canonicalSha256(preview.command) !== canonicalSha256(previewCommands[0])
  ) {
    throw new Error("legacy preview build fields must match the first reviewed build");
  }
  if (
    previewBuilds.length !== previewArtifacts.length ||
    previewBuilds.length !== previewCommands.length ||
    previewBuilds.length !== preview.policy.document.buildDefinitions.length ||
    previewBuilds.length !== preview.policy.document.builds.length
  ) {
    throw new Error("preview build, command, artifact, and policy collections must align");
  }
  const buildInputs = [];
  for (const [index, build] of previewBuilds.entries()) {
    const artifact = previewArtifacts[index]!;
    const command = previewCommands[index]!;
    const definition = preview.policy.document.buildDefinitions[index]!;
    const reviewedBuild = preview.policy.document.builds[index]!;
    const artifactPath = absoluteRepositoryPath(root, artifact.path);
    const artifactInfo = await lstat(artifactPath).catch(() => null);
    const artifactMatchesPlatform =
      build.platform === "android"
        ? artifactInfo?.isFile() && artifactPath.toLowerCase().endsWith(".apk")
        : build.platform === "ios"
          ? artifactInfo?.isDirectory() && artifactPath.toLowerCase().endsWith(".app")
          : Boolean(artifactInfo?.isFile() || artifactInfo?.isDirectory());
    if (!artifactMatchesPlatform) {
      throw new Error(
        `preview.artifacts.${build.id}.path no longer has the reviewed platform artifact format`,
      );
    }
    if ((await artifactDigestForProof(artifactPath)) !== artifact.digest) {
      throw new Error(`build ${build.id} artifact bytes changed after preview; run preview again`);
    }
    if ((await artifactSourceSha256(artifactPath)) !== artifact.sourceSha256) {
      throw new Error(
        `build ${build.id} artifact sourceSha256 changed after preview; run preview again`,
      );
    }
    const webExpected =
      build.platform === "web"
        ? {
            sourceUrl: build.webDeployment!.url,
            sourceSha: preview.testedSha,
            deploymentDigest: build.webDeployment!.deploymentDigest as `sha256:${string}`,
            configuration: build.configuration,
            environmentRevision: build.environmentRevision,
          }
        : undefined;
    const webIdentity = webExpected
      ? await issueWebBuildProviderReceiptFromAuthority({
          expected: webExpected,
          lookup:
            input.lookupWebDeployment ??
            (() => {
              throw new Error(
                "Provider-verified web setup requires an authoritative deployment lookup",
              );
            }),
        })
      : undefined;
    const reviewedArtifactDigest =
      build.platform === "web" ? webIdentity!.deployment.deploymentDigest : artifact.digest;
    if (
      canonicalSha256(definition.command) !== canonicalSha256(command) ||
      definition.artifactPath !== artifact.path ||
      definition.id !== build.id ||
      definition.name !== build.name ||
      definition.platform !== build.platform ||
      definition.configuration !== build.configuration ||
      definition.environmentRevision !== build.environmentRevision ||
      reviewedBuild.id !== build.id ||
      reviewedBuild.platform !== build.platform ||
      reviewedBuild.sourceSha !== preview.testedSha ||
      reviewedBuild.artifactDigest !== reviewedArtifactDigest ||
      reviewedBuild.configuration !== build.configuration ||
      reviewedBuild.environmentRevision !== build.environmentRevision
    ) {
      throw new Error(`preview build ${build.id} does not match the reviewed policy build`);
    }
    buildInputs.push({
      id: build.id,
      projectId: input.projectId,
      name: build.name,
      platform: build.platform,
      sourceUrl: webIdentity?.deployment.sourceUrl ?? artifact.path,
      sourceSha256: artifact.sourceSha256,
      sourceSha: webIdentity?.deployment.sourceSha ?? preview.testedSha,
      configuration: webIdentity?.deployment.configuration ?? build.configuration,
      environmentRevision: webIdentity?.deployment.environmentRevision ?? build.environmentRevision,
      ...(build.applicationId ? { applicationId: build.applicationId } : {}),
      ...(build.platform === "web"
        ? {
            deploymentDigest: webIdentity!.deployment.deploymentDigest,
            webDeploymentMode: "provider-verified" as const,
            webProviderReceipt: webIdentity!.receipt,
          }
        : {}),
    });
  }
  const save = input.save ?? saveBuild;
  const saveMany =
    input.saveMany ??
    (input.save
      ? async (builds: readonly Parameters<typeof saveBuild>[0][]) => {
          const saved = [];
          for (const build of builds) saved.push(await save(build));
          return saved;
        }
      : saveBuilds);
  const previousBuilds = await Promise.all(
    buildInputs.map(({ id }) =>
      input.read
        ? input.read(input.projectId, id)
        : input.save
          ? Promise.resolve(null)
          : readBuild(input.projectId, id),
    ),
  );
  let stagedBuilds: Awaited<ReturnType<typeof saveBuild>>[] = [];
  const restoreBuilds = async (): Promise<void> => {
    const restorations = stagedBuilds.map((staged, index) => {
      const previous = previousBuilds[index];
      if (previous) {
        const { createdAt: _createdAt, updatedAt: _updatedAt, ...prior } = previous;
        return prior;
      }
      const { createdAt: _createdAt, updatedAt: _updatedAt, ...stagedInput } = staged;
      return { ...stagedInput, status: "failed" as const };
    });
    await saveMany(restorations);
  };
  try {
    stagedBuilds = await saveMany(
      buildInputs.map((buildInput) => ({ ...buildInput, status: "uploaded" as const })),
    );
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    await restoreBuilds().catch((rollback) => rollbackErrors.push(rollback));
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Proof build staging failed and rollback was incomplete",
      );
    }
    throw error;
  }
  const policyChanged = currentPolicyDigest !== preview.policy.digest;
  try {
    if (policyChanged) {
      await atomicReplacePolicy({ root, document: preview.policy.document, files });
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    await restorePolicy({ root, previous: previousPolicy, files }).catch((rollback) =>
      rollbackErrors.push(rollback),
    );
    await restoreBuilds().catch((rollback) => rollbackErrors.push(rollback));
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Proof policy replacement failed and rollback was incomplete",
      );
    }
    throw error;
  }
  let registeredBuilds: Awaited<ReturnType<typeof saveBuild>>[] = [];
  let prepared: Awaited<ReturnType<typeof prepareCurrentChangeVerification>>;
  try {
    registeredBuilds = await saveMany(
      buildInputs.map((buildInput) => ({ ...buildInput, status: "ready" as const })),
    );
    prepared = await (input.prepare ?? prepareCurrentChangeVerification)({
      projectId: input.projectId,
      request: {
        baseRef: preview.baseRef,
        buildIds: registeredBuilds.map(({ id }) => id),
      },
    });
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    if (policyChanged) {
      await restorePolicy({ root, previous: previousPolicy, files }).catch((rollback) =>
        rollbackErrors.push(rollback),
      );
    }
    await restoreBuilds().catch((rollback) => rollbackErrors.push(rollback));
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Proof setup failed and rollback was incomplete",
      );
    }
    throw error;
  }
  return {
    preview,
    registeredBuild: {
      id: registeredBuilds[0]!.id,
      sourceSha: registeredBuilds[0]!.sourceSha!,
      sourceSha256: registeredBuilds[0]!.sourceSha256!,
      status: "ready" as const,
    },
    registeredBuilds: registeredBuilds.map((build) => ({
      id: build.id,
      sourceSha: build.sourceSha!,
      sourceSha256: build.sourceSha256!,
      status: "ready" as const,
    })),
    plan: prepared.plan,
    blockers: prepared.blockers,
  };
}
