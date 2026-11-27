import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_SAVED_SIGN_IN_KEY,
  savedSignInKeySchema,
  savedSignInMetadataSchema,
  savedSignInSecretSchema,
  type SavedSignInMetadata,
  type SavedSignInSecret,
} from "@relay/protocol";
import {
  atomicSecretWrite,
  createSecretVault,
  secretVaultProjectKey,
  secretVaultWorkspaceRoot,
} from "./secret-vault.js";

const SAVED_SIGN_IN_REFERENCE =
  /^signin:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([1-9][0-9]*)$/u;
const MAX_SAVED_SIGN_IN_RECORDS = 256;
const projectUpdateTails = new Map<string, Promise<void>>();

export class SavedSignInStoreError extends Error {
  constructor(
    readonly code:
      | "invalid"
      | "missing"
      | "exists"
      | "revoked"
      | "expired"
      | "unavailable"
      | "limit-reached",
    message: string,
  ) {
    super(message);
    this.name = "SavedSignInStoreError";
  }
}

export function normalizeSavedSignInKey(key?: string): string {
  const candidate = key?.trim() || DEFAULT_SAVED_SIGN_IN_KEY;
  const parsed = savedSignInKeySchema.safeParse(candidate);
  if (!parsed.success) {
    throw new SavedSignInStoreError(
      "invalid",
      "Saved sign-in key must use lowercase letters, numbers, dots, underscores or dashes",
    );
  }
  return parsed.data;
}

export function parseSavedSignInReference(reference: string): { id: string; revision: number } {
  const match = SAVED_SIGN_IN_REFERENCE.exec(reference);
  const revision = match ? Number(match[2]) : Number.NaN;
  if (!match || !Number.isSafeInteger(revision) || revision < 1) {
    throw new SavedSignInStoreError(
      "invalid",
      "Saved sign-in reference is not an exact versioned identity",
    );
  }
  return { id: match[1]!, revision };
}

function root(workspaceRoot?: string): string {
  return join(secretVaultWorkspaceRoot(workspaceRoot), ".relay", "sign-ins");
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
  return `signin:${id}:${revision}`;
}

function vault(workspaceRoot?: string) {
  return createSecretVault({
    ...(workspaceRoot ? { workspaceRoot } : {}),
    keyFileName: ".sign-in-key",
  });
}

function parseMetadata(value: unknown): SavedSignInMetadata {
  const parsed = savedSignInMetadataSchema.safeParse(value);
  if (!parsed.success)
    throw new SavedSignInStoreError("unavailable", "Saved sign-in metadata is invalid");
  return Object.freeze(structuredClone(parsed.data));
}

function parseIndex(raw: string, projectId: string): SavedSignInMetadata[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SavedSignInStoreError("unavailable", "Saved sign-in index is invalid");
  }
  if (!Array.isArray(parsed))
    throw new SavedSignInStoreError("unavailable", "Saved sign-in index is invalid");
  const records = parsed.map(parseMetadata);
  if (records.some((record) => record.projectId !== projectId)) {
    throw new SavedSignInStoreError("unavailable", "Saved sign-in index crossed its project scope");
  }
  return records.sort(
    (left, right) => left.id.localeCompare(right.id) || left.revision - right.revision,
  );
}

async function readIndex(
  projectId: string,
  workspaceRoot?: string,
): Promise<SavedSignInMetadata[]> {
  try {
    return parseIndex(await readFile(indexPath(projectId, workspaceRoot), "utf8"), projectId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    if (error instanceof SavedSignInStoreError) throw error;
    throw new SavedSignInStoreError("unavailable", "Saved sign-in index is unavailable");
  }
}

async function writeIndex(
  projectId: string,
  records: readonly SavedSignInMetadata[],
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

function assertSecret(input: unknown): SavedSignInSecret {
  const parsed = savedSignInSecretSchema.safeParse(input);
  if (!parsed.success) {
    throw new SavedSignInStoreError("invalid", "Saved sign-in username and password are invalid");
  }
  return structuredClone(parsed.data);
}

function assertHintIsNonSecret(usernameHint: string | undefined, secret: SavedSignInSecret): void {
  const hint = usernameHint?.trim();
  if (!hint) return;
  if (hint === secret.username || hint.includes(secret.password)) {
    throw new SavedSignInStoreError(
      "invalid",
      "Saved sign-in username hint must be non-secret metadata",
    );
  }
}

function aad(record: SavedSignInMetadata): Record<string, string | number | null> {
  return {
    schemaVersion: record.schemaVersion,
    id: record.id,
    revision: record.revision,
    projectId: record.projectId,
    appMapId: record.appMapId,
    key: record.key,
    kind: record.kind,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt ?? null,
  };
}

function recordsForKey(
  records: readonly SavedSignInMetadata[],
  key: string,
): SavedSignInMetadata[] {
  return records
    .filter((record) => record.key === key)
    .sort((left, right) => left.revision - right.revision);
}

function validateExpiry(expiresAt: number | undefined, at: number): void {
  if (expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || expiresAt <= at)) {
    throw new SavedSignInStoreError("invalid", "Saved sign-in expiry must be in the future");
  }
}

export async function listSavedSignIns(input: {
  projectId: string;
  appMapId?: string;
  key?: string;
  workspaceRoot?: string;
}): Promise<SavedSignInMetadata[]> {
  const key = input.key === undefined ? undefined : normalizeSavedSignInKey(input.key);
  const records = await readIndex(input.projectId, input.workspaceRoot);
  return records.filter(
    (record) =>
      (!input.appMapId || record.appMapId === input.appMapId) && (!key || record.key === key),
  );
}

export async function saveSavedSignIn(input: {
  projectId: string;
  appMapId: string;
  key?: string;
  name: string;
  username: string;
  password: string;
  usernameHint?: string;
  inboxKey?: string;
  expiresAt?: number;
  createdBy: string;
  now?: number;
  workspaceRoot?: string;
}): Promise<SavedSignInMetadata> {
  const key = normalizeSavedSignInKey(input.key);
  const secret = assertSecret({ username: input.username, password: input.password });
  assertHintIsNonSecret(input.usernameHint, secret);
  const at = input.now ?? Date.now();
  validateExpiry(input.expiresAt, at);
  const appMapId = input.appMapId.trim();
  const name = input.name.trim();
  const createdBy = input.createdBy.trim();
  if (!appMapId || appMapId.length > 128 || !name || name.length > 128 || !createdBy) {
    throw new SavedSignInStoreError("invalid", "Saved sign-in metadata is invalid");
  }
  const id = randomUUID();
  return withProjectUpdate(input.projectId, async () => {
    const records = await readIndex(input.projectId, input.workspaceRoot);
    if (recordsForKey(records, key).length) {
      throw new SavedSignInStoreError(
        "exists",
        `Saved sign-in "${key}" already exists; rotate it instead`,
      );
    }
    if (records.length >= MAX_SAVED_SIGN_IN_RECORDS) {
      throw new SavedSignInStoreError("limit-reached", "Saved sign-in limit reached");
    }
    const metadata = parseMetadata({
      schemaVersion: 1,
      id,
      reference: reference(id, 1),
      revision: 1,
      projectId: input.projectId,
      appMapId,
      key,
      name,
      kind: "username-password",
      ...(input.usernameHint?.trim() ? { usernameHint: input.usernameHint.trim() } : {}),
      ...(input.inboxKey ? { inboxKey: normalizeSavedSignInKey(input.inboxKey) } : {}),
      createdAt: at,
      createdBy,
      updatedAt: at,
      updatedBy: createdBy,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
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

export async function rotateSavedSignIn(input: {
  projectId: string;
  key?: string;
  username: string;
  password: string;
  usernameHint?: string;
  inboxKey?: string;
  expiresAt?: number;
  updatedBy: string;
  now?: number;
  workspaceRoot?: string;
}): Promise<SavedSignInMetadata> {
  const key = normalizeSavedSignInKey(input.key);
  const secret = assertSecret({ username: input.username, password: input.password });
  assertHintIsNonSecret(input.usernameHint, secret);
  const at = input.now ?? Date.now();
  const updatedBy = input.updatedBy.trim();
  if (!updatedBy)
    throw new SavedSignInStoreError("invalid", "Saved sign-in reviewer identity is invalid");
  return withProjectUpdate(input.projectId, async () => {
    const records = await readIndex(input.projectId, input.workspaceRoot);
    const existing = recordsForKey(records, key);
    const latest = existing.at(-1);
    if (!latest) {
      throw new SavedSignInStoreError("missing", `Saved sign-in "${key}" was not found`);
    }
    const expiresAt = input.expiresAt ?? latest.expiresAt;
    validateExpiry(expiresAt, at);
    if (records.length >= MAX_SAVED_SIGN_IN_RECORDS) {
      throw new SavedSignInStoreError("limit-reached", "Saved sign-in limit reached");
    }
    const revision = latest.revision + 1;
    const metadata = parseMetadata({
      schemaVersion: 1,
      id: latest.id,
      reference: reference(latest.id, revision),
      revision,
      projectId: latest.projectId,
      appMapId: latest.appMapId,
      key,
      name: latest.name,
      kind: latest.kind,
      ...((input.usernameHint ?? latest.usernameHint)
        ? { usernameHint: (input.usernameHint ?? latest.usernameHint)!.trim() }
        : {}),
      ...((input.inboxKey ?? latest.inboxKey)
        ? { inboxKey: normalizeSavedSignInKey(input.inboxKey ?? latest.inboxKey) }
        : {}),
      createdAt: at,
      createdBy: updatedBy,
      updatedAt: at,
      updatedBy,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    });
    const encrypted = await vault(input.workspaceRoot).encrypt(secret, aad(metadata));
    await atomicSecretWrite(
      secretPath(input.projectId, latest.id, revision, input.workspaceRoot),
      JSON.stringify(encrypted),
    );
    await writeIndex(input.projectId, [...records, metadata], input.workspaceRoot);
    return metadata;
  });
}

export async function revokeSavedSignIn(input: {
  projectId: string;
  key?: string;
  revokedBy: string;
  now?: number;
  workspaceRoot?: string;
}): Promise<SavedSignInMetadata[]> {
  const key = normalizeSavedSignInKey(input.key);
  const revokedBy = input.revokedBy.trim();
  if (!revokedBy)
    throw new SavedSignInStoreError("invalid", "Saved sign-in reviewer identity is invalid");
  const at = input.now ?? Date.now();
  return withProjectUpdate(input.projectId, async () => {
    const records = await readIndex(input.projectId, input.workspaceRoot);
    const existing = new Set(recordsForKey(records, key).map((record) => record.reference));
    if (!existing.size)
      throw new SavedSignInStoreError("missing", `Saved sign-in "${key}" was not found`);
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

export function latestNonRevokedSavedSignIn(
  records: readonly SavedSignInMetadata[],
  keyInput?: string,
): SavedSignInMetadata | undefined {
  const key = normalizeSavedSignInKey(keyInput);
  return recordsForKey(records, key)
    .filter((record) => record.revokedAt === undefined)
    .at(-1);
}

export async function loadSavedSignInSecret(input: {
  projectId: string;
  reference: string;
  now?: number;
  workspaceRoot?: string;
}): Promise<{ metadata: SavedSignInMetadata; secret: SavedSignInSecret }> {
  const identity = parseSavedSignInReference(input.reference);
  const metadata = (await readIndex(input.projectId, input.workspaceRoot)).find(
    (record) => record.id === identity.id && record.revision === identity.revision,
  );
  if (!metadata) {
    throw new SavedSignInStoreError("missing", "Saved sign-in was not found in this project");
  }
  if (metadata.revokedAt !== undefined) {
    throw new SavedSignInStoreError("revoked", `Saved sign-in "${metadata.key}" is revoked`);
  }
  if (metadata.expiresAt !== undefined && metadata.expiresAt <= (input.now ?? Date.now())) {
    throw new SavedSignInStoreError("expired", `Saved sign-in "${metadata.key}" is expired`);
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
    throw new SavedSignInStoreError("unavailable", "Saved sign-in ciphertext is unavailable");
  }
  let plaintext: unknown;
  try {
    plaintext = await vault(input.workspaceRoot).decrypt(encrypted, aad(metadata));
  } catch {
    throw new SavedSignInStoreError(
      "unavailable",
      "Saved sign-in ciphertext could not be authenticated",
    );
  }
  return { metadata, secret: assertSecret(plaintext) };
}
