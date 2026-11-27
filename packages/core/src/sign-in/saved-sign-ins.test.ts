import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  latestNonRevokedSavedSignIn,
  listSavedSignIns,
  loadSavedSignInSecret,
  revokeSavedSignIn,
  rotateSavedSignIn,
  saveSavedSignIn,
} from "./saved-sign-ins.js";
import {
  inspectSavedSignInEnvironmentOverlay,
  savedSignInEnvironmentVariableNames,
} from "./environment-overlays.js";
import { resolveSavedSignIn } from "./sign-in-resolution.js";
import {
  resolveSecretReference,
  SIGN_IN_PASSWORD_REFERENCE,
  SIGN_IN_USERNAME_REFERENCE,
} from "./secret-references.js";
import { intentHasSignInAuth, signInAuthForIntent } from "./auth-step-intents.js";
import { assertSavedSignInsAvailable, savedSignInKeysForRecipeGraph } from "./sign-in-admission.js";

const usernameCanary = "member-canary@example.test";
const passwordCanary = "correct-horse-canary-password";

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "relay-sign-in-test-"));
}

async function save(root: string, key = "member") {
  return saveSavedSignIn({
    projectId: "project",
    appMapId: "shop",
    key,
    name: "Member account",
    username: usernameCanary,
    password: passwordCanary,
    createdBy: "human:test",
    now: 1_000,
    workspaceRoot: root,
  });
}

test("saved sign-ins encrypt secrets with owner-only files and no plaintext canaries", async () => {
  const root = await workspace();
  const saved = await save(root);
  const files = [
    join(root, ".relay", ".sign-in-key"),
    join(root, ".relay", "sign-ins", "244210e48437b6556980a702", "index.json"),
  ];
  const secretFile = join(
    root,
    ".relay",
    "sign-ins",
    "244210e48437b6556980a702",
    saved.id,
    "v1.json",
  );
  files.push(secretFile);
  for (const file of files) {
    assert.equal((await stat(file)).mode & 0o777, 0o600, file);
    const raw = await readFile(file, "utf8");
    assert.equal(raw.includes(usernameCanary), false);
    assert.equal(raw.includes(passwordCanary), false);
  }
  const encrypted = JSON.parse(await readFile(secretFile, "utf8"));
  assert.equal(encrypted.algorithm, "aes-256-gcm");
  const loaded = await loadSavedSignInSecret({
    projectId: "project",
    reference: saved.reference,
    now: 1_001,
    workspaceRoot: root,
  });
  assert.deepEqual(loaded.secret, { username: usernameCanary, password: passwordCanary });
});

test("AAD binding rejects cross-revision ciphertext and authentication-tag tampering", async () => {
  const root = await workspace();
  const saved = await save(root);
  const rotated = await rotateSavedSignIn({
    projectId: "project",
    key: "member",
    username: "rotated@example.test",
    password: "rotated-password",
    updatedBy: "human:test",
    now: 2_000,
    workspaceRoot: root,
  });
  const base = join(root, ".relay", "sign-ins", "244210e48437b6556980a702", saved.id);
  const v1 = join(base, "v1.json");
  const v2 = join(base, "v2.json");
  const authenticV2 = await readFile(v2, "utf8");
  await copyFile(v1, v2);
  await assert.rejects(
    loadSavedSignInSecret({
      projectId: "project",
      reference: rotated.reference,
      now: 2_001,
      workspaceRoot: root,
    }),
    /could not be authenticated/u,
  );

  await writeFile(v2, authenticV2);
  const encrypted = JSON.parse(authenticV2);
  encrypted.tag = encrypted.tag.startsWith("A")
    ? "B" + encrypted.tag.slice(1)
    : "A" + encrypted.tag.slice(1);
  await writeFile(v2, JSON.stringify(encrypted));
  await assert.rejects(
    loadSavedSignInSecret({
      projectId: "project",
      reference: rotated.reference,
      now: 2_001,
      workspaceRoot: root,
    }),
    /could not be authenticated/u,
  );
});

test("revoked and expired saved sign-ins fail closed", async () => {
  const root = await workspace();
  const expiring = await saveSavedSignIn({
    projectId: "project",
    appMapId: "shop",
    key: "expiring",
    name: "Expiring",
    username: usernameCanary,
    password: passwordCanary,
    expiresAt: 1_500,
    createdBy: "human:test",
    now: 1_000,
    workspaceRoot: root,
  });
  await assert.rejects(
    loadSavedSignInSecret({
      projectId: "project",
      reference: expiring.reference,
      now: 1_500,
      workspaceRoot: root,
    }),
    /expired/u,
  );

  const saved = await save(root);
  await revokeSavedSignIn({
    projectId: "project",
    key: "member",
    revokedBy: "human:test",
    now: 3_000,
    workspaceRoot: root,
  });
  await assert.rejects(
    loadSavedSignInSecret({
      projectId: "project",
      reference: saved.reference,
      now: 3_001,
      workspaceRoot: root,
    }),
    /revoked/u,
  );
  assert.equal(
    latestNonRevokedSavedSignIn(
      await listSavedSignIns({ projectId: "project", key: "member", workspaceRoot: root }),
      "member",
    ),
    undefined,
  );
});

test("complete environment overlay wins and partial overlay fails without local fallback", async () => {
  const root = await workspace();
  await save(root);
  const names = savedSignInEnvironmentVariableNames("member");
  assert.deepEqual(names, {
    usernameVariable: "RELAY_SIGN_IN_MEMBER_USERNAME",
    passwordVariable: "RELAY_SIGN_IN_MEMBER_PASSWORD",
  });
  const complete = {
    RELAY_SIGN_IN_MEMBER_USERNAME: "ci-user",
    RELAY_SIGN_IN_MEMBER_PASSWORD: "ci-password",
  };
  const resolved = await resolveSavedSignIn({
    projectId: "project",
    key: "member",
    env: complete,
    workspaceRoot: root,
  });
  assert.equal(resolved.source, "environment");
  assert.equal(resolved.username, "ci-user");

  const partial = inspectSavedSignInEnvironmentOverlay("member", {
    RELAY_SIGN_IN_MEMBER_USERNAME: "ci-user",
  });
  assert.equal(partial.status, "partial");
  await assert.rejects(
    resolveSavedSignIn({
      projectId: "project",
      key: "member",
      env: { RELAY_SIGN_IN_MEMBER_USERNAME: "ci-user" },
      workspaceRoot: root,
    }),
    /will not use the local saved sign-in as a fallback/u,
  );
});

test("canonical sign-in phrases are narrow and normalized", () => {
  assert.deepEqual(signInAuthForIntent('Sign in with the saved account "member".'), {
    type: "sign-in",
    accountKey: "member",
  });
  assert.deepEqual(signInAuthForIntent("SIGN IN WITH THE SAVED ACCOUNT!"), { type: "sign-in" });
  assert.deepEqual(signInAuthForIntent("Sign in with the saved account “member”"), {
    type: "sign-in",
    accountKey: "member",
  });
  assert.equal(intentHasSignInAuth("Sign in with the saved account member"), false);
  assert.equal(intentHasSignInAuth("Sign in with a saved account"), false);
  assert.equal(intentHasSignInAuth("Please sign in with the saved account"), false);
});

test("secret references resolve only in an active sign-in context and fail closed", () => {
  const active = {
    accountKey: "member",
    username: usernameCanary,
    password: passwordCanary,
    source: "local" as const,
    startedAt: 1,
  };
  assert.equal(resolveSecretReference(SIGN_IN_USERNAME_REFERENCE, active), usernameCanary);
  assert.equal(resolveSecretReference(SIGN_IN_PASSWORD_REFERENCE, active), passwordCanary);
  assert.equal(resolveSecretReference("ordinary text", active), "ordinary text");
  assert.throws(
    () => resolveSecretReference(SIGN_IN_USERNAME_REFERENCE, undefined),
    /active saved sign-in/u,
  );
  assert.throws(
    () => resolveSecretReference("secret:unknown.value", active),
    /Unknown secret reference/u,
  );
});

test("run admission scans nested recipes and fail-closed accounts before execution", async () => {
  const root = await workspace();
  const graph = {
    root: {
      id: "root",
      title: "root",
      source: "custom" as const,
      createdAt: 1,
      updatedAt: 1,
      steps: [
        {
          kind: "act" as const,
          intent: 'Sign in with the saved account "member"',
          auth: { type: "sign-in" as const, accountKey: "member" },
        },
      ],
    },
  };
  assert.deepEqual(savedSignInKeysForRecipeGraph(graph), ["member"]);
  await assert.rejects(
    assertSavedSignInsAvailable({ projectId: "project", recipeGraph: graph }),
    /was not found/u,
  );
  process.env.RELAY_SIGN_IN_MEMBER_USERNAME = "admission-user";
  process.env.RELAY_SIGN_IN_MEMBER_PASSWORD = "admission-password";
  try {
    await assertSavedSignInsAvailable({ projectId: "project", recipeGraph: graph });
  } finally {
    delete process.env.RELAY_SIGN_IN_MEMBER_USERNAME;
    delete process.env.RELAY_SIGN_IN_MEMBER_PASSWORD;
  }
  assert.equal(root.length > 0, true);
});
