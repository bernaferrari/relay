import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, lstat, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import {
  managedFixtureInputSchemas,
  MAX_FIXTURE_BYTES,
  type ManagedFixture,
} from "@relay/protocol";
import { collaborationStateRoot } from "./collaboration/collaboration-store.js";

const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const REFERENCE = /^fixture:([a-f0-9]{64})\/([A-Za-z0-9][A-Za-z0-9._ -]{0,159})$/u;

async function projectDirectory(projectId: string): Promise<string> {
  if (!projectId.trim()) throw new Error("A project is required for test files");
  const root = join(collaborationStateRoot(), "fixtures");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const canonicalRoot = await realpath(root);
  const directory = join(canonicalRoot, digest(projectId));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await realpath(directory)) !== directory)
    throw new Error("Test file directory must not be a symbolic link");
  return directory;
}

async function containedFile(directory: string, hash: string, name: string): Promise<string> {
  const path = join(directory, hash, name);
  if ((await lstat(path)).isSymbolicLink())
    throw new Error("Test file must not be a symbolic link");
  if (!(await realpath(path)).startsWith(`${directory}${sep}`))
    throw new Error("Test file is outside its project");
  return path;
}

export async function importManagedFixture(
  projectId: string,
  input: unknown,
): Promise<ManagedFixture> {
  const { name, base64 } = managedFixtureInputSchemas["fixture.import"].parse(input);
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_FIXTURE_BYTES || bytes.toString("base64") !== base64) {
    throw new Error("Test file must be canonical base64 containing 1 byte to 25 MiB");
  }
  const hash = digest(bytes);
  const root = await projectDirectory(projectId);
  const directory = join(root, hash);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await realpath(directory)) !== directory)
    throw new Error("Test file directory must not be a symbolic link");
  const temporary = join(directory, `.import-${randomUUID()}`);
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await rename(temporary, join(directory, name));
  } finally {
    await rm(temporary, { force: true });
  }
  return { file: `fixture:${hash}/${name}`, name, size: bytes.length };
}

/** Resolve only in the executing project's store and verify immutable contents. */
export async function resolveManagedFixtureFile(file: string, projectId: string): Promise<string> {
  const match = REFERENCE.exec(file);
  if (!match) throw new Error("Invalid test file reference");
  const hash = match[1]!;
  const path = await containedFile(await projectDirectory(projectId), hash, match[2]!);
  const info = await lstat(path);
  if (!info.isFile() || info.size < 1 || info.size > MAX_FIXTURE_BYTES)
    throw new Error("Invalid test file size");
  if (digest(await readFile(path)) !== hash)
    throw new Error("Test file contents changed; import it again");
  return path;
}

export async function listManagedFixtures(projectId: string): Promise<ManagedFixture[]> {
  const root = await projectDirectory(projectId);
  const fixtures: ManagedFixture[] = [];
  for (const directory of await readdir(root, { withFileTypes: true })) {
    if (!directory.isDirectory() || !/^[a-f0-9]{64}$/u.test(directory.name)) continue;
    for (const entry of await readdir(join(root, directory.name), { withFileTypes: true })) {
      const file = `fixture:${directory.name}/${entry.name}`;
      if (!entry.isFile() || !REFERENCE.test(file)) continue;
      const path = await containedFile(root, directory.name, entry.name);
      const size = (await lstat(path)).size;
      if (size > 0 && size <= MAX_FIXTURE_BYTES) fixtures.push({ file, name: entry.name, size });
    }
  }
  return fixtures.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
}
