import assert from "node:assert/strict";
import test from "node:test";
import {
  browserAuthenticationFixtureOperationInputSchemas,
  browserAuthenticationFixtureReferenceSchema,
  browserAuthenticationFixtureSchema,
} from "./browser-authentication-fixture.js";

const fixtureId = "8bb4854a-182c-4df2-825f-bbc3c2a2dfac";
const reference = `authfx:${fixtureId}:2`;

test("browser authentication fixture metadata contains no secret state", () => {
  const fixture = browserAuthenticationFixtureSchema.parse({
    schemaVersion: 1,
    id: fixtureId,
    reference,
    revision: 2,
    projectId: "project-1",
    targetId: "browser-1",
    name: "Reviewed account",
    origins: ["https://example.test"],
    cookieCount: 2,
    createdAt: 1,
    createdBy: "human:reviewer",
  });

  assert.equal(fixture.reference, reference);
  assert.throws(() =>
    browserAuthenticationFixtureSchema.parse({
      ...fixture,
      storageState: { cookies: [], origins: [] },
    }),
  );
});

test("browser authentication fixture references bind an exact revision", () => {
  assert.equal(browserAuthenticationFixtureReferenceSchema.parse(reference), reference);
  assert.throws(() => browserAuthenticationFixtureReferenceSchema.parse(`authfx:${fixtureId}`));
  assert.throws(() =>
    browserAuthenticationFixtureSchema.parse({
      schemaVersion: 1,
      id: fixtureId,
      reference: `authfx:${fixtureId}:3`,
      revision: 2,
      projectId: "project-1",
      targetId: "browser-1",
      name: "Reviewed account",
      origins: [],
      cookieCount: 0,
      createdAt: 1,
      createdBy: "human:reviewer",
    }),
  );
});

test("browser authentication mutations require explicit confirmation and reject server fields", () => {
  const save = browserAuthenticationFixtureOperationInputSchemas["target.browser-auth.save"];
  const revoke = browserAuthenticationFixtureOperationInputSchemas["target.browser-auth.revoke"];
  const probe = browserAuthenticationFixtureOperationInputSchemas["target.browser-auth.probe"];

  assert.throws(() => save.parse({ targetId: "browser-1", name: "Account" }));
  assert.throws(() =>
    save.parse({
      targetId: "browser-1",
      name: "Account",
      confirm: true,
      createdBy: "agent:forged",
    }),
  );
  assert.throws(() => revoke.parse({ targetId: "browser-1", reference }));
  assert.deepEqual(revoke.parse({ targetId: "browser-1", reference, confirm: true }), {
    targetId: "browser-1",
    reference,
    confirm: true,
  });
  assert.deepEqual(probe.parse({ targetId: "browser-1", reference }), {
    targetId: "browser-1",
    reference,
  });
});

test("fixture health is metadata-only and optional", () => {
  const fixture = browserAuthenticationFixtureSchema.parse({
    schemaVersion: 1,
    id: fixtureId,
    reference,
    revision: 2,
    projectId: "project-1",
    targetId: "browser-1",
    name: "Reviewed account",
    origins: ["https://example.test"],
    cookieCount: 2,
    createdAt: 1,
    createdBy: "human:reviewer",
    health: {
      status: "needs-relogin",
      checkedAt: 20,
      signedIn: false,
      detail: "Signed out",
    },
  });
  assert.equal(fixture.health?.status, "needs-relogin");
  assert.throws(() =>
    browserAuthenticationFixtureSchema.parse({
      ...fixture,
      health: { status: "ready", checkedAt: 20, cookie: "secret" },
    }),
  );
});
