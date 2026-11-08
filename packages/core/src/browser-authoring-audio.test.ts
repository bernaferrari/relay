import { createServer } from "node:http";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileBrowserEnvironment } from "@relay/protocol";
import { importManagedFixture } from "./managed-fixtures.js";
import { resolveBrowserExecutable } from "./browser-executable.js";
import { saveBrowserTarget } from "./targets.js";
import { openBrowserDeviceSession, closeBrowserDeviceSession } from "./browser-device-session.js";
import { openBrowserTarget, closeBrowserTarget } from "./browser-target.js";

test("authoring entry points preserve the audio fixture project scope", async (t) => {
  const executablePath = resolveBrowserExecutable().path;
  if (!executablePath) return t.skip("No installed browser; set RELAY_BROWSER_EXECUTABLE");
  const root = await mkdtemp(join(tmpdir(), "relay-audio-authoring-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = createServer((_request, response) => response.end("Audio authoring fixture"));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert(address && typeof address === "object");
  let targetId: string | undefined;
  try {
    const wav = join(root, "voice.wav");
    await promisify(execFile)("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.1",
      wav,
    ]);
    const fixture = await importManagedFixture("qa", {
      name: "voice.wav",
      base64: (await readFile(wav)).toString("base64"),
    });
    const profile = compileBrowserEnvironment({
      audioInputFixture: fixture.file,
      permissions: ["microphone"],
    });
    const target = await saveBrowserTarget({
      name: "Audio authoring",
      startUrl: `http://127.0.0.1:${address.port}/`,
      executablePath,
      headless: true,
      environment: profile,
    });
    targetId = target.id;
    const deviceSession = await openBrowserDeviceSession(target.id, profile, { projectId: "qa" });
    assert.equal(deviceSession.profile.audioInputFixture, fixture.file);
    await assert.rejects(
      openBrowserDeviceSession(target.id, profile, { projectId: "other" }),
      /different project/,
    );
    await assert.rejects(
      openBrowserDeviceSession(target.id, profile, {
        projectId: "other",
        sessionId: deviceSession.sessionId,
      }),
      /different project/,
    );
    await assert.rejects(
      openBrowserDeviceSession(target.id, profile, { sessionId: deviceSession.sessionId }),
      /project scope/,
    );
    await closeBrowserDeviceSession(target.id);
    await closeBrowserTarget(target.id);
    const opened = await openBrowserTarget(target.id, {
      projectId: "qa",
      presentation: "embedded",
    });
    assert.equal(opened.targetId, target.id);
  } finally {
    if (targetId) {
      await closeBrowserDeviceSession(targetId);
      await closeBrowserTarget(targetId);
    }
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
