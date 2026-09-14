import assert from "node:assert/strict";
import test from "node:test";
import {
  listenSeededMemberApp,
  mintSeededMemberSession,
  SEEDED_MEMBER_ADMIN_SEATS,
  SEEDED_MEMBER_DEFECT_SEATS,
  SEEDED_MEMBER_EXPECTED_SEATS,
  SEEDED_MEMBER_SESSION_COOKIE,
  verifySeededMemberSession,
} from "./seeded-member-app.js";

async function read(url: string, cookie?: string) {
  const response = await fetch(url, {
    headers: cookie ? { cookie } : undefined,
    redirect: "manual",
  });
  const text = await response.text();
  return { response, text };
}

function cookieHeader(token: string): string {
  return `${SEEDED_MEMBER_SESSION_COOKIE}=${token}`;
}

test("Admin and Member sessions are HMAC-issued and forged cookies are rejected", () => {
  const member = mintSeededMemberSession("member", undefined, 100);
  const admin = mintSeededMemberSession("admin", undefined, 100);
  assert.notEqual(member, admin);
  assert.equal(verifySeededMemberSession(member)?.role, "member");
  assert.equal(verifySeededMemberSession(admin)?.role, "admin");
  assert.equal(verifySeededMemberSession("v1.admin.100.deadbeef"), undefined);
  assert.equal(verifySeededMemberSession(member.replace("member", "admin")), undefined);
});

test("the fixture app serves server-issued Admin vs Member HTML, not a client cookie parse", async () => {
  const { server, url, app } = await listenSeededMemberApp({ defect: true });
  try {
    const signedOut = await read(url);
    assert.match(signedOut.text, /id="session-role">signed-out/);
    assert.doesNotMatch(signedOut.text, /Team seats remaining/);
    assert.doesNotMatch(signedOut.text, /document\.cookie/);

    const issued = await fetch(new URL("/session", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "member" }),
      redirect: "manual",
    });
    const setCookie = issued.headers.get("set-cookie") ?? "";
    assert.match(setCookie, new RegExp(`${SEEDED_MEMBER_SESSION_COOKIE}=`, "u"));
    assert.match(setCookie, /HttpOnly/iu);
    const token = /relay_session=([^;]+)/u.exec(setCookie)?.[1];
    assert.ok(token);
    assert.equal(app.verifySession(token)?.role, "member");

    const whoami = await read(new URL("/whoami", url).href, cookieHeader(token!));
    assert.equal(JSON.parse(whoami.text).role, "member");
    const settings = await read(new URL("/settings", url).href, cookieHeader(token!));
    assert.match(settings.text, /id="session-role">member/);
    assert.match(settings.text, new RegExp(`id="team-seats"[^>]*>${SEEDED_MEMBER_DEFECT_SEATS}`));
    assert.doesNotMatch(settings.text, /Manage organization/);
    assert.doesNotMatch(settings.text, /Manage team permissions/);

    app.setDefect(false);
    const repaired = await read(new URL("/settings", url).href, cookieHeader(token!));
    assert.match(repaired.text, new RegExp(`id="team-seats"[^>]*>${SEEDED_MEMBER_EXPECTED_SEATS}`));
    assert.match(repaired.text, /Manage team permissions/);
    assert.doesNotMatch(repaired.text, /Manage organization/);

    const adminIssued = await fetch(new URL("/session", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
      redirect: "manual",
    });
    const adminToken = /relay_session=([^;]+)/u.exec(
      adminIssued.headers.get("set-cookie") ?? "",
    )?.[1];
    assert.ok(adminToken);
    const adminPage = await read(new URL("/settings", url).href, cookieHeader(adminToken));
    assert.match(adminPage.text, /id="session-role">admin/);
    assert.match(adminPage.text, new RegExp(`id="team-seats"[^>]*>${SEEDED_MEMBER_ADMIN_SEATS}`));
    assert.match(adminPage.text, /Manage organization/);
    const adminWhoami = await read(new URL("/whoami", url).href, cookieHeader(adminToken));
    assert.equal(JSON.parse(adminWhoami.text).role, "admin");
    assert.notEqual(JSON.parse(whoami.text).role, JSON.parse(adminWhoami.text).role);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("a display-string cookie named relay-role does not become Member or Admin", async () => {
  const { server, url } = await listenSeededMemberApp({ defect: false });
  try {
    const spoofed = await read(new URL("/whoami", url).href, "relay-role=admin");
    assert.equal(JSON.parse(spoofed.text).role, "signed-out");
    const settings = await read(new URL("/settings", url).href, "relay-role=member");
    assert.match(settings.text, /id="session-role">signed-out/);
    assert.doesNotMatch(settings.text, /Team seats remaining/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
