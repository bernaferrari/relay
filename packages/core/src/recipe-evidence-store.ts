/**
 * On-disk store for recorder screenshots linked from recipe step evidence.
 */
import { mkdir, readFile, writeFile, unlink, link } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ArtifactRefProjection } from "@relay/protocol";
import {
  artifactRefFromIntegrity,
  missingArtifactRef,
  opaqueArtifactLocation,
  projectArtifactRef,
  redactedArtifactRef,
} from "./artifact-ref.js";
import { visualEvidenceAllowed } from "./redaction.js";
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
  /** Available for new capture callers; legacy evidence intentionally leaves
   * this absent instead of inventing a capture timestamp. */
  capturedAt?: number;
}): Promise<{
  bytes: number;
  sha256: string;
  deduplicated: boolean;
  artifact: ArtifactRefProjection;
}> {
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
  return {
    bytes: data.byteLength,
    sha256,
    deduplicated,
    artifact: projectRecipeEvidenceImageArtifact({
      recipeId: input.recipeId,
      evidenceId: input.evidenceId,
      sha256,
      bytes: data.byteLength,
      ...(input.capturedAt !== undefined ? { capturedAt: input.capturedAt } : {}),
    }),
  };
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

/** Project an already-known recipe evidence record without treating its
 * recipe-relative file location as an authority. The SHA-256 identity is
 * shared with authoring and run adapters when their bytes match. */
export function projectRecipeEvidenceImageArtifact(input: {
  recipeId: string;
  evidenceId: string;
  sha256: string;
  bytes: number;
  capturedAt?: number;
}): ArtifactRefProjection {
  const recipeId = evidencePart(input.recipeId, "recipeId");
  const evidenceId = evidencePart(input.evidenceId, "evidenceId");
  return projectArtifactRef(
    artifactRefFromIntegrity({
      sha256: input.sha256,
      bytes: input.bytes,
      media: { kind: "image", mime: "image/png" },
      ...(input.capturedAt !== undefined ? { capturedAt: input.capturedAt } : {}),
      provenance: { source: "recipe-evidence", capture: "recorded" },
      retention: {
        scope: "recipe-content-addressed",
        recoverability: "content-addressed",
      },
      locations: [opaqueArtifactLocation("recipe-evidence", [recipeId, evidenceId])],
    }),
  );
}

/** Resolve older recipe evidence only when pixels are permitted. A missing
 * image and a policy-held image remain distinguishable without exposing a
 * path-shaped read handle to callers. */
export async function projectStoredRecipeEvidenceImageArtifact(input: {
  recipeId: string;
  evidenceId: string;
  capturedAt?: number;
}): Promise<ArtifactRefProjection> {
  const recipeId = evidencePart(input.recipeId, "recipeId");
  const evidenceId = evidencePart(input.evidenceId, "evidenceId");
  const media = { kind: "image" as const, mime: "image/png" };
  if (!visualEvidenceAllowed()) {
    return redactedArtifactRef({
      source: "recipe-evidence",
      media,
      ...(input.capturedAt !== undefined ? { capturedAt: input.capturedAt } : {}),
    });
  }
  const data = await readRecipeEvidenceImage(recipeId, evidenceId);
  if (!data) {
    return missingArtifactRef({
      source: "recipe-evidence",
      media,
      ...(input.capturedAt !== undefined ? { capturedAt: input.capturedAt } : {}),
    });
  }
  return projectArtifactRef(
    artifactRefFromIntegrity({
      sha256: createHash("sha256").update(data).digest("hex"),
      bytes: data.byteLength,
      media,
      ...(input.capturedAt !== undefined ? { capturedAt: input.capturedAt } : {}),
      provenance: { source: "recipe-evidence", capture: "recorded" },
      retention: {
        scope: "recipe-content-addressed",
        recoverability: "content-addressed",
      },
      locations: [opaqueArtifactLocation("recipe-evidence", [recipeId, evidenceId])],
    }),
  );
}
