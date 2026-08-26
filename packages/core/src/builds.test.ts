import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import test from "node:test";
import {
  installRegisteredBuild,
  launchRegisteredBuild,
  preflightRegisteredBuild,
  resolveRegisteredBuildArtifact,
} from "./builds.js";

test("preflights, installs, and launches a registered Android artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-build-"));
  const artifact = join(root, "app.apk");
  await writeFile(artifact, "apk");
  const calls: Array<[string, string[]]> = [];
  const run = async (command: string, args: string[]) => {
    calls.push([command, args]);
    if (command === "apkanalyzer") return { stdout: "com.example.app\n" };
    return { stdout: "" };
  };
  const build = {
    id: "android",
    projectId: "project",
    name: "Android",
    platform: "android" as const,
    sourceUrl: artifact,
    status: "ready" as const,
    createdAt: 1,
    updatedAt: 1,
  };
  const target = { kind: "device" as const, platform: "android" as const, serial: "pixel" };
  try {
    const preflight = await preflightRegisteredBuild(build, { target, run, at: 10 });
    assert.equal(preflight.ok, true);
    assert.equal(preflight.applicationId, "com.example.app");
    assert.deepEqual(preflight.capabilities, { install: true, launch: true });

    await installRegisteredBuild({ build, target, run });
    await launchRegisteredBuild({ build, target, run });
    assert.ok(calls.some(([command, args]) => command === "adb" && args.includes("install")));
    assert.ok(calls.some(([command, args]) => command === "adb" && args.includes("monkey")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("supports iOS simulator app bundles and rejects platform mismatches", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-build-ios-"));
  const artifact = join(root, "Relay.app");
  await mkdir(artifact);
  await writeFile(join(artifact, "Info.plist"), "plist");
  const build = {
    id: "ios",
    projectId: "project",
    name: "iOS",
    platform: "ios" as const,
    sourceUrl: artifact,
    status: "ready" as const,
    createdAt: 1,
    updatedAt: 1,
  };
  try {
    const mismatch = await preflightRegisteredBuild(build, {
      target: { kind: "device", platform: "android", serial: "pixel" },
      run: async () => ({ stdout: "com.example.ios" }),
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.capabilities.install, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function listeningBaseUrl(server: Server): string {
  const address = server.address();
  assert.ok(address && typeof address === "object", "server bound a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

async function startArtifactServer(body: Buffer): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.end(body);
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return { server, url: `${listeningBaseUrl(server)}/app.apk` };
}

test("rejects non-https remote sources before any download", async () => {
  const build = (sourceUrl: string) => ({
    id: "android",
    projectId: "project",
    name: "Android",
    platform: "android" as const,
    sourceUrl,
    status: "ready" as const,
    createdAt: 1,
    updatedAt: 1,
  });
  const plainHttp = await preflightRegisteredBuild(build("http://example.com/app.apk"));
  assert.equal(plainHttp.ok, false);
  assert.deepEqual(plainHttp.capabilities, { install: false, launch: false });
  assert.match(plainHttp.checks[0]?.message ?? "", /absolute https/);

  await assert.rejects(resolveRegisteredBuildArtifact("file:///tmp/app.apk"), /absolute http\(s\)/);
});

test("downloads a remote source into the state builds cache and preflights it", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-build-remote-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = join(root, "state");
  const artifactBytes = Buffer.from("apk-bytes-from-remote");
  const { server, url } = await startArtifactServer(artifactBytes);
  try {
    const cachedPath = await resolveRegisteredBuildArtifact(url);
    assert.match(cachedPath, /builds[\\/].+\.apk$/u);
    assert.equal(await readFile(cachedPath, "utf8"), artifactBytes.toString("utf8"));
    const cachedStat = await stat(cachedPath);
    assert.equal(cachedStat.isFile(), true);

    // A second registration of the same URL reuses the cached bytes.
    const again = await resolveRegisteredBuildArtifact(url);
    assert.equal(again, cachedPath);

    const build = {
      id: "android",
      projectId: "project",
      name: "Android",
      platform: "android" as const,
      sourceUrl: url,
      status: "ready" as const,
      createdAt: 1,
      updatedAt: 1,
    };
    const preflight = await preflightRegisteredBuild(build, {
      target: { kind: "device", platform: "android", serial: "pixel" },
      run: async () => ({ stdout: "com.example.app\n" }),
    });
    assert.equal(preflight.ok, true);
    assert.equal(preflight.artifact?.path, cachedPath);
  } finally {
    server.close();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed when the downloaded bytes do not match the expected sha256", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-build-sha-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = join(root, "state");
  const artifactBytes = Buffer.from("apk-bytes-from-remote");
  const { server, url } = await startArtifactServer(artifactBytes);
  const wrongSha = createHash("sha256").update("different bytes").digest("hex");
  try {
    await assert.rejects(
      resolveRegisteredBuildArtifact(url, { sourceSha256: wrongSha }),
      (error: unknown) => error instanceof Error && /sha256 mismatch/.test(error.message),
    );
    // Fail-closed: no verified artifact is ever left in the cache.
    const cacheDirectory = join(process.env.RELAY_STATE_DIR!, "builds");
    const entries = await readdir(cacheDirectory);
    assert.deepEqual(
      entries.filter((entry) => !entry.endsWith(".partial")),
      [],
    );
  } finally {
    server.close();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
