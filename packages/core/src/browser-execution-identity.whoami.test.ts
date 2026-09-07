import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";
import { bindRequestedBrowserIdentity } from "./browser-execution-identity.js";

const CHROME =
  process.env.RELAY_TEST_CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/whoami-identity/index.html",
);

test("Admin, Member, and Signed out are three distinct requested identities", () => {
  const admin = bindRequestedBrowserIdentity({
    platform: "browser",
    requested: {
      engine: "chromium",
      account: {
        kind: "fixture",
        accountId: "acct-admin",
        accountRevision: "4",
        reference: "authfx:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:4",
      },
    },
    saved: {
      engine: "chromium",
      authenticationFixtureId: "authfx:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:4",
    },
  });
  const member = bindRequestedBrowserIdentity({
    platform: "browser",
    requested: {
      engine: "chromium",
      account: {
        kind: "fixture",
        accountId: "acct-member",
        accountRevision: "7",
        reference: "authfx:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:7",
      },
    },
    saved: {
      engine: "chromium",
      authenticationFixtureId: "authfx:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:7",
    },
  });
  const signedOut = bindRequestedBrowserIdentity({
    platform: "browser",
    requested: { account: { kind: "signed-out", attested: true } },
    saved: { engine: "chromium" },
  });
  assert.equal(admin.status, "bound");
  assert.equal(member.status, "bound");
  assert.equal(signedOut.status, "bound");
  assert.equal(
    bindRequestedBrowserIdentity({
      platform: "browser",
      requested: {
        engine: "chromium",
        account: {
          kind: "fixture",
          accountId: "acct-member",
          accountRevision: "7",
          reference: "authfx:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:7",
        },
      },
      saved: {
        engine: "chromium",
        authenticationFixtureId: "authfx:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:4",
      },
    }).status,
    "blocked",
  );
});

test("the whoami fixture reports the cookie role and hides Admin-only UI when signed out", async (t) => {
  try {
    await access(CHROME);
  } catch {
    t.skip("Google Chrome is not installed");
    return;
  }
  const html = await readFile(fixture, "utf8");
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    for (const role of ["admin", "member", "signed-out"] as const) {
      const context = await browser.newContext();
      if (role !== "signed-out") {
        await context.addCookies([{ name: "relay-role", value: role, url }]);
      }
      const page = await context.newPage();
      await page.goto(url);
      assert.equal(await page.locator("#whoami").innerText(), role);
      assert.equal(await page.locator("#admin-only").isHidden(), role !== "admin");
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
