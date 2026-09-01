import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalSha256, resetControlDatabaseCache, saveBuild } from "@relay/core";
import type { ProofBuildDefinition, WorkspaceChangeContext } from "@relay/protocol";
import { prepareCurrentChangeVerification } from "./change-proof-preparation.js";

const testedSha = "2".repeat(40);
const deploymentDigest = `sha256:${"d".repeat(64)}` as const;

test("Proof preparation ingests reviewed definitions and binds the resulting exact-head Build", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-prepare-ingest-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = join(root, "state");
  const definition: ProofBuildDefinition = {
    id: "web-release",
    name: "Web release",
    platform: "web",
    command: { executable: "pnpm", args: ["build"] },
    artifactPath: "dist",
    configuration: "web.production",
    environmentRevision: "reviewed-v1",
    webDeployment: {
      url: "https://deployments.example.test/app/exact",
      deploymentDigest,
    },
  };
  try {
    await mkdir(join(root, ".relay"));
    await writeFile(
      join(root, ".relay", "change-proof.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        repository: "acme/app",
        changed: {},
        associations: [],
        buildDefinitions: [definition],
        builds: [],
        targetCases: [],
        policy: { id: "relay.verify-change", version: 1 },
      })}\n`,
    );
    const change: WorkspaceChangeContext = {
      status: "resolved",
      workspace: { name: "app" },
      repository: "acme/app",
      branch: "feature",
      head: { sha: testedSha, label: "feature" },
      base: { sha: "1".repeat(40), label: "main" },
      changeRef: {
        baseTipSha: "1".repeat(40),
        mergeBaseSha: "1".repeat(40),
        requestedHeadSha: testedSha,
        testedSha,
        testedKind: "head",
      },
      baseCandidates: [{ ref: "main", sha: "1".repeat(40), label: "main" }],
      changedFileCount: 1,
      changedFiles: ["src/app.ts"],
      localChangeCount: 0,
      localChanges: [],
      readyForProof: true,
      blockers: [],
    };
    let ingestions = 0;
    const result = await prepareCurrentChangeVerification({
      projectId: "default",
      request: {},
      root,
      inspect: async () => change,
      ingestBuild: async (input) => {
        ingestions += 1;
        assert.equal(input.testedSha, testedSha);
        assert.equal(input.definitionId, definition.id);
        const environmentRevision = "reviewed-v1@toolchain";
        const build = await saveBuild({
          id: definition.id,
          projectId: input.projectId,
          name: definition.name,
          platform: "web",
          sourceUrl: definition.webDeployment!.url,
          sourceSha256: "a".repeat(64),
          sourceSha: testedSha,
          configuration: definition.configuration,
          environmentRevision,
          deploymentDigest,
          status: "ready",
        });
        return {
          build,
          verificationBuild: {
            id: definition.id,
            platform: "web",
            artifactDigest: deploymentDigest,
            sourceSha: testedSha,
            configuration: definition.configuration,
            environmentRevision,
          },
          receipt: {
            schemaVersion: 1,
            buildId: definition.id,
            source: { repositoryRoot: root, sha: testedSha, treeSha: "3".repeat(40) },
            command: {
              executable: definition.command.executable,
              args: definition.command.args,
              digest: canonicalSha256(definition.command),
            },
            toolchain: {
              version: "fixture",
              node: process.version,
              platform: process.platform,
              arch: process.arch,
              identityDigest: canonicalSha256({ fixture: true }),
            },
            artifact: {
              reviewedPath: definition.artifactPath,
              storedPath: join(root, "state", "artifact"),
              digest: canonicalSha256("artifact"),
              sourceSha256: "a".repeat(64),
            },
          },
        };
      },
    });

    assert.equal(ingestions, 1);
    assert.equal(result.plan.builds.length, 1);
    assert.equal(result.plan.builds[0]?.id, definition.id);
    assert.equal(result.plan.builds[0]?.sourceSha, testedSha);
    assert.equal(result.plan.builds[0]?.artifactDigest, deploymentDigest);
    assert.equal(
      result.blockers.some((value) => value.includes("not a ready registered build")),
      false,
    );
  } finally {
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
