import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { bindRequestedBrowserIdentity } from "./browser-execution-identity.js";

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

test("the committed whoami fixture is the last-consumer app for Admin, Member, and Signed out", async () => {
  const html = await readFile(fixture, "utf8");
  assert.match(html, /id="whoami"/);
  assert.match(html, /id="admin-only"/);
  assert.match(html, /relay-role/);
  assert.match(html, /hidden = role !== "admin"/);
  await access(fixture);
});
