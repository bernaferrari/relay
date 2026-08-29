import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { closeBrowserTarget, getBrowserDevice } from "./browser-target.js";
import {
  BrowserDeviceConflictError,
  captureBrowserDeviceFrame,
  controlBrowserDevice,
  MAX_BROWSER_DEVICE_OPEN_POPUPS,
  MAX_BROWSER_DEVICE_PAGE_TOMBSTONES,
  openBrowserDeviceSession,
  readBrowserDeviceSession,
  resetBrowserDeviceSessionsForTests,
} from "./browser-device-session.js";
import { createBrowserContextFactory } from "./browser-context.js";
import {
  pressIdentifier,
  pressLabel,
  pressRef,
  recordDeviceVideo,
  screenshot,
  typeText,
} from "./device.js";
import { runWithTargetContext } from "./target-context.js";
import { runWithTargetSupervisorStore, TargetSupervisorStore } from "./target-supervisor-store.js";
import {
  browserProfileDir,
  deleteTarget,
  listTargets,
  preflightTarget,
  saveBrowserTarget,
} from "./targets.js";

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
      _request.url === "/ambiguous"
        ? `<!doctype html><button style="position:absolute;left:10px;top:10px">Same</button><button style="position:absolute;left:10px;top:10px">Same</button>`
        : `<!doctype html><button aria-label="Continue">Continue</button><button>Duplicate</button><button>Duplicate</button><input id="message" aria-label="Message" />`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  startUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  resetBrowserDeviceSessionsForTests();
  await closeBrowserTarget();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  delete process.env.RELAY_WORKSPACE_ROOT;
  await rm(root, { recursive: true, force: true });
});

test("in-app Browser Device sequences frames and rejects stale page input", async (t) => {
  await access(CHROME).catch(() => t.skip("Google Chrome is not installed"));
  if (t.signal.aborted) return;
  const supervisor = new TargetSupervisorStore(":memory:");
  try {
    await runWithTargetSupervisorStore(supervisor, async () => {
      const target = await saveBrowserTarget({
        name: "In-app browser",
        startUrl,
        executablePath: CHROME,
        headless: true,
        environment: { viewport: { width: 800, height: 600 } },
      });
      const opened = await openBrowserDeviceSession(target.id);
      assert.equal(opened.status, "starting");
      const first = await captureBrowserDeviceFrame(target.id);
      assert.equal(first.frame.sequence, 1);
      assert.equal(first.frame.sessionId, opened.sessionId);
      const unchanged = await captureBrowserDeviceFrame(target.id);
      assert.equal(unchanged.frame.sequence, 2);
      assert.equal(unchanged.frame.visualFingerprint, first.frame.visualFingerprint);
      await assert.rejects(
        controlBrowserDevice(target.id, {
          sessionId: opened.sessionId,
          pageId: first.frame.pageId,
          expectedSequence: first.frame.sequence,
          kind: "click",
          x: 10,
          y: 10,
        }),
        (error) =>
          error instanceof BrowserDeviceConflictError && error.code === "BROWSER_STALE_INPUT",
      );
      await controlBrowserDevice(target.id, {
        sessionId: opened.sessionId,
        pageId: unchanged.frame.pageId,
        expectedSequence: unchanged.frame.sequence,
        kind: "navigate",
        url: `${startUrl}/next`,
      });
      await assert.rejects(
        controlBrowserDevice(target.id, {
          sessionId: opened.sessionId,
          pageId: first.frame.pageId,
          expectedSequence: first.frame.sequence,
          kind: "click",
          x: 10,
          y: 10,
        }),
        (error) =>
          error instanceof BrowserDeviceConflictError && error.code === "BROWSER_STALE_INPUT",
      );
      const second = await captureBrowserDeviceFrame(target.id);
      assert.equal(second.frame.sequence, 3);
      assert.match(second.frame.pageUrl, /\/next$/u);
      const device = await getBrowserDevice(target.id, { mode: "authoring" });
      await runWithTargetContext(
        { kind: "browser", platform: "browser", targetId: target.id },
        () => pressLabel(device, "Continue"),
      );
      await assert.rejects(
        controlBrowserDevice(target.id, {
          sessionId: opened.sessionId,
          pageId: second.frame.pageId,
          expectedSequence: second.frame.sequence,
          kind: "click",
          x: 10,
          y: 10,
        }),
        (error) =>
          error instanceof BrowserDeviceConflictError && error.code === "BROWSER_STALE_INPUT",
      );
      const afterGeneric = await captureBrowserDeviceFrame(target.id);
      await controlBrowserDevice(target.id, {
        sessionId: opened.sessionId,
        pageId: afterGeneric.frame.pageId,
        expectedSequence: afterGeneric.frame.sequence,
        kind: "text",
        text: "a",
      });
      await assert.rejects(
        controlBrowserDevice(target.id, {
          sessionId: opened.sessionId,
          pageId: afterGeneric.frame.pageId,
          expectedSequence: afterGeneric.frame.sequence,
          kind: "text",
          text: "b",
        }),
        (error) =>
          error instanceof BrowserDeviceConflictError && error.code === "BROWSER_STALE_INPUT",
      );
      const recording = await runWithTargetContext(
        { kind: "browser", platform: "browser", targetId: target.id },
        () =>
          recordDeviceVideo(device, {
            action: "start",
            path: join(root, "browser-device.mp4"),
          }),
      );
      const recordingFrame = await captureBrowserDeviceFrame(target.id);
      assert.equal(recordingFrame.session.status, "streaming");
      if (recording.started) {
        await runWithTargetContext(
          { kind: "browser", platform: "browser", targetId: target.id },
          () => recordDeviceVideo(device, { action: "stop" }),
        );
        assert.equal((await captureBrowserDeviceFrame(target.id)).session.status, "streaming");
      }
      await closeBrowserTarget(target.id, { mode: "authoring" });
      await deleteTarget(target.id);
      assert.ok(
        supervisor
          .health({ id: target.id, kind: "browser" })
          .events.some(({ code }) => code === "INPUT_COMPLETED"),
      );
      resetBrowserDeviceSessionsForTests();
    });
  } finally {
    supervisor.close();
  }
});

test("in-app Browser Device resolves one exact-frame semantic click and requires reviewed fallback", async (t) => {
  await access(CHROME).catch(() => t.skip("Google Chrome is not installed"));
  if (t.signal.aborted) return;
  const supervisor = new TargetSupervisorStore(":memory:");
  const target = await saveBrowserTarget({
    name: "Semantic Browser Device",
    startUrl,
    executablePath: CHROME,
    headless: true,
    environment: { viewport: { width: 800, height: 600 } },
  });
  try {
    await runWithTargetSupervisorStore(supervisor, async () => {
      const opened = await openBrowserDeviceSession(target.id);
      const first = await captureBrowserDeviceFrame(target.id);
      const semantic = await controlBrowserDevice(target.id, {
        sessionId: opened.sessionId,
        pageId: first.frame.pageId,
        expectedSequence: first.frame.sequence,
        kind: "click",
        x: 20,
        y: 20,
      });
      assert.equal(semantic.resolution?.outcome, "semantic");
      assert.equal(semantic.resolution?.strategy, "role-name");
      assert.equal(semantic.resolution?.reviewedCoordinateFallback, false);
      assert.match(semantic.resolution?.reasoning ?? "", /one visible enabled match/u);

      const afterSemantic = await captureBrowserDeviceFrame(target.id);
      await controlBrowserDevice(target.id, {
        sessionId: opened.sessionId,
        pageId: first.frame.pageId,
        expectedSequence: afterSemantic.frame.sequence,
        kind: "navigate",
        url: `${startUrl}/ambiguous`,
      });
      const ambiguousFrame = await captureBrowserDeviceFrame(target.id);
      const beforeRejectedClickEvents = supervisor.health({ id: target.id, kind: "browser" }).events
        .length;
      await assert.rejects(
        controlBrowserDevice(target.id, {
          sessionId: opened.sessionId,
          pageId: ambiguousFrame.frame.pageId,
          expectedSequence: ambiguousFrame.frame.sequence,
          kind: "click",
          x: 20,
          y: 20,
        }),
        (error) =>
          error instanceof BrowserDeviceConflictError &&
          error.code === "BROWSER_SEMANTIC_TARGET_REQUIRED",
      );
      const afterRejectedClickEvents = supervisor.health({ id: target.id, kind: "browser" });
      assert.ok(afterRejectedClickEvents.events.length > beforeRejectedClickEvents);
      assert.ok(
        afterRejectedClickEvents.events.some(({ code }) => code === "INPUT_NOT_DISPATCHED"),
      );
      const fallback = await controlBrowserDevice(target.id, {
        sessionId: opened.sessionId,
        pageId: ambiguousFrame.frame.pageId,
        expectedSequence: ambiguousFrame.frame.sequence,
        kind: "click",
        x: 20,
        y: 20,
        coordinateFallback: "reviewed",
      });
      assert.equal(fallback.resolution?.outcome, "coordinate-fallback");
      assert.equal(fallback.resolution?.reviewedCoordinateFallback, true);
    });
  } finally {
    await closeBrowserTarget(target.id, { mode: "authoring" });
    await deleteTarget(target.id);
    supervisor.close();
  }
});

test("in-app Browser Device bounds popup admission and retained page tombstones", async (t) => {
  await access(CHROME).catch(() => t.skip("Google Chrome is not installed"));
  if (t.signal.aborted) return;
  const supervisor = new TargetSupervisorStore(":memory:");
  try {
    await runWithTargetSupervisorStore(supervisor, async () => {
      const popupServer = http.createServer((_request, response) => {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><title>Popup</title><p>Popup</p>`);
      });
      await new Promise<void>((resolve) => popupServer.listen(0, "127.0.0.1", resolve));
      const popupAddress = popupServer.address();
      assert(popupAddress && typeof popupAddress === "object");
      const popupUrl = `http://127.0.0.1:${popupAddress.port}`;
      const rootServer = http.createServer((_request, response) => {
        response.setHeader("content-type", "text/html");
        response.end(
          `<!doctype html><button id="spawn" onclick="window.open('${popupUrl}/popup-' + Date.now(), '_blank')">Spawn popup</button>`,
        );
      });
      await new Promise<void>((resolve) => rootServer.listen(0, "127.0.0.1", resolve));
      const rootAddress = rootServer.address();
      assert(rootAddress && typeof rootAddress === "object");
      const target = await saveBrowserTarget({
        name: "Bound Browser Device",
        startUrl: `http://127.0.0.1:${rootAddress.port}`,
        executablePath: CHROME,
        headless: true,
        environment: { viewport: { width: 800, height: 600 } },
      });
      try {
        const opened = await openBrowserDeviceSession(target.id);
        let frame = (await captureBrowserDeviceFrame(target.id)).frame;
        const device = await getBrowserDevice(target.id, { mode: "authoring" });
        await runWithTargetContext(
          { kind: "browser", platform: "browser", targetId: target.id },
          async () => {
            for (let index = 0; index < MAX_BROWSER_DEVICE_OPEN_POPUPS + 4; index += 1) {
              await pressIdentifier(device, "spawn");
            }
            for (let attempt = 0; attempt < 40; attempt += 1) {
              const openPopups = (await readBrowserDeviceSession(target.id)).pages.filter(
                (page) => page.kind === "popup" && !page.closed,
              );
              if (openPopups.length >= MAX_BROWSER_DEVICE_OPEN_POPUPS) break;
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            const admitted = await readBrowserDeviceSession(target.id);
            assert.equal(
              admitted.pages.filter((page) => page.kind === "popup" && !page.closed).length,
              MAX_BROWSER_DEVICE_OPEN_POPUPS,
            );
            for (;;) {
              const current = await readBrowserDeviceSession(target.id);
              const popup = current.pages.find((page) => page.kind === "popup" && !page.closed);
              if (!popup) break;
              frame = (await captureBrowserDeviceFrame(target.id)).frame;
              await controlBrowserDevice(target.id, {
                sessionId: opened.sessionId,
                pageId: frame.pageId,
                expectedSequence: frame.sequence,
                kind: "page.close",
                targetPageId: popup.id,
              });
            }
            for (let index = 0; index < MAX_BROWSER_DEVICE_PAGE_TOMBSTONES + 4; index += 1) {
              await pressIdentifier(device, "spawn");
              for (let attempt = 0; attempt < 20; attempt += 1) {
                const current = await readBrowserDeviceSession(target.id);
                if (current.pages.some((page) => page.kind === "popup" && !page.closed)) break;
                await new Promise((resolve) => setTimeout(resolve, 10));
              }
              const current = await readBrowserDeviceSession(target.id);
              const popup = current.pages.find((page) => page.kind === "popup" && !page.closed);
              assert(popup, "the popup should be admitted before it is closed");
              frame = (await captureBrowserDeviceFrame(target.id)).frame;
              await controlBrowserDevice(target.id, {
                sessionId: opened.sessionId,
                pageId: frame.pageId,
                expectedSequence: frame.sequence,
                kind: "page.close",
                targetPageId: popup.id,
              });
              frame = (await captureBrowserDeviceFrame(target.id)).frame;
            }

            const final = await readBrowserDeviceSession(target.id);
            assert.ok(final.pages.length <= MAX_BROWSER_DEVICE_PAGE_TOMBSTONES);
            assert.ok(final.pages.some((page) => page.id === final.activePageId && page.active));
            assert.ok(
              final.pages.filter((page) => page.kind === "popup" && !page.closed).length <=
                MAX_BROWSER_DEVICE_OPEN_POPUPS,
            );
          },
        );
      } finally {
        await closeBrowserTarget(target.id, { mode: "authoring" });
        await deleteTarget(target.id);
        await new Promise<void>((resolve, reject) =>
          rootServer.close((error) => (error ? reject(error) : resolve())),
        );
      }
      await new Promise<void>((resolve, reject) =>
        popupServer.close((error) => (error ? reject(error) : resolve())),
      );
    });
  } finally {
    supervisor.close();
  }
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

test("ephemeral browser deletion purges its profile while retained authoring data survives", async () => {
  const isolatedRoot = await mkdtemp(join(tmpdir(), "relay-target-retention-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = isolatedRoot;
  try {
    const ephemeral = await saveBrowserTarget({
      id: "ephemeral-browser",
      name: "Ephemeral browser",
      startUrl: "https://example.test/",
      profileRetention: "ephemeral",
    });
    const ephemeralRecording = join(browserProfileDir(ephemeral.id), "recordings", "secret.txt");
    await mkdir(join(browserProfileDir(ephemeral.id), "recordings"), { recursive: true });
    await writeFile(ephemeralRecording, "authoring recording sentinel", "utf8");
    await deleteTarget(ephemeral.id);
    await assert.rejects(access(ephemeralRecording));

    const retained = await saveBrowserTarget({
      id: "retained-browser",
      name: "Retained browser",
      startUrl: "https://example.test/",
      profileRetention: "retain",
    });
    const retainedRecording = join(browserProfileDir(retained.id), "recordings", "keep.txt");
    await mkdir(join(browserProfileDir(retained.id), "recordings"), { recursive: true });
    await writeFile(retainedRecording, "explicitly retained authoring sentinel", "utf8");
    await deleteTarget(retained.id);
    assert.equal(await access(retainedRecording), undefined);
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(isolatedRoot, { recursive: true, force: true });
  }
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

test("browser environment viewport takes precedence over the legacy target viewport", async () => {
  const target = await saveBrowserTarget({
    id: "profile-viewport-precedence",
    name: "Profile viewport",
    startUrl,
    headless: true,
    viewport: { width: 1280, height: 800 },
    environment: { viewport: { width: 390, height: 844 } },
  });
  const factory = createBrowserContextFactory(target);
  assert.deepEqual(factory.profile.viewport, { width: 390, height: 844 });
  await deleteTarget(target.id);
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
  const supervisor = new TargetSupervisorStore(":memory:");
  try {
    await runWithTargetSupervisorStore(supervisor, async () => {
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
          assert.equal(input?.identifier, "message");
          assert.equal(input?.ref, undefined);
          await pressIdentifier(device, input.identifier);
          await typeText(device, "Hello Relay");
          await assert.rejects(
            pressRef(device, "@browser-0"),
            /Legacy positional browser refs cannot be replayed safely/u,
          );
          await pressLabel(device, "Continue");
          await assert.rejects(pressLabel(device, "Duplicate"), /ambiguous/u);
          const output = join(root, "shot.png");
          await screenshot(device, output);
          await access(output);
          await recordDeviceVideo(device, { action: "stop" });
          if (recording.started) await access(join(root, "run.webm"));
        },
      );
      assert.ok(
        supervisor
          .health({ id: target.id, kind: "browser" })
          .events.some(({ code }) => code === "INPUT_COMPLETED"),
      );
    });
  } finally {
    supervisor.close();
  }
});
