import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  browserAuthenticationStorageState,
  listBrowserAuthenticationFixtures,
  revokeBrowserAuthenticationFixture,
  saveBrowserAuthenticationFixture,
} from "./browser-authentication-fixtures.js";

const secret = "relay-auth-cookie-secret";
const state = {
  cookies: [
    {
      name: "session",
      value: secret,
      domain: "example.test",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    },
  ],
  origins: [
    {
      origin: "https://example.test",
      localStorage: [{ name: "signed-in", value: secret }],
    },
  ],
};

async function fixtureWorkspace(operation: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-browser-auth-fixture-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    await operation(root);
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("browser authentication fixture encrypts exact project-scoped storage state", async () => {
  await fixtureWorkspace(async (root) => {
    const saved = await saveBrowserAuthenticationFixture({
      projectId: "project-a",
      targetId: "browser-a",
      name: "Member session",
      createdBy: "human:reviewer",
      storageState: state,
      now: 100,
      expiresAt: 1_000,
    });
    assert.match(saved.reference, /^authfx:[0-9a-f-]{36}:1$/u);
    assert.equal(saved.cookieCount, 1);
    assert.deepEqual(saved.origins, ["https://example.test"]);
    assert.doesNotMatch(JSON.stringify(saved), new RegExp(secret));

    const fixtureRoot = join(root, ".relay", "browser-auth-fixtures");
    const projectDir = (await readdir(fixtureRoot))[0]!;
    const files = await readdir(join(fixtureRoot, projectDir, saved.id));
    const ciphertext = await readFile(join(fixtureRoot, projectDir, saved.id, files[0]!), "utf8");
    assert.doesNotMatch(ciphertext, new RegExp(secret));
    assert.equal(
      (await stat(join(root, ".relay", ".browser-auth-fixture-key"))).mode & 0o777,
      0o600,
    );
    assert.equal(
      (await stat(join(fixtureRoot, projectDir, saved.id, files[0]!))).mode & 0o777,
      0o600,
    );

    assert.deepEqual(
      await browserAuthenticationStorageState({
        projectId: "project-a",
        targetId: "browser-a",
        reference: saved.reference,
        now: 500,
      }),
      state,
    );
    assert.deepEqual(await listBrowserAuthenticationFixtures({ projectId: "project-a" }), [saved]);
    await assert.rejects(
      browserAuthenticationStorageState({
        projectId: "project-b",
        targetId: "browser-a",
        reference: saved.reference,
        now: 500,
      }),
      /not found in this project and target/u,
    );
    await assert.rejects(
      browserAuthenticationStorageState({
        projectId: "project-a",
        targetId: "browser-b",
        reference: saved.reference,
        now: 500,
      }),
      /not found in this project and target/u,
    );
  });
});

test("revoked and expired browser authentication fixtures fail closed", async () => {
  await fixtureWorkspace(async () => {
    const expired = await saveBrowserAuthenticationFixture({
      projectId: "project-a",
      targetId: "browser-a",
      name: "Short session",
      createdBy: "human:reviewer",
      storageState: state,
      now: 100,
      expiresAt: 200,
    });
    await assert.rejects(
      browserAuthenticationStorageState({
        projectId: "project-a",
        targetId: "browser-a",
        reference: expired.reference,
        now: 201,
      }),
      /expired/u,
    );

    const active = await saveBrowserAuthenticationFixture({
      projectId: "project-a",
      targetId: "browser-a",
      name: "Member session",
      createdBy: "human:reviewer",
      storageState: state,
      now: 300,
    });
    const revoked = await revokeBrowserAuthenticationFixture({
      projectId: "project-a",
      targetId: "browser-a",
      reference: active.reference,
      revokedBy: "human:reviewer",
      now: 400,
    });
    assert.equal(revoked.revokedAt, 400);
    await assert.rejects(
      browserAuthenticationStorageState({
        projectId: "project-a",
        targetId: "browser-a",
        reference: active.reference,
        now: 401,
      }),
      /revoked/u,
    );
  });
});

test("authentication fixture references are exact and cannot become paths", async () => {
  await fixtureWorkspace(async () => {
    await assert.rejects(
      saveBrowserAuthenticationFixture({
        projectId: "project-a",
        targetId: "browser-a",
        name: "Member session",
        createdBy: "human:reviewer",
        fixtureId: "../../escape",
        storageState: state,
      }),
      /fixture id is invalid/u,
    );
    await assert.rejects(
      browserAuthenticationStorageState({
        projectId: "project-a",
        targetId: "browser-a",
        reference: "signed-in",
      }),
      /exact versioned identity/u,
    );
  });
});

test("concurrent fixture revisions are serialized without losing index entries", async () => {
  await fixtureWorkspace(async () => {
    const fixtureId = "00000000-0000-4000-8000-000000000001";
    const saved = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        saveBrowserAuthenticationFixture({
          projectId: "project-a",
          targetId: "browser-a",
          name: `Member session ${index + 1}`,
          createdBy: "human:reviewer",
          fixtureId,
          storageState: state,
        }),
      ),
    );
    assert.deepEqual(
      saved.map(({ revision }) => revision).sort((left, right) => left - right),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    assert.equal((await listBrowserAuthenticationFixtures({ projectId: "project-a" })).length, 8);
  });
});

test("tampered fixture ciphertext cannot be loaded", async () => {
  await fixtureWorkspace(async (root) => {
    const saved = await saveBrowserAuthenticationFixture({
      projectId: "project-a",
      targetId: "browser-a",
      name: "Member session",
      createdBy: "human:reviewer",
      storageState: state,
    });
    const fixtureRoot = join(root, ".relay", "browser-auth-fixtures");
    const projectDir = (await readdir(fixtureRoot))[0]!;
    const secretFile = join(fixtureRoot, projectDir, saved.id, "v1.json");
    const encrypted = JSON.parse(await readFile(secretFile, "utf8")) as { ciphertext: string };
    encrypted.ciphertext = `${encrypted.ciphertext.startsWith("A") ? "B" : "A"}${encrypted.ciphertext.slice(1)}`;
    await writeFile(secretFile, JSON.stringify(encrypted), "utf8");
    await assert.rejects(
      browserAuthenticationStorageState({
        projectId: "project-a",
        targetId: "browser-a",
        reference: saved.reference,
      }),
      /could not be authenticated/u,
    );
  });
});
