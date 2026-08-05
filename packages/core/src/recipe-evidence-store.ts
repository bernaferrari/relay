/**
 * On-disk store for recorder screenshots linked from recipe step evidence.
 */
import { mkdir, readFile, writeFile, unlink, link } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { findWorkspaceRoot } from "./workspace-root.js";

/** Directory for custom recipes — mirrors runsRoot()'s convention. */
function recipesRoot(): string {
  const env = process.env.RELAY_RECIPES_DIR?.trim();
  if (env) return env;
  return join(findWorkspaceRoot(), "recipes");
}

export function evidencePart(value: string, field: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`${field} contains invalid characters`);
  return value;
}

export function evidenceDir(recipeId: string): string {
  return join(recipesRoot(), ".evidence", evidencePart(recipeId, "recipeId"));
}

/** Persist a recorder screenshot outside recipe YAML so tests stay small and editable. */
export async function saveRecipeEvidenceImage(input: {
  recipeId: string;
  evidenceId: string;
  base64: string;
}): Promise<{ bytes: number; sha256: string; deduplicated: boolean }> {
  const dir = evidenceDir(input.recipeId);
  const id = evidencePart(input.evidenceId, "evidenceId");
  const data = Buffer.from(input.base64, "base64");
  if (data.byteLength === 0) throw new Error("evidence image is empty");
  if (data.byteLength > 8 * 1024 * 1024) throw new Error("evidence image exceeds 8 MB");
  await mkdir(dir, { recursive: true });
  // Evidence IDs are immutable event references, while bytes are shared by
  // content hash. Hard links preserve the existing `<evidenceId>.png` read
  // contract and turn duplicate recording frames into one physical blob.
  const sha256 = createHash("sha256").update(data).digest("hex");
  const blobs = join(dir, ".blobs");
  const blob = join(blobs, `${sha256}.png`);
  const target = join(dir, `${id}.png`);
  await mkdir(blobs, { recursive: true });
  let deduplicated = true;
  try {
    await writeFile(blob, data, { flag: "wx" });
    deduplicated = false;
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
  }
  try {
    await link(blob, target);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
    // Evidence IDs should be unique, but retrying a completed request must be
    // idempotent. Replace only this validated target, never the whole store.
    await unlink(target);
    await link(blob, target);
  }
  return { bytes: data.byteLength, sha256, deduplicated };
}

export async function readRecipeEvidenceImage(
  recipeId: string,
  evidenceId: string,
): Promise<Buffer | null> {
  try {
    return await readFile(
      join(evidenceDir(recipeId), `${evidencePart(evidenceId, "evidenceId")}.png`),
    );
  } catch {
    return null;
  }
}
