import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

async function updateFileHash(hash: ReturnType<typeof createHash>, path: string): Promise<void> {
  for await (const chunk of createReadStream(path)) hash.update(chunk);
}

function portableRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

/** Content-address one file or directory without trusting timestamps, inode
 * numbers, traversal order, or host path separators. Symlinks fail closed so
 * a frozen digest never depends on mutable bytes outside the artifact root. */
export async function artifactDigestForProof(path: string): Promise<`sha256:${string}`> {
  const root = resolve(path);
  const rootInfo = await lstat(root);
  const hash = createHash("sha256");
  if (rootInfo.isSymbolicLink()) throw new Error("Proof artifacts cannot be symbolic links");
  if (rootInfo.isFile()) {
    hash.update("file\0");
    await updateFileHash(hash, root);
    return `sha256:${hash.digest("hex")}`;
  }
  if (!rootInfo.isDirectory()) throw new Error("Proof artifacts must be files or directories");

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const child = resolve(directory, entry.name);
      const childInfo = await lstat(child);
      const name = portableRelativePath(root, child);
      if (childInfo.isSymbolicLink()) {
        throw new Error(`Proof artifact contains symbolic link: ${name}`);
      }
      if (childInfo.isDirectory()) {
        hash.update(`directory\0${name}\0`);
        await visit(child);
      } else if (childInfo.isFile()) {
        hash.update(`file\0${name}\0${childInfo.size}\0`);
        await updateFileHash(hash, child);
      } else {
        throw new Error(`Proof artifact contains unsupported entry: ${name}`);
      }
    }
  };
  hash.update("directory\0");
  await visit(root);
  return `sha256:${hash.digest("hex")}`;
}

/** Raw sha256 of a single artifact file, matching the digest accepted by the
 * build registration API. Directory bundles use the canonical proof digest
 * above because their source digest must cover the complete tree. */
export async function artifactSourceSha256(path: string): Promise<string> {
  const root = resolve(path);
  const rootInfo = await lstat(root);
  if (!rootInfo.isFile()) return (await artifactDigestForProof(root)).slice("sha256:".length);
  const hash = createHash("sha256");
  await updateFileHash(hash, root);
  return hash.digest("hex");
}
