import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { findWorkspaceRoot } from "../workspace/workspace-root.js";

const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u;

export type SecretVaultAadValue = string | number | null;
export type SecretVaultAad = Readonly<Record<string, SecretVaultAadValue>>;

export type EncryptedSecretPayload = Readonly<{
  schemaVersion: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}>;

export type SecretVaultOptions = Readonly<{
  workspaceRoot?: string;
  keyFileName: string;
  schemaVersion?: 1;
}>;

export function secretVaultWorkspaceRoot(explicit?: string): string {
  return explicit?.trim() || process.env.RELAY_WORKSPACE_ROOT?.trim() || findWorkspaceRoot();
}

/** Project ids never become path segments. The persisted scope directory is a
 * bounded digest, so even a malformed or hostile id cannot traverse the vault. */
export function secretVaultProjectKey(projectId: string): string {
  if (!SAFE_PROJECT_ID.test(projectId)) throw new Error("Secret vault project scope is invalid");
  return createHash("sha256").update(projectId, "utf8").digest("hex").slice(0, 24);
}

/** Atomic owner-only write used for both indexes and encrypted payloads. */
export async function atomicSecretWrite(
  path: string,
  content: string,
  mode = 0o600,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode, flag: "wx" });
  await rename(temporary, path);
  await chmod(path, mode);
}

function canonicalAad(aad: SecretVaultAad): Buffer {
  const entries = Object.entries(aad).sort(([left], [right]) => left.localeCompare(right));
  return Buffer.from(JSON.stringify(Object.fromEntries(entries)), "utf8");
}

function parseEncryptedPayload(value: unknown): EncryptedSecretPayload {
  const item = value as Partial<EncryptedSecretPayload> | undefined;
  if (
    !item ||
    item.schemaVersion !== 1 ||
    item.algorithm !== "aes-256-gcm" ||
    typeof item.iv !== "string" ||
    typeof item.tag !== "string" ||
    typeof item.ciphertext !== "string"
  ) {
    throw new Error("Encrypted secret payload is unsupported");
  }
  return Object.freeze({
    schemaVersion: 1,
    algorithm: "aes-256-gcm",
    iv: item.iv,
    tag: item.tag,
    ciphertext: item.ciphertext,
  });
}

/** Small AES-256-GCM vault primitive. Callers own their payload schema and
 * metadata binding; this module owns key creation, nonce generation,
 * authenticated encryption, and owner-only local files. */
export type SecretVault = Readonly<{
  encrypt(payload: unknown, aad: SecretVaultAad): Promise<EncryptedSecretPayload>;
  decrypt(encrypted: unknown, aad: SecretVaultAad): Promise<unknown>;
}>;

export function createSecretVault(options: SecretVaultOptions): SecretVault {
  const root = secretVaultWorkspaceRoot(options.workspaceRoot);
  const keyPath = join(root, ".relay", options.keyFileName);
  if (
    !options.keyFileName.startsWith(".") ||
    options.keyFileName.includes("/") ||
    options.keyFileName.includes("\\")
  ) {
    throw new Error("Secret vault key file name is invalid");
  }

  async function encryptionKey(): Promise<Buffer> {
    try {
      const value = Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64url");
      if (value.length !== 32) throw new Error("Secret vault key is invalid");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const key = randomBytes(32);
    await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
    try {
      await writeFile(keyPath, `${key.toString("base64url")}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      return key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64url");
      if (existing.length !== 32) throw new Error("Secret vault key is invalid");
      return existing;
    }
  }

  return Object.freeze({
    async encrypt(payload, aad) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", await encryptionKey(), iv);
      cipher.setAAD(canonicalAad(aad));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(payload), "utf8"),
        cipher.final(),
      ]);
      return Object.freeze({
        schemaVersion: 1,
        algorithm: "aes-256-gcm" as const,
        iv: iv.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
      });
    },

    async decrypt(encrypted, aad) {
      const payload = parseEncryptedPayload(encrypted);
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          await encryptionKey(),
          Buffer.from(payload.iv, "base64url"),
        );
        decipher.setAAD(canonicalAad(aad));
        decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(payload.ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8");
        return JSON.parse(plaintext) as unknown;
      } catch {
        throw new Error("Encrypted secret payload could not be authenticated");
      }
    },
  });
}
