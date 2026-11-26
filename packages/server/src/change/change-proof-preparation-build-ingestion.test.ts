import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  artifactDigestForProof,
  issueWebBuildProviderReceiptFromAuthority,
  canonicalSha256,
  resetControlDatabaseCache,
  saveBuild,
} from "@relay/core";
import type { ProofBuildDefinition, WorkspaceChangeContext } from "@relay/protocol";
import { prepareCurrentChangeVerification } from "./change-proof-preparation.js";

const testedSha = "2".repeat(40);
const deploymentDigest = `sha256:${"d".repeat(64)}` as const;

test("Proof preparation ingests and binds reviewed Android and web Builds for the exact head", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-prepare-ingest-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = join(root, "state");
  const definitions: readonly ProofBuildDefinition[] = [
    {
      id: "android-release",
      name: "Android release",
      platform: "android",
      command: { executable: "pnpm", args: ["build:android"] },
      artifactPath: "dist/app.apk",
      configuration: "android.release",
      environmentRevision: "reviewed-v1",
      applicationId: "com.acme.app",
    },
    {
      id: "web-release",
      name: "Web release",
      platform: "web",
      command: { executable: "pnpm", args: ["build:web"] },
      artifactPath: "dist/web",
      configuration: "web.production",
      environmentRevision: "reviewed-v1",
      webDeployment: {
        url: "https://deployments.example.test/app/exact",
        deploymentDigest,
      },
    },
  ];
  try {
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist/app.apk"), "android apk");
    await mkdir(join(root, ".relay"));
    await writeFile(
      join(root, ".relay", "change-proof.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        repository: "acme/app",
        changed: {},
        associations: [],
        buildDefinitions: definitions,
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
        const definition = definitions.find(({ id }) => id === input.definitionId)!;
        const environmentRevision = "reviewed-v1@toolchain";
        const artifactDigest =
          definition.platform === "web"
            ? deploymentDigest
            : await artifactDigestForProof(join(root, definition.artifactPath));
        const webIdentity =
          definition.platform === "web"
            ? await issueWebBuildProviderReceiptFromAuthority({
                expected: {
                  deploymentId: definition.id,
                  sourceUrl: definition.webDeployment!.url,
                  sourceSha: testedSha,
                  deploymentDigest,
                  configuration: definition.configuration,
                  environmentRevision,
                },
                lookup: async (expected) => ({
                  provider: "fixture-host",
                  deploymentId: expected.deploymentId ?? definition.id,
                  sourceUrl: expected.sourceUrl,
                  sourceSha: expected.sourceSha,
                  deploymentDigest: expected.deploymentDigest ?? deploymentDigest,
                  configuration: expected.configuration,
                  environmentRevision: expected.environmentRevision ?? environmentRevision,
                }),
              })
            : undefined;
        const build = await saveBuild({
          id: definition.id,
          projectId: input.projectId,
          name: definition.name,
          platform: definition.platform,
          sourceUrl: webIdentity?.deployment.sourceUrl ?? join(root, definition.artifactPath),
          sourceSha256: "a".repeat(64),
          sourceSha: testedSha,
          configuration: definition.configuration,
          environmentRevision,
          ...(webIdentity
            ? {
                deploymentDigest: webIdentity.deployment.deploymentDigest,
                webDeploymentMode: "provider-verified" as const,
                webProviderReceipt: webIdentity.receipt,
              }
            : {}),
          ...(definition.applicationId ? { applicationId: definition.applicationId } : {}),
          status: "ready",
        });
        return {
          build,
          verificationBuild: {
            id: definition.id,
            platform: definition.platform,
            artifactDigest,
            sourceSha: testedSha,
            configuration: definition.configuration,
            environmentRevision,
          },
          receipt: {
            schemaVersion: 1,
            buildId: definition.id,
            policy: {
              path: ".relay/change-proof.json",
              digest: canonicalSha256("reviewed policy"),
            },
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

    assert.equal(ingestions, 2);
    assert.deepEqual(
      result.plan.builds.map(({ id, sourceSha }) => ({ id, sourceSha })),
      definitions.map(({ id }) => ({ id, sourceSha: testedSha })),
    );
    assert.equal(result.plan.builds[1]?.artifactDigest, deploymentDigest);
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
