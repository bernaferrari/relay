import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { saveBrowserAuthenticationFixture } from "./browser-authentication-fixtures.js";
import { openBrowserDeviceSession } from "./browser-device-session.js";
import { closeBrowserHostPool } from "./browser-host-pool.js";
import {
  closeBrowserTarget,
  openBrowserLiveRuntime,
  openBrowserTarget,
  sessionFor,
} from "./browser-target.js";
import { deleteTarget, saveBrowserTarget } from "./targets.js";

const CHROME =
  process.env.RELAY_TEST_CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const fixtureHtml = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/whoami-identity/index.html",
);
const projectId = "whoami-live-project";
const targetId = "whoami-live-browser";

let root = "";
let server: http.Server;
let startUrl = "";
let html = "";

before(async () => {
  html = await readFile(fixtureHtml, "utf8");
  root = await mkdtemp(join(tmpdir(), "relay-whoami-live-"));
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_BROWSER_EXECUTABLE = CHROME;
  server = http.createServer((request, response) => {
    if (request.url === "/whoami") {
      const cookie = request.headers.cookie ?? "";
      const role = /(?:^|;\s*)relay-role=([^;]+)/u.exec(cookie)?.[1] ?? "signed-out";
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ role }));
      return;
    }
    response.setHeader("content-type", "text/html");
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  startUrl = `http://127.0.0.1:${address.port}/`;
});

after(async () => {
  await closeBrowserTarget(targetId).catch(() => undefined);
  await closeBrowserHostPool();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  delete process.env.RELAY_WORKSPACE_ROOT;
  delete process.env.RELAY_BROWSER_EXECUTABLE;
  await rm(root, { recursive: true, force: true });
});

async function saveRoleFixture(role: "admin" | "member") {
  return saveBrowserAuthenticationFixture({
    projectId,
    targetId,
    name: `${role} whoami`,
    createdBy: "human:whoami-live",
    storageState: {
      cookies: [{ name: "relay-role", value: role, url: startUrl }],
      origins: [],
    },
  });
}

test(
  "target.open and the live runtime share Admin, Member, and signed-out whoami",
  { timeout: 180_000 },
  async (t) => {
    try {
      await access(CHROME);
    } catch (error) {
      if (process.env.GOLDEN_ACCEPTANCE_MODE === "required" || process.env.RELAY_TEST_CHROME_PATH)
        throw error;
      t.skip(`Google Chrome is not installed: ${error instanceof Error ? error.message : error}`);
      return;
    }

    await saveBrowserTarget({
      id: targetId,
      name: "Whoami live",
      startUrl,
      headless: true,
      profileRetention: "ephemeral",
      environment: {
        engine: "chromium",
        viewport: { width: 900, height: 600 },
        locale: "en-US",
        timezoneId: "UTC",
      },
    });

    const seen = new Map<string, { sessionId: string; role: string; adminOnly: boolean }>();
    try {
      for (const role of ["admin", "member", "signed-out"] as const) {
        const fixture = role === "signed-out" ? undefined : await saveRoleFixture(role);
        const opened = await openBrowserTarget(targetId, {
          projectId,
          presentation: "embedded",
          ...(fixture ? { authenticationFixtureId: fixture.reference } : { signedOut: true }),
        });
        const live = await openBrowserLiveRuntime(targetId, {
          headless: true,
          projectId,
          ...(fixture ? { authenticationFixtureId: fixture.reference } : { signedOut: true }),
        });
        const canvas = await openBrowserDeviceSession(targetId, undefined, { projectId });
        assert.equal(
          live.sessionId,
          opened.sessionId,
          `${role}: embedded live runtime must attach to the target.open session`,
        );
        assert.equal(
          canvas.sessionId,
          opened.sessionId,
          `${role}: in-app Browser Device must attach to the target.open session, not authoring`,
        );
        const exact = await sessionFor(targetId, {
          projectId,
          attachSessionId: opened.sessionId,
          profile: live.profile,
        });
        assert.equal(exact.sessionId, opened.sessionId);
        await assert.rejects(
          sessionFor(targetId, {
            projectId,
            attachSessionId: "expired-session",
            profile: live.profile,
          }),
          /no longer available/,
        );
        await assert.rejects(
          sessionFor(targetId, {
            projectId: "other-project",
            attachSessionId: opened.sessionId,
            profile: live.profile,
          }),
          /different project/,
        );
        await assert.rejects(
          sessionFor(targetId, {
            projectId,
            attachSessionId: opened.sessionId,
            profile: {
              ...live.profile,
              authenticationFixtureId: "authfx:wrong-account:1",
            },
          }),
          /account changed/,
        );
        const page = await live.activePage();
        const cdp = await page.context().newCDPSession(page);
        const command = await cdp.send("Browser.getVersion");
        assert(command.userAgent.includes("HeadlessChrome"));
        await cdp.detach();
        const visible = (await page.locator("#whoami").innerText()).trim();
        const adminOnlyHidden = await page.locator("#admin-only").isHidden();
        const application = (await page.evaluate(async () => {
          const response = await fetch("/whoami");
          return (await response.json()) as { role: string };
        })) as { role: string };
        assert.equal(visible, role);
        assert.equal(application.role, role);
        assert.equal(adminOnlyHidden, role !== "admin");
        seen.set(role, { sessionId: opened.sessionId, role: visible, adminOnly: !adminOnlyHidden });
        if (role === "member" && fixture) {
          const configured = await openBrowserLiveRuntime(targetId, {
            projectId,
            headless: true,
            authenticationFixtureId: fixture.reference,
            profile: {
              ...live.profile,
              viewport: { width: 390, height: 844 },
              locale: "ar",
              colorScheme: "dark",
            },
          });
          assert.notEqual(configured.sessionId, live.sessionId);
          const configuredPage = await configured.activePage();
          assert.equal(configuredPage.viewportSize()?.width, 390);
          assert.deepEqual(
            await configuredPage.evaluate(() => ({
              language: navigator.language,
              dark: matchMedia("(prefers-color-scheme: dark)").matches,
            })),
            { language: "ar", dark: true },
          );
          const attached = await openBrowserDeviceSession(targetId, undefined, {
            projectId,
            sessionId: configured.sessionId,
          });
          assert.equal(attached.sessionId, configured.sessionId);
          await assert.rejects(
            openBrowserDeviceSession(targetId, undefined, {
              projectId,
              sessionId: "expired-session",
            }),
            /no longer available/,
          );
          assert.equal(
            (
              await openBrowserDeviceSession(targetId, undefined, {
                projectId,
                sessionId: configured.sessionId,
              })
            ).sessionId,
            configured.sessionId,
          );
        }
        if (role === "admin" && fixture) {
          const external = await openBrowserTarget(targetId, {
            projectId,
            authenticationFixtureId: fixture.reference,
            presentation: "external",
          });
          assert.notEqual(external.sessionId, opened.sessionId);
          const externalLive = await openBrowserLiveRuntime(targetId, {
            projectId,
            headless: true,
            authenticationFixtureId: fixture.reference,
          });
          assert.equal(externalLive.sessionId, external.sessionId);
          const externalPage = await externalLive.activePage();
          assert.equal((await externalPage.locator("#whoami").innerText()).trim(), "admin");
          const externalCdp = await externalPage.context().newCDPSession(externalPage);
          const externalCommand = await externalCdp.send("Browser.getVersion");
          assert(!externalCommand.userAgent.includes("HeadlessChrome"));
          await externalCdp.detach();
        }
      }
    } finally {
      await closeBrowserTarget(targetId).catch(() => undefined);
      await deleteTarget(targetId).catch(() => undefined);
    }

    assert.equal(seen.get("admin")?.role, "admin");
    assert.equal(seen.get("member")?.role, "member");
    assert.equal(seen.get("signed-out")?.role, "signed-out");
    assert.equal(seen.get("admin")?.adminOnly, true);
    assert.equal(seen.get("member")?.adminOnly, false);
    assert.notEqual(seen.get("admin")?.sessionId, seen.get("member")?.sessionId);
    assert.notEqual(seen.get("admin")?.sessionId, seen.get("signed-out")?.sessionId);
  },
);
