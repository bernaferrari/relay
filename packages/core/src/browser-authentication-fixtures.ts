import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrowserContextOptions } from "playwright-core";
import { findWorkspaceRoot } from "./workspace-root.js";

const FIXTURE_SCHEMA_VERSION = 1 as const;
const FIXTURE_REFERENCE =
  /^authfx:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([1-9][0-9]*)$/u;
const FIXTURE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u;
const MAX_FIXTURES = 256;
const MAX_STORAGE_STATE_BYTES = 8 * 1024 * 1024;
const projectUpdateTails = new Map<string, Promise<void>>();

type BrowserStorageState = Exclude<BrowserContextOptions["storageState"], string | undefined>;

export type BrowserAuthenticationFixture = Readonly<{
  schemaVersion: typeof FIXTURE_SCHEMA_VERSION;
  id: string;
  reference: string;
  revision: number;
  projectId: string;
  targetId: string;
  name: string;
  origins: readonly string[];
  cookieCount: number;
  createdAt: number;
  createdBy: string;
  expiresAt?: number;
  revokedAt?: number;
  revokedBy?: string;
}>;

type EncryptedFixture = Readonly<{
  schemaVersion: typeof FIXTURE_SCHEMA_VERSION;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}>;

type FixtureSecret = Readonly<{
  schemaVersion: typeof FIXTURE_SCHEMA_VERSION;
  id: string;
  revision: number;
  projectId: string;
  targetId: string;
  createdAt: number;
  expiresAt?: number;
  storageState: BrowserStorageState;
}>;

function workspaceRoot(): string {
  return process.env.RELAY_WORKSPACE_ROOT?.trim() || findWorkspaceRoot();
}

function fixtureRoot(): string {
  return join(workspaceRoot(), ".relay", "browser-auth-fixtures");
}

function keyPath(): string {
  return join(workspaceRoot(), ".relay", ".browser-auth-fixture-key");
}

function projectKey(projectId: string): string {
  if (!SAFE_PROJECT_ID.test(projectId))
    throw new Error("Browser authentication project scope is invalid");
  return createHash("sha256").update(projectId, "utf8").digest("hex").slice(0, 24);
}

function indexPath(projectId: string): string {
  return join(fixtureRoot(), projectKey(projectId), "index.json");
}

function secretPath(projectId: string, id: string, revision: number): string {
  return join(fixtureRoot(), projectKey(projectId), id, `v${revision}.json`);
}

function reference(id: string, revision: number): string {
  return `authfx:${id}:${revision}`;
}

export function isBrowserAuthenticationFixtureReference(value: string): boolean {
  return FIXTURE_REFERENCE.test(value.trim());
}

function parseReference(value: string): { id: string; revision: number } {
  const match = FIXTURE_REFERENCE.exec(value);
  const revision = match ? Number(match[2]) : Number.NaN;
  if (!match || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Browser authentication fixture reference is not an exact versioned identity");
  }
  return { id: match[1]!, revision };
}

function boundedText(value: string, field: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`Browser authentication ${field} is invalid`);
  }
  return normalized;
}

function parseStorageState(value: unknown): BrowserStorageState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Browser authentication storage state is invalid");
  }
  const state = value as { cookies?: unknown; origins?: unknown };
  if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
    throw new Error("Browser authentication storage state must contain cookies and origins");
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_STORAGE_STATE_BYTES) {
    throw new Error("Browser authentication storage state exceeds the encrypted fixture limit");
  }
  return structuredClone(value) as BrowserStorageState;
}

function parseMetadata(value: unknown): BrowserAuthenticationFixture {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Browser authentication fixture metadata is invalid");
  }
  const item = value as Partial<BrowserAuthenticationFixture>;
  if (
    item.schemaVersion !== FIXTURE_SCHEMA_VERSION ||
    typeof item.id !== "string" ||
    !FIXTURE_ID.test(item.id) ||
    typeof item.reference !== "string" ||
    typeof item.revision !== "number" ||
    !Number.isSafeInteger(item.revision) ||
    typeof item.projectId !== "string" ||
    typeof item.targetId !== "string" ||
    typeof item.name !== "string" ||
    !Array.isArray(item.origins) ||
    item.origins.some((origin) => typeof origin !== "string") ||
    typeof item.cookieCount !== "number" ||
    !Number.isSafeInteger(item.cookieCount) ||
    item.cookieCount < 0 ||
    typeof item.createdAt !== "number" ||
    !Number.isSafeInteger(item.createdAt) ||
    typeof item.createdBy !== "string" ||
    (item.expiresAt !== undefined && !Number.isSafeInteger(item.expiresAt)) ||
    (item.revokedAt !== undefined && !Number.isSafeInteger(item.revokedAt)) ||
    (item.revokedAt === undefined) !== (item.revokedBy === undefined)
  ) {
    throw new Error("Browser authentication fixture metadata is invalid");
  }
  const identity = parseReference(item.reference);
  if (identity.id !== item.id || identity.revision !== item.revision) {
    throw new Error("Browser authentication fixture metadata identity is inconsistent");
  }
  return Object.freeze(structuredClone(item as BrowserAuthenticationFixture));
}

function parseIndexFile(raw: string, projectId: string): BrowserAuthenticationFixture[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Browser authentication fixture index is invalid");
  const fixtures = parsed.map(parseMetadata);
  if (fixtures.some((fixture) => fixture.projectId !== projectId)) {
    throw new Error("Browser authentication fixture index crossed its project scope");
  }
  return fixtures;
}

async function readIndex(projectId: string): Promise<BrowserAuthenticationFixture[]> {
  try {
    return parseIndexFile(await readFile(indexPath(projectId), "utf8"), projectId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function readIndexSync(projectId: string): BrowserAuthenticationFixture[] {
  try {
    return parseIndexFile(readFileSync(indexPath(projectId), "utf8"), projectId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function withProjectUpdate<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  const key = projectKey(projectId);
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

async function atomicWrite(path: string, content: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode, flag: "wx" });
  await rename(temporary, path);
  await chmod(path, mode);
}

async function writeIndex(projectId: string, fixtures: readonly BrowserAuthenticationFixture[]) {
  await atomicWrite(indexPath(projectId), `${JSON.stringify(fixtures, null, 2)}\n`, 0o600);
}

async function encryptionKey(): Promise<Buffer> {
  try {
    const value = Buffer.from((await readFile(keyPath(), "utf8")).trim(), "base64url");
    if (value.length !== 32) throw new Error("Browser authentication fixture key is invalid");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const key = randomBytes(32);
  await mkdir(dirname(keyPath()), { recursive: true, mode: 0o700 });
  try {
    await writeFile(keyPath(), `${key.toString("base64url")}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = Buffer.from((await readFile(keyPath(), "utf8")).trim(), "base64url");
    if (existing.length !== 32) throw new Error("Browser authentication fixture key is invalid");
    return existing;
  }
}

function additionalData(secret: Omit<FixtureSecret, "storageState">): Buffer {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: secret.schemaVersion,
      id: secret.id,
      revision: secret.revision,
      projectId: secret.projectId,
      targetId: secret.targetId,
      createdAt: secret.createdAt,
      expiresAt: secret.expiresAt ?? null,
    }),
    "utf8",
  );
}

async function encryptSecret(secret: FixtureSecret): Promise<EncryptedFixture> {
  const key = await encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(additionalData(secret));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(secret.storageState), "utf8"),
    cipher.final(),
  ]);
  return {
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

async function decryptSecret(
  encrypted: EncryptedFixture,
  identity: Omit<FixtureSecret, "storageState">,
): Promise<BrowserStorageState> {
  if (encrypted.schemaVersion !== FIXTURE_SCHEMA_VERSION || encrypted.algorithm !== "aes-256-gcm") {
    throw new Error("Browser authentication fixture ciphertext is unsupported");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      await encryptionKey(),
      Buffer.from(encrypted.iv, "base64url"),
    );
    decipher.setAAD(additionalData(identity));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return parseStorageState(JSON.parse(plaintext) as unknown);
  } catch {
    throw new Error("Browser authentication fixture could not be authenticated");
  }
}

export async function listBrowserAuthenticationFixtures(input: {
  projectId: string;
  targetId?: string;
}): Promise<BrowserAuthenticationFixture[]> {
  const fixtures = await readIndex(input.projectId);
  return fixtures.filter((fixture) => !input.targetId || fixture.targetId === input.targetId);
}

/** Sync listing for the job-batch admission backstop. Same index as the async list. */
export function listBrowserAuthenticationFixturesSync(input: {
  projectId: string;
  targetId?: string;
}): BrowserAuthenticationFixture[] {
  return readIndexSync(input.projectId).filter(
    (fixture) => !input.targetId || fixture.targetId === input.targetId,
  );
}

export async function saveBrowserAuthenticationFixture(input: {
  projectId: string;
  targetId: string;
  name: string;
  createdBy: string;
  storageState: unknown;
  expiresAt?: number;
  fixtureId?: string;
  now?: number;
}): Promise<BrowserAuthenticationFixture> {
  const projectId = boundedText(input.projectId, "project scope", 256);
  projectKey(projectId);
  const targetId = boundedText(input.targetId, "target identity", 96);
  const name = boundedText(input.name, "fixture name", 128);
  const createdBy = boundedText(input.createdBy, "reviewer identity", 256);
  const state = parseStorageState(input.storageState);
  const at = input.now ?? Date.now();
  if (
    input.expiresAt !== undefined &&
    (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= at)
  ) {
    throw new Error("Browser authentication fixture expiry must be in the future");
  }
  const id = input.fixtureId ?? randomUUID();
  if (!FIXTURE_ID.test(id)) throw new Error("Browser authentication fixture id is invalid");
  return withProjectUpdate(projectId, async () => {
    const fixtures = await readIndex(projectId);
    const prior = fixtures.filter((fixture) => fixture.id === id);
    if (prior.some((fixture) => fixture.targetId !== targetId)) {
      throw new Error("Browser authentication fixture belongs to another target");
    }
    const revision = Math.max(0, ...prior.map((fixture) => fixture.revision)) + 1;
    if (fixtures.length >= MAX_FIXTURES) {
      throw new Error("Browser authentication fixture limit reached");
    }
    const metadata: BrowserAuthenticationFixture = Object.freeze({
      schemaVersion: FIXTURE_SCHEMA_VERSION,
      id,
      reference: reference(id, revision),
      revision,
      projectId,
      targetId,
      name,
      origins: Object.freeze(
        state.origins
          .map((origin) => (origin as { origin?: unknown }).origin)
          .filter((origin): origin is string => typeof origin === "string")
          .slice(0, 128),
      ),
      cookieCount: state.cookies.length,
      createdAt: at,
      createdBy,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    });
    const secret: FixtureSecret = {
      schemaVersion: FIXTURE_SCHEMA_VERSION,
      id,
      revision,
      projectId,
      targetId,
      createdAt: at,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      storageState: state,
    };
    await atomicWrite(
      secretPath(projectId, id, revision),
      JSON.stringify(await encryptSecret(secret)),
      0o600,
    );
    await writeIndex(projectId, [...fixtures, metadata]);
    return metadata;
  });
}

export async function revokeBrowserAuthenticationFixture(input: {
  projectId: string;
  targetId: string;
  reference: string;
  revokedBy: string;
  now?: number;
}): Promise<BrowserAuthenticationFixture> {
  const projectId = boundedText(input.projectId, "project scope", 256);
  const targetId = boundedText(input.targetId, "target identity", 96);
  const revokedBy = boundedText(input.revokedBy, "reviewer identity", 256);
  const identity = parseReference(input.reference);
  return withProjectUpdate(projectId, async () => {
    const fixtures = await readIndex(projectId);
    const index = fixtures.findIndex(
      (fixture) => fixture.id === identity.id && fixture.revision === identity.revision,
    );
    const current = fixtures[index];
    if (!current || current.targetId !== targetId) {
      throw new Error("Browser authentication fixture was not found in this project and target");
    }
    if (current.revokedAt !== undefined) return current;
    const revoked: BrowserAuthenticationFixture = Object.freeze({
      ...current,
      revokedAt: input.now ?? Date.now(),
      revokedBy,
    });
    fixtures[index] = revoked;
    await writeIndex(projectId, fixtures);
    return revoked;
  });
}

export async function browserAuthenticationStorageState(input: {
  projectId: string;
  targetId: string;
  reference: string;
  now?: number;
}): Promise<BrowserStorageState> {
  const identity = parseReference(input.reference);
  const metadata = (await readIndex(input.projectId)).find(
    (fixture) => fixture.id === identity.id && fixture.revision === identity.revision,
  );
  if (!metadata || metadata.targetId !== input.targetId) {
    throw new Error("Browser authentication fixture was not found in this project and target");
  }
  if (metadata.revokedAt !== undefined)
    throw new Error("Browser authentication fixture is revoked");
  if (metadata.expiresAt !== undefined && metadata.expiresAt <= (input.now ?? Date.now())) {
    throw new Error("Browser authentication fixture is expired");
  }
  let encrypted: EncryptedFixture;
  try {
    encrypted = JSON.parse(
      await readFile(secretPath(input.projectId, identity.id, identity.revision), "utf8"),
    ) as EncryptedFixture;
  } catch {
    throw new Error("Browser authentication fixture ciphertext is unavailable");
  }
  return decryptSecret(encrypted, {
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    id: metadata.id,
    revision: metadata.revision,
    projectId: metadata.projectId,
    targetId: metadata.targetId,
    createdAt: metadata.createdAt,
    ...(metadata.expiresAt === undefined ? {} : { expiresAt: metadata.expiresAt }),
  });
}
