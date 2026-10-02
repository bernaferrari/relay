import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AuthoringSession } from "@relay/protocol";
import { prepareAuthoringBrowserReplay } from "./authoring-browser-replay.js";
import { saveBrowserAuthenticationFixture } from "./browser-authentication-fixtures.js";
import { closeBrowserHostPool } from "./browser-host-pool.js";
import { browserProofSessionForTarget, closeBrowserTarget, sessionFor } from "./browser-target.js";
import { saveBrowserTarget } from "./targets.js";

test(
  "replay resets changed cookies and URL, while preserving the authoring page and saved account",
  { timeout: 60_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-recording-reset-"));
    const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
    process.env.RELAY_WORKSPACE_ROOT = root;
    const server = http.createServer((request, response) => {
      response.setHeader("content-type", "text/html");
      response.end(`<h1>${request.headers.cookie ?? "Guest"}</h1><p>${request.url}</p>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address === "object");
    const startUrl = `http://127.0.0.1:${address.port}/`;
    const targetId = "recording-reset-browser";
    const recording = {
      projectId: "default",
      target: { kind: "browser", platform: "browser", targetId },
    } as AuthoringSession;
    try {
      await saveBrowserTarget({
        id: targetId,
        name: "Replay reset",
        startUrl,
        headless: true,
        profileRetention: "ephemeral",
        environment: { engine: "chromium" },
      });
      const authoring = await sessionFor(targetId, { recordVideo: false, headless: true });
      await authoring.context.addCookies([{ name: "role", value: "admin", url: startUrl }]);
      await authoring.page.goto(`${startUrl}settings`);
      await prepareAuthoringBrowserReplay(recording);
      const guest = await sessionFor(targetId, { mode: "proof" });
      assert.equal(guest.page.url(), startUrl);
      assert.equal(await guest.page.locator("h1").innerText(), "Guest");
      await guest.context.addCookies([{ name: "role", value: "member", url: startUrl }]);
      await guest.page.goto(`${startUrl}settings`);
      await prepareAuthoringBrowserReplay(recording);
      const repeat = await sessionFor(targetId, { mode: "proof" });
      assert.notEqual(repeat.sessionId, guest.sessionId);
      assert.equal(await repeat.page.locator("h1").innerText(), "Guest");
      assert.equal(authoring.page.url(), `${startUrl}settings`);
      assert.equal(await authoring.page.locator("h1").innerText(), "role=admin");
      const account = await saveBrowserAuthenticationFixture({
        projectId: "default",
        targetId,
        name: "Member",
        createdBy: "human:test",
        storageState: {
          cookies: [{ name: "role", value: "member", url: startUrl }],
          origins: [],
        },
      });
      assert(recording.target.kind === "browser");
      recording.target.authenticationFixtureId = account.reference;
      await prepareAuthoringBrowserReplay(recording);
      const member = await browserProofSessionForTarget(targetId, account.reference);
      assert.equal(await member.page.locator("h1").innerText(), "role=member");
      assert.equal(member.page.url(), startUrl);
    } finally {
      await closeBrowserTarget(targetId);
      await closeBrowserHostPool();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
      else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
      await rm(root, { recursive: true, force: true });
    }
  },
);
