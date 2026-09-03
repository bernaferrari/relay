import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalSha256 } from "@relay/core";
import type { ProofSetupIntent } from "@relay/protocol";
import { applyProofSetup, previewProofSetup } from "./proof-guided-setup.js";

const testedSha = "2".repeat(40);
const digest = `sha256:${"a".repeat(64)}` as const;

const lookupWebDeployment = async (expected: {
  deploymentId: string;
  sourceUrl: string;
  sourceSha: string;
  deploymentDigest: `sha256:${string}`;
  configuration: string;
  environmentRevision: string;
}) => ({
  provider: "fixture-host",
  ...expected,
});

function exactChange() {
  return {
    readyForProof: true,
    repository: "acme/mobile",
    changeRef: {
      baseTipSha: "1".repeat(40),
      mergeBaseSha: "1".repeat(40),
      requestedHeadSha: testedSha,
      testedSha,
      testedKind: "head" as const,
    },
    changedFiles: ["src/settings.ts"],
    changedFileCount: 1,
    blockers: [],
  } as never;
}

function intent(): ProofSetupIntent {
  return {
    baseRef: "origin/main",
    build: {
      id: "android-release",
      name: "Android release",
      platform: "android",
      command: { executable: "pnpm", args: ["run", "build:android"] },
      artifactPath: "dist/app-release.apk",
      configuration: "android.release",
      environmentRevision: "gradle-lock-v1",
      applicationId: "com.acme.mobile",
    },
    associations: [
      {
        id: "settings-change",
        appMapId: "mobile",
        testId: "settings",
        signals: {
          files: ["src/settings.ts"],
          symbols: [],
          routes: [],
          resources: [],
          localizationKeys: [],
          apiContracts: [],
        },
        confidence: "definite",
        reason: "The reviewed Settings Test exercises the changed module.",
        review: {
          status: "reviewed",
          revision: 1,
          reviewedBy: "human:reviewer",
          reviewedAt: 1,
        },
      },
    ],
    targetCases: [
      {
        id: "pixel-api-35",
        executionTarget: {
          schemaVersion: 1,
          kind: "local-device",
          provider: { key: "relay.local.agent-device", scope: "local" },
          targetId: "emulator-5554",
          platform: "android",
          identity: { kind: "device-serial", value: "emulator-5554" },
        },
        targetProfile: {
          id: "device:emulator-5554",
          targetId: "emulator-5554",
          source: "device",
          platform: "android",
          name: "Pixel API 35",
          capabilities: ["snapshot", "screenshot", "tap", "install", "launch"],
          observedAt: 1,
        },
        dimensions: { locale: "en-US" },
        required: true,
      },
    ],
  };
}

async function reviewedPreview(root: string) {
  return previewProofSetup({
    projectId: "relay",
    root,
    intent: intent(),
    change: async () => exactChange(),
    validateTests: async () => undefined,
    run: async () => {
      await mkdir(join(root, "dist"), { recursive: true });
      await writeFile(join(root, "dist/app-release.apk"), "exact apk bytes");
    },
  });
}

test("preview runs only the explicit command and returns exact reviewable policy without writes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-setup-preview-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls: Array<{ executable: string; args: readonly string[] }> = [];
  const preview = await previewProofSetup({
    projectId: "relay",
    root,
    intent: intent(),
    change: async () => exactChange(),
    validateTests: async () => undefined,
    run: async (executable, args) => {
      calls.push({ executable, args });
      await mkdir(join(root, "dist"), { recursive: true });
      await writeFile(join(root, "dist/app-release.apk"), "exact apk bytes");
    },
  });

  assert.deepEqual(calls, [{ executable: "pnpm", args: ["run", "build:android"] }]);
  assert.equal(preview.baseRef, "origin/main");
  const { previewDigest, ...unsignedPreview } = preview;
  assert.equal(previewDigest, canonicalSha256(unsignedPreview));
  assert.equal(preview.testedSha, testedSha);
  assert.equal(preview.policy.document.builds[0]?.artifactDigest, preview.artifact.digest);
  assert.equal(preview.policy.document.builds[0]?.sourceSha, testedSha);
  assert.equal(preview.policy.previousDigest, null);
  await assert.rejects(readFile(join(root, ".relay/change-proof.json")), /ENOENT/u);
});

test("apply revalidates the reviewed preview, registers exact bytes, writes policy, and prepares", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-setup-apply-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const preview = await previewProofSetup({
    projectId: "relay",
    root,
    intent: intent(),
    change: async () => exactChange(),
    validateTests: async () => undefined,
    run: async () => {
      await mkdir(join(root, "dist"), { recursive: true });
      await writeFile(join(root, "dist/app-release.apk"), "exact apk bytes");
    },
  });
  let saved: Record<string, unknown> | undefined;
  const result = await applyProofSetup({
    projectId: "relay",
    root,
    request: { ...preview, confirm: true },
    change: async () => exactChange(),
    validateTests: async () => undefined,
    save: async (build) => {
      saved = build;
      return { ...build, createdAt: 1, updatedAt: 1 };
    },
    prepare: async () => ({ plan: { proof: digest } as never, blockers: [] }),
  });

  assert.equal(saved?.sourceSha, testedSha);
  assert.equal(saved?.sourceSha256, preview.artifact.sourceSha256);
  assert.equal(saved?.status, "ready");
  assert.equal(result.registeredBuild.id, "android-release");
  assert.deepEqual(
    JSON.parse(await readFile(join(root, ".relay/change-proof.json"), "utf8")),
    preview.policy.document,
  );

  const repeated = await applyProofSetup({
    projectId: "relay",
    root,
    request: { ...preview, confirm: true },
    change: async () => exactChange(),
    validateTests: async () => undefined,
    save: async (build) => ({ ...build, createdAt: 1, updatedAt: 2 }),
    prepare: async () => ({ plan: { proof: digest } as never, blockers: [] }),
  });
  assert.equal(repeated.registeredBuild.id, "android-release");
});

test("apply fails closed when a reviewed artifact changes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-setup-drift-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const preview = await previewProofSetup({
    projectId: "relay",
    root,
    intent: intent(),
    change: async () => exactChange(),
    validateTests: async () => undefined,
    run: async () => {
      await mkdir(join(root, "dist"), { recursive: true });
      await writeFile(join(root, "dist/app-release.apk"), "first bytes");
    },
  });
  await writeFile(join(root, "dist/app-release.apk"), "different bytes");
  let saved = false;
  await assert.rejects(
    applyProofSetup({
      projectId: "relay",
      root,
      request: { ...preview, confirm: true },
      change: async () => exactChange(),
      validateTests: async () => undefined,
      save: async (build) => {
        saved = true;
        return { ...build, createdAt: 1, updatedAt: 1 };
      },
      prepare: async () => ({ plan: {} as never, blockers: [] }),
    }),
    /bytes changed after preview/u,
  );
  assert.equal(saved, false);
});

test("web setup hashes local output but binds Proof policy to the reviewed deployment digest", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-setup-web-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const deploymentDigest = `sha256:${"b".repeat(64)}` as const;
  const webIntent: ProofSetupIntent = {
    ...intent(),
    build: {
      id: "web-preview",
      name: "Web preview",
      platform: "web",
      command: { executable: "pnpm", args: ["run", "build:web"] },
      artifactPath: "dist/web",
      configuration: "web.production",
      environmentRevision: "hosting-v1",
      webDeployment: {
        url: "https://preview.example.test",
        deploymentDigest,
      },
    },
  };
  const preview = await previewProofSetup({
    projectId: "relay",
    root,
    intent: webIntent,
    change: async () => exactChange(),
    validateTests: async () => undefined,
    lookupWebDeployment,
    run: async () => {
      await mkdir(join(root, "dist/web"), { recursive: true });
      await writeFile(join(root, "dist/web/index.html"), "<h1>Exact web output</h1>");
    },
  });

  assert.equal(preview.build.platform, "web");
  assert.equal(preview.policy.document.builds[0]?.artifactDigest, deploymentDigest);
  assert.notEqual(preview.artifact.digest, deploymentDigest);

  let saved: Record<string, unknown> | undefined;
  await applyProofSetup({
    projectId: "relay",
    root,
    request: { ...preview, confirm: true },
    change: async () => exactChange(),
    validateTests: async () => undefined,
    lookupWebDeployment,
    save: async (build) => {
      saved = build;
      return { ...build, createdAt: 1, updatedAt: 1 };
    },
    prepare: async () => ({ plan: { proof: digest } as never, blockers: [] }),
  });
  assert.equal(saved?.sourceUrl, "https://preview.example.test");
  assert.equal(saved?.deploymentDigest, deploymentDigest);
});

test("setup previews, atomically registers, and prepares reviewed Android and web builds together", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-setup-multi-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const deploymentDigest = `sha256:${"b".repeat(64)}` as const;
  const android = intent().build!;
  const web = {
    id: "web-preview",
    name: "Web preview",
    platform: "web" as const,
    command: { executable: "pnpm", args: ["run", "build:web"] },
    artifactPath: "dist/web",
    configuration: "web.production",
    environmentRevision: "hosting-v1",
    webDeployment: { url: "https://preview.example.test", deploymentDigest },
  };
  const setupIntent: ProofSetupIntent = {
    ...intent(),
    build: undefined,
    builds: [android, web],
  };
  const commands: string[] = [];
  const preview = await previewProofSetup({
    projectId: "relay",
    root,
    intent: setupIntent,
    change: async () => exactChange(),
    validateTests: async () => undefined,
    lookupWebDeployment,
    run: async (_executable, args) => {
      commands.push(args.join(" "));
      if (args.includes("build:android")) {
        await mkdir(join(root, "dist"), { recursive: true });
        await writeFile(join(root, "dist/app-release.apk"), "exact apk bytes");
      } else {
        await mkdir(join(root, "dist/web"), { recursive: true });
        await writeFile(join(root, "dist/web/index.html"), "<h1>Exact web output</h1>");
      }
    },
  });

  assert.deepEqual(commands, ["run build:android", "run build:web"]);
  assert.deepEqual(
    preview.builds!.map(({ id }) => id),
    ["android-release", "web-preview"],
  );
  assert.equal(preview.artifacts!.length, 2);
  assert.equal(preview.policy.document.buildDefinitions.length, 2);
  assert.equal(preview.policy.document.builds[1]?.artifactDigest, deploymentDigest);

  const batches: string[][] = [];
  let preparedIds: readonly string[] | undefined;
  let preparedBaseRef: string | undefined;
  const result = await applyProofSetup({
    projectId: "relay",
    root,
    request: { ...preview, confirm: true },
    change: async () => exactChange(),
    validateTests: async () => undefined,
    lookupWebDeployment,
    read: async () => null,
    saveMany: async (builds) => {
      batches.push(builds.map(({ id, status }) => `${id}:${status}`));
      return builds.map((build) => ({ ...build, createdAt: 1, updatedAt: 1 }));
    },
    prepare: async ({ request }) => {
      preparedIds = request.buildIds;
      preparedBaseRef = request.baseRef;
      return { plan: { proof: digest } as never, blockers: [] };
    },
  });

  assert.deepEqual(preparedIds, ["android-release", "web-preview"]);
  assert.equal(preparedBaseRef, "origin/main");
  assert.deepEqual(batches, [
    ["android-release:uploaded", "web-preview:uploaded"],
    ["android-release:ready", "web-preview:ready"],
  ]);
  assert.deepEqual(
    result.registeredBuilds.map(({ id }) => id),
    ["android-release", "web-preview"],
  );
});

test("a later multi-build registration failure rolls every build back and leaves no policy", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-setup-multi-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const android = intent().build!;
  const web = {
    id: "web-preview",
    name: "Web preview",
    platform: "web" as const,
    command: { executable: "pnpm", args: ["run", "build:web"] },
    artifactPath: "dist/web",
    configuration: "web.production",
    environmentRevision: "hosting-v1",
    webDeployment: {
      url: "https://preview.example.test",
      deploymentDigest: `sha256:${"b".repeat(64)}` as const,
    },
  };
  const preview = await previewProofSetup({
    projectId: "relay",
    root,
    intent: { ...intent(), build: undefined, builds: [android, web] },
    change: async () => exactChange(),
    validateTests: async () => undefined,
    lookupWebDeployment,
    run: async (_executable, args) => {
      if (args.includes("build:android")) {
        await mkdir(join(root, "dist"), { recursive: true });
        await writeFile(join(root, "dist/app-release.apk"), "exact apk bytes");
      } else {
        await mkdir(join(root, "dist/web"), { recursive: true });
        await writeFile(join(root, "dist/web/index.html"), "exact web bytes");
      }
    },
  });
  const finalStatus = new Map<string, string>();
  await assert.rejects(
    applyProofSetup({
      projectId: "relay",
      root,
      request: { ...preview, confirm: true },
      change: async () => exactChange(),
      validateTests: async () => undefined,
      lookupWebDeployment,
      read: async () => null,
      saveMany: async (builds) => {
        if (builds.some(({ id, status }) => id === "web-preview" && status === "ready")) {
          throw new Error("injected second ready failure");
        }
        for (const build of builds) finalStatus.set(build.id, build.status);
        return builds.map((build) => ({ ...build, createdAt: 1, updatedAt: 1 }));
      },
      prepare: async () => ({ plan: {} as never, blockers: [] }),
    }),
    /injected second ready failure/u,
  );

  assert.deepEqual(Object.fromEntries(finalStatus), {
    "android-release": "failed",
    "web-preview": "failed",
  });
  await assert.rejects(readFile(join(root, ".relay/change-proof.json")), /ENOENT/u);
});

test("apply accepts a signed legacy singular preview after the multi-build upgrade", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-setup-legacy-preview-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const current = await reviewedPreview(root);
  const {
    commands: _commands,
    artifacts: _artifacts,
    builds: _builds,
    previewDigest: _digest,
    ...old
  } = current;
  const legacy = { ...old, previewDigest: canonicalSha256(old) };
  const result = await applyProofSetup({
    projectId: "relay",
    root,
    request: { ...legacy, confirm: true },
    change: async () => exactChange(),
    validateTests: async () => undefined,
    save: async (build) => ({ ...build, createdAt: 1, updatedAt: 1 }),
    prepare: async () => ({ plan: { proof: digest } as never, blockers: [] }),
  });

  assert.equal(result.registeredBuild.id, "android-release");
  assert.deepEqual(
    result.registeredBuilds!.map(({ id }) => id),
    ["android-release"],
  );
});

for (const failure of ["write", "rename"] as const) {
  test(`policy ${failure} failure cannot leave a ready Build`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), `relay-proof-setup-${failure}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    const preview = await reviewedPreview(root);
    const states: string[] = [];
    await assert.rejects(
      applyProofSetup({
        projectId: "relay",
        root,
        request: { ...preview, confirm: true },
        change: async () => exactChange(),
        validateTests: async () => undefined,
        save: async (build) => {
          states.push(build.status);
          return { ...build, createdAt: 1, updatedAt: states.length };
        },
        prepare: async () => ({ plan: {} as never, blockers: [] }),
        files:
          failure === "write"
            ? { writeFile: async () => Promise.reject(new Error("injected policy write failure")) }
            : { rename: async () => Promise.reject(new Error("injected policy rename failure")) },
      }),
      new RegExp(`injected policy ${failure} failure`, "u"),
    );
    assert.deepEqual(states, ["uploaded", "failed"]);
    assert.equal(states.includes("ready"), false);
    await assert.rejects(readFile(join(root, ".relay/change-proof.json")), /ENOENT/u);
  });
}

test("ready registration failure rolls policy back and leaves the staged Build failed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-setup-register-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const preview = await reviewedPreview(root);
  const states: string[] = [];
  await assert.rejects(
    applyProofSetup({
      projectId: "relay",
      root,
      request: { ...preview, confirm: true },
      change: async () => exactChange(),
      validateTests: async () => undefined,
      save: async (build) => {
        if (build.status === "ready") throw new Error("injected ready registration failure");
        states.push(build.status);
        return { ...build, createdAt: 1, updatedAt: states.length };
      },
      prepare: async () => ({ plan: {} as never, blockers: [] }),
    }),
    /injected ready registration failure/u,
  );
  assert.deepEqual(states, ["uploaded", "failed"]);
  await assert.rejects(readFile(join(root, ".relay/change-proof.json")), /ENOENT/u);
});

test("staging registration failure occurs before policy replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-setup-stage-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const preview = await reviewedPreview(root);
  await assert.rejects(
    applyProofSetup({
      projectId: "relay",
      root,
      request: { ...preview, confirm: true },
      change: async () => exactChange(),
      validateTests: async () => undefined,
      save: async () => Promise.reject(new Error("injected staging registration failure")),
      prepare: async () => ({ plan: {} as never, blockers: [] }),
    }),
    /injected staging registration failure/u,
  );
  await assert.rejects(readFile(join(root, ".relay/change-proof.json")), /ENOENT/u);
});

test("prepare failure restores the prior policy and prior ready Build", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-setup-prepare-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".relay"));
  const priorPolicy = '{"prior":true}\n';
  await writeFile(join(root, ".relay/change-proof.json"), priorPolicy);
  const preview = await reviewedPreview(root);
  const priorBuild = {
    id: "android-release",
    projectId: "relay",
    name: "Prior Android release",
    platform: "android",
    sourceUrl: "dist/prior.apk",
    sourceSha256: "0".repeat(64),
    sourceSha: "3".repeat(40),
    configuration: "android.prior",
    environmentRevision: "gradle-lock-prior",
    status: "ready",
    createdAt: 1,
    updatedAt: 1,
  } as const;
  const saved: Array<Record<string, unknown>> = [];
  await assert.rejects(
    applyProofSetup({
      projectId: "relay",
      root,
      request: { ...preview, confirm: true },
      change: async () => exactChange(),
      validateTests: async () => undefined,
      read: async () => priorBuild as never,
      save: async (build) => {
        saved.push(build);
        return { ...build, createdAt: 1, updatedAt: saved.length };
      },
      prepare: async () => Promise.reject(new Error("injected prepare failure")),
    }),
    /injected prepare failure/u,
  );
  assert.deepEqual(
    saved.map(({ status, sourceSha }) => ({ status, sourceSha })),
    [
      { status: "uploaded", sourceSha: testedSha },
      { status: "ready", sourceSha: testedSha },
      { status: "ready", sourceSha: priorBuild.sourceSha },
    ],
  );
  assert.equal(await readFile(join(root, ".relay/change-proof.json"), "utf8"), priorPolicy);
});

test("a symlinked .relay directory is rejected before any Build or policy write", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-setup-symlink-directory-"));
  const outside = await mkdtemp(join(tmpdir(), "relay-proof-setup-outside-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  const preview = await reviewedPreview(root);
  await symlink(outside, join(root, ".relay"), "dir");
  let saved = false;
  await assert.rejects(
    applyProofSetup({
      projectId: "relay",
      root,
      request: { ...preview, confirm: true },
      change: async () => exactChange(),
      validateTests: async () => undefined,
      save: async (build) => {
        saved = true;
        return { ...build, createdAt: 1, updatedAt: 1 };
      },
      prepare: async () => ({ plan: {} as never, blockers: [] }),
    }),
    /.relay must be a real repository directory/u,
  );
  assert.equal(saved, false);
  await assert.rejects(readFile(join(outside, "change-proof.json")), /ENOENT/u);
});

test("a symlinked policy file is rejected before registration or replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-setup-symlink-policy-"));
  const outside = join(root, "outside-policy.json");
  t.after(() => rm(root, { recursive: true, force: true }));
  const preview = await reviewedPreview(root);
  await mkdir(join(root, ".relay"));
  await writeFile(outside, "outside stays unchanged");
  await symlink(outside, join(root, ".relay/change-proof.json"));
  let saved = false;
  await assert.rejects(
    applyProofSetup({
      projectId: "relay",
      root,
      request: { ...preview, confirm: true },
      change: async () => exactChange(),
      validateTests: async () => undefined,
      save: async (build) => {
        saved = true;
        return { ...build, createdAt: 1, updatedAt: 1 };
      },
      prepare: async () => ({ plan: {} as never, blockers: [] }),
    }),
    /change-proof.json must be a regular file/u,
  );
  assert.equal(saved, false);
  assert.equal(await readFile(outside, "utf8"), "outside stays unchanged");
});
