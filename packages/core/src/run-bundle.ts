import { createReadStream } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";

const MAGIC = Buffer.from("RELAYRUN\x01\n", "binary");
const LENGTH_BYTES = 8;
const HEADER_BYTES = MAGIC.byteLength + LENGTH_BYTES;
const SHA256 = /^[a-f0-9]{64}$/;
const DEFAULT_LIMITS = {
  maxFiles: 10_000,
  maxManifestBytes: 8 * 1024 * 1024,
  maxBundleBytes: 16 * 1024 * 1024 * 1024,
  maxEntryBytes: 8 * 1024 * 1024 * 1024,
} as const;
const MAX_METADATA_BYTES = 16 * 1024 * 1024;

export type RelayRunBundleEntry = {
  path: string;
  bytes: number;
  sha256: string;
  mediaType: string;
};

export type RelayRunBundleManifest = {
  schemaVersion: 1;
  format: "relayrun";
  digestAlgorithm: "sha256";
  run: {
    id: string;
    schemaVersion: number;
    inputDigest: string;
  };
  entries: RelayRunBundleEntry[];
};

export type RelayRunBundleLimits = {
  maxFiles?: number;
  maxManifestBytes?: number;
  maxBundleBytes?: number;
  maxEntryBytes?: number;
};

export type RelayRunBundleResult = {
  path: string;
  bytes: number;
  manifest: RelayRunBundleManifest;
  manifestSha256: string;
  bundleSha256: string;
};

export type RelayRunBundleVerification = Omit<RelayRunBundleResult, "path">;

export type RelayRunBundleErrorCode =
  | "INVALID_SOURCE"
  | "INCOMPLETE_RUN"
  | "UNSAFE_PATH"
  | "LIMIT_EXCEEDED"
  | "INVALID_BUNDLE"
  | "DIGEST_MISMATCH"
  | "OUTPUT_EXISTS";

export class RelayRunBundleError extends Error {
  constructor(
    readonly code: RelayRunBundleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RelayRunBundleError";
  }
}

type RequiredLimits = {
  maxFiles: number;
  maxManifestBytes: number;
  maxBundleBytes: number;
  maxEntryBytes: number;
};
type SourceEntry = RelayRunBundleEntry & { absolutePath: string };
type RunMetadata = RelayRunBundleManifest["run"];

/**
 * Export a finalized run directory as a deterministic, non-compressed `.relayrun` bundle.
 * The destination must not already exist or be located inside the source run directory.
 */
export async function exportRelayRunBundle(
  runDir: string,
  outputPath: string,
  requestedLimits: RelayRunBundleLimits = {},
): Promise<RelayRunBundleResult> {
  if (extname(outputPath).toLowerCase() !== ".relayrun") {
    throw new RelayRunBundleError("UNSAFE_PATH", "bundle output must use the .relayrun extension");
  }
  const limits = limitsOf(requestedLimits);
  const root = await finalizedRunRoot(runDir);
  const destination = await canonicalProspectivePath(outputPath);
  if (isWithin(root, destination)) {
    throw new RelayRunBundleError(
      "UNSAFE_PATH",
      "bundle output cannot be placed inside the source run directory",
    );
  }

  const run = await verifyFinalizedRun(root);
  const discovered = await discoverRunFiles(root, limits);
  const entries: SourceEntry[] = [];
  let artifactBytes = 0;
  for (const file of discovered) {
    const sha256 = await hashFile(file.absolutePath);
    entries.push({ ...file, sha256, mediaType: mediaTypeFor(file.path) });
    artifactBytes += file.bytes;
  }
  const manifest: RelayRunBundleManifest = {
    schemaVersion: 1,
    format: "relayrun",
    digestAlgorithm: "sha256",
    run,
    entries: entries.map(({ absolutePath: _absolutePath, ...entry }) => entry),
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  if (manifestBytes.byteLength > limits.maxManifestBytes) {
    throw limitError("manifest", manifestBytes.byteLength, limits.maxManifestBytes);
  }
  const totalBytes = HEADER_BYTES + manifestBytes.byteLength + artifactBytes;
  if (totalBytes > limits.maxBundleBytes) {
    throw limitError("bundle", totalBytes, limits.maxBundleBytes);
  }

  await mkdir(dirname(destination), { recursive: true });
  const temporary = resolve(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx");
  const bundleHash = createHash("sha256");
  const header = bundleHeader(manifestBytes.byteLength);
  let position = 0;
  try {
    try {
      position = await writeBuffer(handle, header, position);
      bundleHash.update(header);
      position = await writeBuffer(handle, manifestBytes, position);
      bundleHash.update(manifestBytes);
      for (const entry of entries) {
        const observedHash = createHash("sha256");
        let observedBytes = 0;
        for await (const value of createReadStream(entry.absolutePath)) {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          position = await writeBuffer(handle, chunk, position);
          observedHash.update(chunk);
          bundleHash.update(chunk);
          observedBytes += chunk.byteLength;
        }
        if (observedBytes !== entry.bytes || observedHash.digest("hex") !== entry.sha256) {
          throw new RelayRunBundleError(
            "DIGEST_MISMATCH",
            `source artifact changed during export: ${entry.path}`,
          );
        }
      }
      const finalFiles = await discoverRunFiles(root, limits);
      if (
        finalFiles.length !== discovered.length ||
        finalFiles.some(
          (file, index) =>
            file.path !== discovered[index]?.path || file.bytes !== discovered[index]?.bytes,
        )
      ) {
        throw new RelayRunBundleError("DIGEST_MISMATCH", "run contents changed during export");
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }

  try {
    await link(temporary, destination);
  } catch (error) {
    if (isNodeError(error, "EEXIST")) {
      throw new RelayRunBundleError(
        "OUTPUT_EXISTS",
        `bundle output already exists: ${destination}`,
      );
    }
    throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  await syncDirectory(dirname(destination));
  return {
    path: destination,
    bytes: totalBytes,
    manifest,
    manifestSha256: sha256(manifestBytes),
    bundleSha256: bundleHash.digest("hex"),
  };
}

/** Verify structure, bounds, canonical manifest bytes, every artifact digest, and run commit integrity. */
export async function verifyRelayRunBundle(
  bundlePath: string,
  requestedLimits: RelayRunBundleLimits = {},
): Promise<RelayRunBundleVerification> {
  const limits = limitsOf(requestedLimits);
  const info = await stat(bundlePath).catch(() => undefined);
  if (!info?.isFile()) {
    throw new RelayRunBundleError("INVALID_BUNDLE", "relayrun bundle is not a regular file");
  }
  if (info.size > limits.maxBundleBytes) {
    throw limitError("bundle", info.size, limits.maxBundleBytes);
  }
  if (info.size < HEADER_BYTES) {
    throw new RelayRunBundleError("INVALID_BUNDLE", "relayrun bundle header is truncated");
  }

  const handle = await open(bundlePath, "r");
  try {
    const header = await readExactly(handle, HEADER_BYTES, 0);
    if (!header.subarray(0, MAGIC.byteLength).equals(MAGIC)) {
      throw new RelayRunBundleError("INVALID_BUNDLE", "relayrun bundle magic is invalid");
    }
    const manifestLengthBig = header.readBigUInt64BE(MAGIC.byteLength);
    if (manifestLengthBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RelayRunBundleError("LIMIT_EXCEEDED", "relayrun manifest length is unsafe");
    }
    const manifestLength = Number(manifestLengthBig);
    if (manifestLength <= 0 || manifestLength > limits.maxManifestBytes) {
      throw limitError("manifest", manifestLength, limits.maxManifestBytes);
    }
    if (HEADER_BYTES + manifestLength > info.size) {
      throw new RelayRunBundleError("INVALID_BUNDLE", "relayrun manifest is truncated");
    }
    const manifestBytes = await readExactly(handle, manifestLength, HEADER_BYTES);
    const manifest = parseManifest(manifestBytes, limits);
    const expectedBytes =
      HEADER_BYTES + manifestLength + manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0);
    if (expectedBytes !== info.size) {
      throw new RelayRunBundleError(
        "INVALID_BUNDLE",
        `relayrun length mismatch: expected ${expectedBytes} bytes, found ${info.size}`,
      );
    }

    const bundleHash = createHash("sha256").update(header).update(manifestBytes);
    const metadata = new Map<string, Buffer>();
    let position = HEADER_BYTES + manifestLength;
    for (const entry of manifest.entries) {
      const artifactHash = createHash("sha256");
      const captureMetadata = entry.path === "run.json" || entry.path === ".complete";
      if (captureMetadata && entry.bytes > MAX_METADATA_BYTES) {
        throw limitError(entry.path, entry.bytes, MAX_METADATA_BYTES);
      }
      const chunks: Buffer[] = [];
      let remaining = entry.bytes;
      while (remaining > 0) {
        const size = Math.min(1024 * 1024, remaining);
        const chunk = await readExactly(handle, size, position);
        artifactHash.update(chunk);
        bundleHash.update(chunk);
        if (captureMetadata) chunks.push(chunk);
        position += chunk.byteLength;
        remaining -= chunk.byteLength;
      }
      if (artifactHash.digest("hex") !== entry.sha256) {
        throw new RelayRunBundleError(
          "DIGEST_MISMATCH",
          `relayrun artifact digest mismatch: ${entry.path}`,
        );
      }
      if (captureMetadata) metadata.set(entry.path, Buffer.concat(chunks));
    }
    verifyBundledRunMetadata(manifest.run, metadata);
    return {
      bytes: info.size,
      manifest,
      manifestSha256: sha256(manifestBytes),
      bundleSha256: bundleHash.digest("hex"),
    };
  } finally {
    await handle.close();
  }
}

async function finalizedRunRoot(runDir: string): Promise<string> {
  const root = await realpath(runDir).catch(() => undefined);
  if (!root) throw new RelayRunBundleError("INVALID_SOURCE", "run directory does not exist");
  const info = await lstat(root);
  if (!info.isDirectory()) {
    throw new RelayRunBundleError("INVALID_SOURCE", "run source must be a directory");
  }
  return root;
}

async function verifyFinalizedRun(root: string): Promise<RunMetadata> {
  let runBytes: Buffer;
  let markerBytes: Buffer;
  try {
    [runBytes, markerBytes] = await Promise.all([
      readFile(resolve(root, "run.json")),
      readFile(resolve(root, ".complete")),
    ]);
  } catch {
    throw new RelayRunBundleError(
      "INCOMPLETE_RUN",
      "run must contain committed run.json and .complete files",
    );
  }
  const run = parseRunMetadata(runBytes);
  const marker = jsonObject(markerBytes, ".complete");
  if (marker.digest !== sha256(runBytes) || (marker.id !== undefined && marker.id !== run.id)) {
    throw new RelayRunBundleError("INCOMPLETE_RUN", "run commit marker does not match run.json");
  }
  return run;
}

async function discoverRunFiles(root: string, limits: RequiredLimits): Promise<SourceEntry[]> {
  const files: SourceEntry[] = [];
  let totalBytes = 0;
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => compareText(left.name, right.name));
    for (const child of children) {
      const path = prefix ? `${prefix}/${child.name}` : child.name;
      assertSafeBundlePath(path);
      const absolutePath = resolve(directory, child.name);
      if (child.isSymbolicLink()) {
        throw new RelayRunBundleError("UNSAFE_PATH", `run contains a symbolic link: ${path}`);
      }
      if (child.isDirectory()) {
        await visit(absolutePath, path);
        continue;
      }
      if (!child.isFile()) {
        throw new RelayRunBundleError(
          "INVALID_SOURCE",
          `run contains an unsupported entry: ${path}`,
        );
      }
      const info = await lstat(absolutePath);
      if (!info.isFile()) {
        throw new RelayRunBundleError("INVALID_SOURCE", `run entry is not a regular file: ${path}`);
      }
      if (info.size > limits.maxEntryBytes) {
        throw limitError(path, info.size, limits.maxEntryBytes);
      }
      files.push({ path, absolutePath, bytes: info.size, sha256: "", mediaType: "" });
      totalBytes += info.size;
      if (files.length > limits.maxFiles) {
        throw limitError("file count", files.length, limits.maxFiles);
      }
      if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxBundleBytes) {
        throw limitError("run artifacts", totalBytes, limits.maxBundleBytes);
      }
    }
  };
  await visit(root, "");
  files.sort((left, right) => compareText(left.path, right.path));
  return files;
}

function parseManifest(bytes: Buffer, limits: RequiredLimits): RelayRunBundleManifest {
  const value = jsonObject(bytes, "relayrun manifest");
  if (
    value.schemaVersion !== 1 ||
    value.format !== "relayrun" ||
    value.digestAlgorithm !== "sha256"
  ) {
    throw new RelayRunBundleError(
      "INVALID_BUNDLE",
      "relayrun manifest version or format is invalid",
    );
  }
  const runValue = objectValue(value.run, "relayrun manifest run");
  const run = parseRunMetadataObject(runValue);
  if (!Array.isArray(value.entries) || value.entries.length > limits.maxFiles) {
    throw new RelayRunBundleError("LIMIT_EXCEEDED", "relayrun manifest has too many entries");
  }
  const entries = value.entries.map((raw, index): RelayRunBundleEntry => {
    const item = objectValue(raw, `relayrun entry ${index}`);
    const path = stringValue(item.path, `relayrun entry ${index} path`);
    assertSafeBundlePath(path);
    const bytes = boundedInteger(item.bytes, `relayrun entry ${path} bytes`, limits.maxEntryBytes);
    const digest = stringValue(item.sha256, `relayrun entry ${path} digest`);
    if (!SHA256.test(digest)) {
      throw new RelayRunBundleError("INVALID_BUNDLE", `relayrun entry digest is invalid: ${path}`);
    }
    const mediaType = stringValue(item.mediaType, `relayrun entry ${path} media type`);
    if (mediaType !== mediaTypeFor(path)) {
      throw new RelayRunBundleError(
        "INVALID_BUNDLE",
        `relayrun entry media type is invalid: ${path}`,
      );
    }
    return { path, bytes, sha256: digest, mediaType };
  });
  for (let index = 0; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index]!;
    if (previous && compareText(previous.path, current.path) >= 0) {
      throw new RelayRunBundleError(
        "INVALID_BUNDLE",
        "relayrun manifest entries must be unique and lexically sorted",
      );
    }
  }
  let artifactBytes = 0;
  for (const entry of entries) {
    artifactBytes += entry.bytes;
    if (!Number.isSafeInteger(artifactBytes) || artifactBytes > limits.maxBundleBytes) {
      throw limitError("manifest artifacts", artifactBytes, limits.maxBundleBytes);
    }
  }
  if (
    !entries.some((entry) => entry.path === "run.json") ||
    !entries.some((entry) => entry.path === ".complete")
  ) {
    throw new RelayRunBundleError(
      "INVALID_BUNDLE",
      "relayrun bundle is missing committed run metadata",
    );
  }
  const manifest: RelayRunBundleManifest = {
    schemaVersion: 1,
    format: "relayrun",
    digestAlgorithm: "sha256",
    run,
    entries,
  };
  if (!bytes.equals(Buffer.from(JSON.stringify(manifest)))) {
    throw new RelayRunBundleError("INVALID_BUNDLE", "relayrun manifest is not canonical");
  }
  return manifest;
}

function verifyBundledRunMetadata(run: RunMetadata, metadata: Map<string, Buffer>): void {
  const runBytes = metadata.get("run.json");
  const markerBytes = metadata.get(".complete");
  if (!runBytes || !markerBytes) {
    throw new RelayRunBundleError("INVALID_BUNDLE", "relayrun bundle is missing run metadata");
  }
  const bundledRun = parseRunMetadata(runBytes);
  const marker = jsonObject(markerBytes, ".complete");
  if (
    marker.digest !== sha256(runBytes) ||
    (marker.id !== undefined && marker.id !== bundledRun.id)
  ) {
    throw new RelayRunBundleError("DIGEST_MISMATCH", "bundled run commit marker is invalid");
  }
  if (
    bundledRun.id !== run.id ||
    bundledRun.schemaVersion !== run.schemaVersion ||
    bundledRun.inputDigest !== run.inputDigest
  ) {
    throw new RelayRunBundleError("DIGEST_MISMATCH", "bundle manifest does not match run.json");
  }
}

function parseRunMetadata(bytes: Buffer): RunMetadata {
  return parseRunMetadataObject(jsonObject(bytes, "run.json"));
}

function parseRunMetadataObject(value: Record<string, unknown>): RunMetadata {
  const id = stringValue(value.id, "run id");
  const schemaVersion = boundedInteger(value.schemaVersion, "run schema version", 1_000_000);
  const inputDigest = stringValue(value.inputDigest, "run input digest");
  if (!SHA256.test(inputDigest)) {
    throw new RelayRunBundleError("INVALID_BUNDLE", "run input digest is invalid");
  }
  return { id, schemaVersion, inputDigest };
}

function jsonObject(bytes: Buffer, label: string): Record<string, unknown> {
  try {
    return objectValue(JSON.parse(bytes.toString("utf8")), label);
  } catch (error) {
    if (error instanceof RelayRunBundleError) throw error;
    throw new RelayRunBundleError("INVALID_BUNDLE", `${label} is not valid JSON`);
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RelayRunBundleError("INVALID_BUNDLE", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > 512) {
    throw new RelayRunBundleError("INVALID_BUNDLE", `${label} must be a bounded string`);
  }
  return value;
}

function boundedInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new RelayRunBundleError("LIMIT_EXCEEDED", `${label} exceeds its safe bound`);
  }
  return value as number;
}

function assertSafeBundlePath(path: string): void {
  const hasControlCharacter = Array.from(path).some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 0x1f || code === 0x7f;
  });
  if (
    !path ||
    path.length > 1024 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    hasControlCharacter ||
    path.split("/").some((part) => !part || part === "." || part === ".." || part.length > 255)
  ) {
    throw new RelayRunBundleError("UNSAFE_PATH", `unsafe relayrun entry path: ${path}`);
  }
}

function mediaTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".json":
      return "application/json";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

function limitsOf(requested: RelayRunBundleLimits): RequiredLimits {
  const result = { ...DEFAULT_LIMITS, ...requested };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RelayRunBundleError("LIMIT_EXCEEDED", `${name} must be a positive safe integer`);
    }
  }
  return result;
}

function bundleHeader(manifestBytes: number): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header);
  header.writeBigUInt64BE(BigInt(manifestBytes), MAGIC.byteLength);
  return header;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const value of createReadStream(path)) hash.update(value);
  return hash.digest("hex");
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeBuffer(handle: FileHandle, value: Buffer, position: number): Promise<number> {
  let offset = 0;
  while (offset < value.byteLength) {
    const { bytesWritten } = await handle.write(
      value,
      offset,
      value.byteLength - offset,
      position + offset,
    );
    if (bytesWritten <= 0) throw new Error("failed to write relayrun bundle");
    offset += bytesWritten;
  }
  return position + value.byteLength;
}

async function readExactly(handle: FileHandle, bytes: number, position: number): Promise<Buffer> {
  const result = Buffer.alloc(bytes);
  let offset = 0;
  while (offset < bytes) {
    const { bytesRead } = await handle.read(result, offset, bytes - offset, position + offset);
    if (bytesRead <= 0) {
      throw new RelayRunBundleError("INVALID_BUNDLE", "relayrun bundle is truncated");
    }
    offset += bytesRead;
  }
  return result;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function canonicalProspectivePath(path: string): Promise<string> {
  let ancestor = resolve(path);
  const missing: string[] = [];
  while (true) {
    const canonical = await realpath(ancestor).catch(() => undefined);
    if (canonical) return resolve(canonical, ...missing.reverse());
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      throw new RelayRunBundleError("UNSAFE_PATH", "bundle output has no resolvable parent");
    }
    missing.push(basename(ancestor));
    ancestor = parent;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function limitError(label: string, actual: number, maximum: number): RelayRunBundleError {
  return new RelayRunBundleError(
    "LIMIT_EXCEEDED",
    `${label} exceeds relayrun limit (${actual} > ${maximum})`,
  );
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
