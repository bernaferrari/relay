import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  testInboxMetadataSchema,
  testInboxSecretSchema,
  type TestInboxMetadata,
  type TestInboxSecret,
} from "@relay/protocol";
import { normalizeSavedSignInKey } from "./saved-sign-ins.js";
import {
  atomicSecretWrite,
  createSecretVault,
  secretVaultProjectKey,
  secretVaultWorkspaceRoot,
} from "./secret-vault.js";

const TEST_INBOX_REFERENCE =
  /^inbox:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([1-9][0-9]*)$/u;
const MAX_TEST_INBOX_RECORDS = 256;
const projectUpdateTails = new Map<string, Promise<void>>();

export class TestInboxStoreError extends Error {
  constructor(
    readonly code: "invalid" | "missing" | "exists" | "revoked" | "unavailable" | "limit-reached",
    message: string,
  ) {
    super(message);
    this.name = "TestInboxStoreError";
  }
}

export function normalizeTestInboxKey(key?: string): string {
  return normalizeSavedSignInKey(key);
}

/** The inbox a saved sign-in uses: the explicit link when one was saved,
 * otherwise the inbox that shares the sign-in's key. Keys are person-chosen
 * namespaces, so a same-named inbox is the deliberate zero-configuration
 * connection; an explicit link always wins. */
export function inboxKeyForSavedSignIn(accountKey: string, explicitInboxKey?: string): string {
  return normalizeTestInboxKey(explicitInboxKey ?? accountKey);
}

export function parseTestInboxReference(reference: string): { id: string; revision: number } {
  const match = TEST_INBOX_REFERENCE.exec(reference);
  const revision = match ? Number(match[2]) : Number.NaN;
  if (!match || !Number.isSafeInteger(revision) || revision < 1) {
    throw new TestInboxStoreError(
      "invalid",
      "Test inbox reference is not an exact versioned identity",
    );
  }
  return { id: match[1]!, revision };
}

function root(workspaceRoot?: string): string {
  return join(secretVaultWorkspaceRoot(workspaceRoot), ".relay", "test-inboxes");
}
function indexPath(projectId: string, workspaceRoot?: string): string {
  return join(root(workspaceRoot), secretVaultProjectKey(projectId), "index.json");
}
function secretPath(
  projectId: string,
  id: string,
  revision: number,
  workspaceRoot?: string,
): string {
  return join(root(workspaceRoot), secretVaultProjectKey(projectId), id, `v${revision}.json`);
}
function reference(id: string, revision: number): string {
  return `inbox:${id}:${revision}`;
}
function vault(workspaceRoot?: string) {
  return createSecretVault({
    ...(workspaceRoot ? { workspaceRoot } : {}),
    keyFileName: ".test-inbox-key",
  });
}
function parseMetadata(value: unknown): TestInboxMetadata {
  const parsed = testInboxMetadataSchema.safeParse(value);
  if (!parsed.success)
    throw new TestInboxStoreError("unavailable", "Test inbox metadata is invalid");
  return Object.freeze(structuredClone(parsed.data));
}
function parseIndex(raw: string, projectId: string): TestInboxMetadata[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TestInboxStoreError("unavailable", "Test inbox index is invalid");
  }
  if (!Array.isArray(parsed))
    throw new TestInboxStoreError("unavailable", "Test inbox index is invalid");
  const records = parsed.map(parseMetadata);
  if (records.some((record) => record.projectId !== projectId)) {
    throw new TestInboxStoreError("unavailable", "Test inbox index crossed its project scope");
  }
  return records.sort(
    (left, right) => left.id.localeCompare(right.id) || left.revision - right.revision,
  );
}
async function readIndex(projectId: string, workspaceRoot?: string): Promise<TestInboxMetadata[]> {
  try {
    return parseIndex(await readFile(indexPath(projectId, workspaceRoot), "utf8"), projectId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    if (error instanceof TestInboxStoreError) throw error;
    throw new TestInboxStoreError("unavailable", "Test inbox index is unavailable");
  }
}
async function writeIndex(
  projectId: string,
  records: readonly TestInboxMetadata[],
  workspaceRoot?: string,
): Promise<void> {
  await atomicSecretWrite(
    indexPath(projectId, workspaceRoot),
    `${JSON.stringify(records, null, 2)}\n`,
  );
}
async function withProjectUpdate<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  const key = secretVaultProjectKey(projectId);
  const previous = projectUpdateTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  projectUpdateTails.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (projectUpdateTails.get(key) === tail) projectUpdateTails.delete(key);
  }
}
function assertSecret(input: unknown): TestInboxSecret {
  const parsed = testInboxSecretSchema.safeParse(input);
  if (!parsed.success)
    throw new TestInboxStoreError("invalid", "Test inbox username and password are invalid");
  return structuredClone(parsed.data);
}
function assertHintIsNonSecret(usernameHint: string | undefined, secret: TestInboxSecret): void {
  const hint = usernameHint?.trim();
  if (!hint) return;
  if (hint === secret.username || hint.includes(secret.password)) {
    throw new TestInboxStoreError(
      "invalid",
      "Test inbox username hint must be non-secret metadata",
    );
  }
}
function aad(record: TestInboxMetadata): Record<string, string | number | null> {
  return {
    schemaVersion: record.schemaVersion,
    id: record.id,
    revision: record.revision,
    projectId: record.projectId,
    key: record.key,
    host: record.host,
    port: record.port,
    secure: record.secure ? 1 : 0,
    mailbox: record.mailbox,
    recipient: record.recipient ?? null,
    createdAt: record.createdAt,
  };
}
function recordsForKey(records: readonly TestInboxMetadata[], key: string): TestInboxMetadata[] {
  return records
    .filter((record) => record.key === key)
    .sort((left, right) => left.revision - right.revision);
}

export async function listTestInboxes(input: {
  projectId: string;
  key?: string;
  workspaceRoot?: string;
}): Promise<TestInboxMetadata[]> {
  const key = input.key === undefined ? undefined : normalizeTestInboxKey(input.key);
  return (await readIndex(input.projectId, input.workspaceRoot)).filter(
    (record) => !key || record.key === key,
  );
}

function validConfiguration(input: {
  host: string;
  port: number;
  mailbox: string;
  name?: string;
  actor?: string;
}): void {
  if (
    !input.host.trim() ||
    input.host.length > 253 ||
    !Number.isSafeInteger(input.port) ||
    input.port < 1 ||
    input.port > 65_535 ||
    !input.mailbox.trim() ||
    input.mailbox.length > 256 ||
    (input.name !== undefined && (!input.name.trim() || input.name.length > 128)) ||
    (input.actor !== undefined && !input.actor.trim())
  ) {
    throw new TestInboxStoreError("invalid", "Test inbox metadata is invalid");
  }
}

export async function saveTestInbox(input: {
  projectId: string;
  key?: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  mailbox: string;
  recipient?: string;
  usernameHint?: string;
  username: string;
  password: string;
  createdBy: string;
  now?: number;
  workspaceRoot?: string;
}): Promise<TestInboxMetadata> {
  const key = normalizeTestInboxKey(input.key);
  const secret = assertSecret({ username: input.username, password: input.password });
  assertHintIsNonSecret(input.usernameHint, secret);
  validConfiguration({ ...input, actor: input.createdBy });
  const at = input.now ?? Date.now();
  const id = randomUUID();
  return withProjectUpdate(input.projectId, async () => {
    const records = await readIndex(input.projectId, input.workspaceRoot);
    if (recordsForKey(records, key).length) {
      throw new TestInboxStoreError(
        "exists",
        `Test inbox "${key}" already exists; rotate it instead`,
      );
    }
    if (records.length >= MAX_TEST_INBOX_RECORDS) {
      throw new TestInboxStoreError("limit-reached", "Test inbox limit reached");
    }
    const metadata = parseMetadata({
      schemaVersion: 1,
      id,
      reference: reference(id, 1),
      revision: 1,
      projectId: input.projectId,
      key,
      name: input.name.trim(),
      host: input.host.trim(),
      port: input.port,
      secure: input.secure,
      mailbox: input.mailbox.trim(),
      ...(input.recipient?.trim() ? { recipient: input.recipient.trim() } : {}),
      ...(input.usernameHint?.trim() ? { usernameHint: input.usernameHint.trim() } : {}),
      createdAt: at,
      createdBy: input.createdBy.trim(),
      updatedAt: at,
      updatedBy: input.createdBy.trim(),
    });
    const encrypted = await vault(input.workspaceRoot).encrypt(secret, aad(metadata));
    await atomicSecretWrite(
      secretPath(input.projectId, id, 1, input.workspaceRoot),
      JSON.stringify(encrypted),
    );
    await writeIndex(input.projectId, [...records, metadata], input.workspaceRoot);
    return metadata;
  });
}

export async function rotateTestInbox(input: {
  projectId: string;
  key?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  mailbox?: string;
  recipient?: string;
  usernameHint?: string;
  username: string;
  password: string;
  updatedBy: string;
  now?: number;
  workspaceRoot?: string;
}): Promise<TestInboxMetadata> {
  const key = normalizeTestInboxKey(input.key);
  const secret = assertSecret({ username: input.username, password: input.password });
  const at = input.now ?? Date.now();
  const updatedBy = input.updatedBy.trim();
  if (!updatedBy)
    throw new TestInboxStoreError("invalid", "Test inbox reviewer identity is invalid");
  return withProjectUpdate(input.projectId, async () => {
    const records = await readIndex(input.projectId, input.workspaceRoot);
    const latest = recordsForKey(records, key).at(-1);
    if (!latest) throw new TestInboxStoreError("missing", `Test inbox "${key}" was not found`);
    if (records.length >= MAX_TEST_INBOX_RECORDS) {
      throw new TestInboxStoreError("limit-reached", "Test inbox limit reached");
    }
    const revision = latest.revision + 1;
    const metadata = parseMetadata({
      ...latest,
      reference: reference(latest.id, revision),
      revision,
      host: (input.host ?? latest.host).trim(),
      port: input.port ?? latest.port,
      secure: input.secure ?? latest.secure,
      mailbox: (input.mailbox ?? latest.mailbox).trim(),
      ...((input.recipient ?? latest.recipient)
        ? { recipient: (input.recipient ?? latest.recipient)!.trim() }
        : {}),
      ...((input.usernameHint ?? latest.usernameHint)
        ? { usernameHint: (input.usernameHint ?? latest.usernameHint)!.trim() }
        : {}),
      createdAt: at,
      createdBy: updatedBy,
      updatedAt: at,
      updatedBy,
      revokedAt: undefined,
      revokedBy: undefined,
    });
    assertHintIsNonSecret(metadata.usernameHint, secret);
    validConfiguration(metadata);
    const encrypted = await vault(input.workspaceRoot).encrypt(secret, aad(metadata));
    await atomicSecretWrite(
      secretPath(input.projectId, latest.id, revision, input.workspaceRoot),
      JSON.stringify(encrypted),
    );
    await writeIndex(input.projectId, [...records, metadata], input.workspaceRoot);
    return metadata;
  });
}

export async function revokeTestInbox(input: {
  projectId: string;
  key?: string;
  revokedBy: string;
  now?: number;
  workspaceRoot?: string;
}): Promise<TestInboxMetadata[]> {
  const key = normalizeTestInboxKey(input.key);
  const revokedBy = input.revokedBy.trim();
  if (!revokedBy)
    throw new TestInboxStoreError("invalid", "Test inbox reviewer identity is invalid");
  const at = input.now ?? Date.now();
  return withProjectUpdate(input.projectId, async () => {
    const records = await readIndex(input.projectId, input.workspaceRoot);
    const existing = new Set(recordsForKey(records, key).map((record) => record.reference));
    if (!existing.size)
      throw new TestInboxStoreError("missing", `Test inbox "${key}" was not found`);
    const next = records.map((record) =>
      existing.has(record.reference) && record.revokedAt === undefined
        ? parseMetadata({
            ...record,
            updatedAt: at,
            updatedBy: revokedBy,
            revokedAt: at,
            revokedBy,
          })
        : record,
    );
    await writeIndex(input.projectId, next, input.workspaceRoot);
    return next.filter((record) => existing.has(record.reference));
  });
}

export function latestNonRevokedTestInbox(
  records: readonly TestInboxMetadata[],
  keyInput?: string,
): TestInboxMetadata | undefined {
  const key = normalizeTestInboxKey(keyInput);
  return recordsForKey(records, key)
    .filter((record) => record.revokedAt === undefined)
    .at(-1);
}

export async function loadTestInboxSecret(input: {
  projectId: string;
  reference: string;
  workspaceRoot?: string;
}): Promise<{ metadata: TestInboxMetadata; secret: TestInboxSecret }> {
  const identity = parseTestInboxReference(input.reference);
  const metadata = (await readIndex(input.projectId, input.workspaceRoot)).find(
    (record) => record.id === identity.id && record.revision === identity.revision,
  );
  if (!metadata)
    throw new TestInboxStoreError("missing", "Test inbox was not found in this project");
  if (metadata.revokedAt !== undefined) {
    throw new TestInboxStoreError("revoked", `Test inbox "${metadata.key}" is revoked`);
  }
  let encrypted: unknown;
  try {
    encrypted = JSON.parse(
      await readFile(
        secretPath(input.projectId, identity.id, identity.revision, input.workspaceRoot),
        "utf8",
      ),
    );
  } catch {
    throw new TestInboxStoreError("unavailable", "Test inbox ciphertext is unavailable");
  }
  let plaintext: unknown;
  try {
    plaintext = await vault(input.workspaceRoot).decrypt(encrypted, aad(metadata));
  } catch {
    throw new TestInboxStoreError(
      "unavailable",
      "Test inbox ciphertext could not be authenticated",
    );
  }
  return { metadata, secret: assertSecret(plaintext) };
}
