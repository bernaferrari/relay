import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { closeBrowserTarget, getBrowserDevice } from "./browser-target.js";
import { pressLabel, pressRef, recordDeviceVideo, screenshot, typeText } from "./device.js";
import { runWithTargetContext } from "./target-context.js";
import { deleteTarget, listTargets, preflightTarget, saveBrowserTarget } from "./targets.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let root = "";
let server: http.Server;
let startUrl = "";

before(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-targets-"));
  process.env.RELAY_WORKSPACE_ROOT = root;
  server = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(
      `<!doctype html><button aria-label="Continue">Continue</button><input aria-label="Message" />`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  startUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await closeBrowserTarget();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  delete process.env.RELAY_WORKSPACE_ROOT;
  await rm(root, { recursive: true, force: true });
});

test("managed browser targets have full CRUD and reject unsafe URLs", async () => {
  await assert.rejects(
    saveBrowserTarget({ name: "Unsafe", startUrl: "file:///tmp/private" }),
    /http or https/,
  );
  const target = await saveBrowserTarget({
    name: "Chat product",
    startUrl,
    executablePath: CHROME,
    headless: true,
  });
  assert.equal((await listTargets())[0]?.name, "Chat product");
  await saveBrowserTarget({ ...target.browser!, id: target.id, name: "Assistant web" });
  assert.equal((await listTargets())[0]?.name, "Assistant web");
  await deleteTarget(target.id);
  assert.deepEqual(await listTargets(), []);
});

test("managed browser targets preserve an explicit, path-safe id", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-id-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const target = await saveBrowserTarget({
      id: "chat-staging",
      name: "Chat staging",
      startUrl: "https://example.test/",
    });
    assert.equal(target.id, "chat-staging");
    assert.equal(target.browser?.headless, false);
    await assert.rejects(
      () =>
        saveBrowserTarget({
          id: "../outside",
          name: "Unsafe id",
          startUrl: "https://example.test/",
        }),
      /target id/,
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("listTargets skips invalid entries but keeps valid ones", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-targets-mixed-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    await mkdir(join(root, ".relay"), { recursive: true });
    await writeFile(
      join(root, ".relay", "targets.json"),
      JSON.stringify([
        { id: "", name: "Missing id", kind: "browser", createdAt: 1, updatedAt: 1 },
        { id: "good", name: "Good target", kind: "browser", createdAt: 2, updatedAt: 2 },
        { id: "bad-kind", name: "Bad kind", kind: "printer", createdAt: 3, updatedAt: 3 },
        { id: "no-timestamps", name: "No timestamps", kind: "ios" },
      ]),
      "utf8",
    );
    const targets = await listTargets();
    assert.deepEqual(
      targets.map((target) => target.id),
      ["good"],
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("managed browser adapter supports canonical snapshots, clicks, video, and screenshots", async (t) => {
  await access(CHROME).catch(() => t.skip("Google Chrome is not installed"));
  if (t.signal.aborted) return;
  const target = await saveBrowserTarget({
    name: "Browser integration",
    startUrl,
    executablePath: CHROME,
    headless: true,
  });
  const preflight = await preflightTarget(target);
  assert.equal(preflight.ok, true);
  await runWithTargetContext(
    { kind: "browser", platform: "browser", targetId: target.id },
    async () => {
      const device = await getBrowserDevice(target.id);
      const videoPath = join(root, "run.mp4");
      const recording = await recordDeviceVideo(device, { action: "start", path: videoPath });
      assert(recording.started || recording.warning);
      const snapshot = await device.capture.snapshot({ platform: "android" });
      assert(snapshot.nodes?.some((node) => node.label === "Continue"));
      const input = snapshot.nodes?.find((node) => node.label === "Message");
      assert(input?.ref);
      await pressRef(device, input.ref);
      await typeText(device, "Hello Relay");
      await pressLabel(device, "Continue");
      const output = join(root, "shot.png");
      await screenshot(device, output);
      await access(output);
      await recordDeviceVideo(device, { action: "stop" });
      if (recording.started) await access(join(root, "run.webm"));
    },
  );
});
