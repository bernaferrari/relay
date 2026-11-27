import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectTestInboxEnvironmentOverlay } from "./environment-overlays.js";
import { extractEmailCode, EmailSecretExtractionError } from "./email-secret-extraction.js";
import { inboxStepForIntent } from "./auth-step-intents.js";
import {
  latestNonRevokedTestInbox,
  listTestInboxes,
  loadTestInboxSecret,
  revokeTestInbox,
  rotateTestInbox,
  saveTestInbox,
} from "./test-inboxes.js";

const usernameCanary = "inbox-user-canary@example.test";
const passwordCanary = "inbox-password-canary-value";

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "relay-inbox-test-"));
}

async function files(root: string, directory = ""): Promise<string[]> {
  const base = join(root, directory);
  const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    const relative = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...(await files(root, relative)));
    else out.push(relative);
  }
  return out;
}

test("test inboxes encrypt credentials, rotate exact revisions, and keep plaintext out of storage", async () => {
  const root = await workspace();
  try {
    const saved = await saveTestInbox({
      projectId: "project",
      key: "member",
      name: "Member inbox",
      host: "imap.example.test",
      port: 993,
      secure: true,
      mailbox: "INBOX",
      recipient: "member+test@example.test",
      usernameHint: "shared test mailbox",
      username: usernameCanary,
      password: passwordCanary,
      createdBy: "human@example.test",
      now: 100,
      workspaceRoot: root,
    });
    assert.equal(saved.reference, `inbox:${saved.id}:1`);
    const rotated = await rotateTestInbox({
      projectId: "project",
      key: "member",
      username: usernameCanary,
      password: `${passwordCanary}-rotated`,
      updatedBy: "human@example.test",
      now: 200,
      workspaceRoot: root,
    });
    assert.equal(rotated.revision, 2);
    assert.equal(
      latestNonRevokedTestInbox(
        await listTestInboxes({ projectId: "project", workspaceRoot: root }),
        "member",
      )?.reference,
      rotated.reference,
    );
    const loaded = await loadTestInboxSecret({
      projectId: "project",
      reference: rotated.reference,
      workspaceRoot: root,
    });
    assert.equal(loaded.secret.username, usernameCanary);
    assert.equal(loaded.secret.password, `${passwordCanary}-rotated`);
    let all = "";
    for (const file of await files(join(root, ".relay"))) {
      const path = join(root, ".relay", file);
      all += await readFile(path, "utf8").catch(() => "");
      if (!file.endsWith(".png")) assert.equal((await stat(path)).mode & 0o777, 0o600);
    }
    assert.equal(all.includes(passwordCanary), false);
    assert.equal(all.includes(usernameCanary), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("revocation is terminal and environment overlays win only when complete", async () => {
  const root = await workspace();
  try {
    await saveTestInbox({
      projectId: "project",
      key: "member",
      name: "Member inbox",
      host: "imap.example.test",
      port: 993,
      secure: true,
      mailbox: "INBOX",
      username: usernameCanary,
      password: passwordCanary,
      createdBy: "human@example.test",
      workspaceRoot: root,
    });
    const revoked = await revokeTestInbox({
      projectId: "project",
      key: "member",
      revokedBy: "human@example.test",
      workspaceRoot: root,
    });
    assert.ok(revoked.every((record) => record.revokedAt !== undefined));
    await assert.rejects(
      loadTestInboxSecret({
        projectId: "project",
        reference: revoked[0]!.reference,
        workspaceRoot: root,
      }),
      /revoked/u,
    );

    const partial = inspectTestInboxEnvironmentOverlay("member", {
      RELAY_INBOX_MEMBER_HOST: "imap.example.test",
      RELAY_INBOX_MEMBER_USERNAME: "u",
    });
    assert.equal(partial.status, "partial");
    if (partial.status === "partial")
      assert.deepEqual(partial.missing.sort(), ["mailbox", "password", "port", "secure"].sort());
    const complete = inspectTestInboxEnvironmentOverlay("member", {
      RELAY_INBOX_MEMBER_HOST: "imap.example.test",
      RELAY_INBOX_MEMBER_PORT: "993",
      RELAY_INBOX_MEMBER_SECURE: "true",
      RELAY_INBOX_MEMBER_MAILBOX: "INBOX",
      RELAY_INBOX_MEMBER_USERNAME: "u",
      RELAY_INBOX_MEMBER_PASSWORD: "p",
    });
    assert.equal(complete.status, "complete");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("code extraction chooses the newest unambiguous OTP and fails closed on ambiguity", () => {
  const base = {
    uid: 1,
    internalDateMs: 100,
    recipients: ["member+test@example.test"],
    bodyText: "Your sign-in code is 123456.",
  };
  assert.equal(extractEmailCode([base]).code, "123456");
  assert.throws(
    () =>
      extractEmailCode([
        { ...base, bodyText: "Your sign-in code is 123456. Another sign-in code is 654321." },
      ]),
    (error: unknown) =>
      error instanceof EmailSecretExtractionError && error.code === "ambiguous-code",
  );
  assert.throws(
    () => extractEmailCode([{ ...base, bodyText: "Hello and welcome." }]),
    /did not contain/u,
  );
});

test("canonical inbox phrase is exact and near misses do not compile to inbox authority", () => {
  assert.deepEqual(inboxStepForIntent("Enter the code from the email"), { action: "type-code" });
  assert.deepEqual(inboxStepForIntent(" enter   the code from the email! "), {
    action: "type-code",
  });
  assert.equal(inboxStepForIntent("Enter the code from email"), undefined);
  assert.equal(inboxStepForIntent("Enter the magic link from the email"), undefined);
});
