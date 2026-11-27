import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Build } from "@relay/protocol";
import {
  artifactDigestForProof,
  bindRegisteredBuildToProof,
  bindRegisteredWebDeploymentToProof,
  bindVerifiedWebDeploymentToProof,
} from "./change-build-binding.js";
import { issueWebBuildProviderReceipt } from "./web-build-verification.js";

const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);

function registeredBuild(path: string, overrides: Partial<Build> = {}): Build {
  return {
    id: "android-release",
    projectId: "project",
    name: "Android release",
    platform: "android",
    sourceUrl: path,
    sourceSha: headSha,
    configuration: "android.release",
    environmentRevision: "production-v12",
    applicationId: "com.example.relay",
    status: "ready",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test("content-addresses files and directory bundles deterministically", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-build-digest-"));
  try {
    const file = join(root, "app.apk");
    await writeFile(file, "exact-apk-bytes");
    const expected = `sha256:${createHash("sha256").update("file\0exact-apk-bytes").digest("hex")}`;
    assert.equal(await artifactDigestForProof(file), expected);

    const first = join(root, "First.app");
    const second = join(root, "Second.app");
    await mkdir(join(first, "nested"), { recursive: true });
    await mkdir(join(second, "nested"), { recursive: true });
    await writeFile(join(first, "z.txt"), "z");
    await writeFile(join(first, "nested", "a.txt"), "a");
    await writeFile(join(second, "nested", "a.txt"), "a");
    await writeFile(join(second, "z.txt"), "z");
    assert.equal(await artifactDigestForProof(first), await artifactDigestForProof(second));

    await symlink(file, join(first, "mutable-link"));
    await assert.rejects(artifactDigestForProof(first), /symbolic link/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("binds a ready mobile artifact to the exact tested revision and observed bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-build-bind-"));
  const artifact = join(root, "app.apk");
  await writeFile(artifact, "apk");
  try {
    const build = registeredBuild(artifact);
    const bound = await bindRegisteredBuildToProof({
      build,
      changeTestedSha: headSha,
      preflight: {
        buildId: build.id,
        ok: true,
        checkedAt: 10,
        artifact: { path: artifact, kind: "apk", bytes: 3 },
        applicationId: "com.example.relay",
        capabilities: { install: true, launch: true },
        checks: [],
      },
    });
    assert.deepEqual(bound, {
      id: "android-release",
      platform: "android",
      artifactDigest: await artifactDigestForProof(artifact),
      sourceSha: headSha,
      configuration: "android.release",
      environmentRevision: "production-v12",
    });

    await assert.rejects(
      bindRegisteredBuildToProof({
        build: registeredBuild(artifact, { sourceSha: baseSha }),
        changeHeadSha: headSha,
        preflight: {
          buildId: build.id,
          ok: true,
          checkedAt: 10,
          artifact: { path: artifact, kind: "apk" },
          capabilities: { install: true, launch: false },
          checks: [],
        },
      }),
      /does not match the exact Proof testedSha/,
    );
    await assert.rejects(
      bindRegisteredBuildToProof({
        build: registeredBuild(artifact, { sourceSha256: "f".repeat(64) }),
        changeHeadSha: headSha,
        preflight: {
          buildId: build.id,
          ok: true,
          checkedAt: 10,
          artifact: { path: artifact, kind: "apk" },
          capabilities: { install: true, launch: false },
          checks: [],
        },
      }),
      /artifact digest does not match/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires complete mobile provenance and exact observed application identity", async () => {
  const build = registeredBuild("/unused/app.apk", { configuration: undefined });
  await assert.rejects(
    bindRegisteredBuildToProof({ build, changeHeadSha: headSha }),
    /requires configuration/,
  );
  const complete = registeredBuild("/unused/app.apk");
  await assert.rejects(
    bindRegisteredBuildToProof({
      build: complete,
      changeHeadSha: headSha,
      preflight: {
        buildId: complete.id,
        ok: true,
        checkedAt: 10,
        artifact: { path: "/unused/app.apk", kind: "apk" },
        applicationId: "com.example.other",
        capabilities: { install: true, launch: true },
        checks: [],
      },
    }),
    /applicationId does not match/,
  );
});

test("binds only provider-verified web deployments for the exact tested revision", () => {
  const deployment = {
    id: "web-production",
    url: "https://preview.example.com/pr-184",
    sourceSha: headSha,
    deploymentDigest: `sha256:${"a".repeat(64)}` as const,
    configuration: "web.production",
    environmentRevision: "production-v12",
  };
  assert.deepEqual(bindVerifiedWebDeploymentToProof({ deployment, changeTestedSha: headSha }), {
    id: "web-production",
    platform: "web",
    artifactDigest: deployment.deploymentDigest,
    sourceSha: headSha,
    configuration: "web.production",
    environmentRevision: "production-v12",
  });
  assert.throws(
    () =>
      bindVerifiedWebDeploymentToProof({
        deployment: { ...deployment, sourceSha: baseSha },
        changeHeadSha: headSha,
      }),
    /does not match the exact Proof testedSha/,
  );
  assert.throws(
    () =>
      bindVerifiedWebDeploymentToProof({
        deployment: { ...deployment, url: "http://preview.example.com/pr-184" },
        changeHeadSha: headSha,
      }),
    /must use https/,
  );
});

test("binds a registered web build only with a signed provider receipt", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "relay-web-provider-authority-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = stateRoot;
  try {
    const receipt = await issueWebBuildProviderReceipt({
      provider: "vercel",
      deploymentId: "web-preview",
      sourceUrl: "https://preview.example.com/pr-184",
      sourceSha: headSha,
      deploymentDigest: `sha256:${"b".repeat(64)}`,
      configuration: "web.production",
      environmentRevision: "preview-v12",
    });
    const build = {
      id: "web-preview",
      projectId: "project",
      name: "Web preview",
      platform: "web" as const,
      sourceUrl: "https://preview.example.com/pr-184",
      sourceSha: headSha,
      deploymentDigest: `sha256:${"b".repeat(64)}`,
      configuration: "web.production",
      environmentRevision: "preview-v12",
      webDeploymentMode: "provider-verified" as const,
      webProviderReceipt: receipt,
      status: "ready" as const,
      createdAt: 1,
      updatedAt: 1,
    };
    assert.deepEqual(bindRegisteredWebDeploymentToProof({ build, changeTestedSha: headSha }), {
      id: build.id,
      platform: "web",
      artifactDigest: build.deploymentDigest,
      sourceSha: headSha,
      configuration: build.configuration,
      environmentRevision: build.environmentRevision,
    });
    assert.throws(
      () => bindRegisteredWebDeploymentToProof({ build, changeTestedSha: baseSha }),
      /does not match the exact Proof testedSha/u,
    );
    assert.throws(
      () =>
        bindRegisteredWebDeploymentToProof({
          build: { ...build, deploymentDigest: undefined },
          changeTestedSha: headSha,
        }),
      /exact signed provider receipt/u,
    );
  } finally {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(stateRoot, { recursive: true, force: true });
  }
});
