import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  artifactRefFromBytes,
  hasEquivalentArtifactContent,
  projectArtifactRef,
} from "./artifact-ref.js";
import {
  persistAuthoringEvidence,
  projectAuthoringEvidenceArtifact,
} from "./authoring-evidence.js";
import {
  projectRecipeEvidenceImageArtifact,
  saveRecipeEvidenceImage,
} from "./recipe-evidence-store.js";
import { projectRunFrameArtifact } from "./runs.js";

test("existing authoring, recipe, and run frames project to one integrity identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-artifact-ref-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousRecipes = process.env.RELAY_RECIPES_DIR;
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  const bytes = Buffer.from("the exact same visual evidence");
  try {
    const authoring = await persistAuthoringEvidence({
      kind: "screenshot",
      capturedAt: 11,
      data: bytes,
      mime: "image/png",
    });
    const authoringProjection = projectAuthoringEvidenceArtifact(authoring);
    assert.equal(authoringProjection.status, "available");
    assert.ok(authoringProjection.status === "available");

    const recipe = await saveRecipeEvidenceImage({
      recipeId: "recipe-a",
      evidenceId: "event-a",
      base64: bytes.toString("base64"),
      capturedAt: 12,
    });
    assert.equal(recipe.artifact.status, "available");
    assert.ok(recipe.artifact.status === "available");

    const runDir = join(root, "runs", "run-a");
    await mkdir(join(runDir, "frames"), { recursive: true });
    await writeFile(join(runDir, "frames", "001.png"), bytes);
    const run = await projectRunFrameArtifact({
      runId: "run-a",
      runDir,
      frame: { path: "frames/001.png", caption: "same", capturedAt: 13, mime: "image/png" },
    });
    assert.equal(run.status, "available");
    assert.ok(run.status === "available");

    assert.equal(authoringProjection.artifact.id, recipe.artifact.artifact.id);
    assert.equal(recipe.artifact.artifact.id, run.artifact.id);
    assert.ok(hasEquivalentArtifactContent(authoringProjection.artifact, recipe.artifact.artifact));
    assert.ok(hasEquivalentArtifactContent(recipe.artifact.artifact, run.artifact));
    assert.deepEqual(authoringProjection.artifact.integrity, {
      algorithm: "sha256",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
    });
    assert.equal(authoringProjection.artifact.retention.scope, "workspace-content-addressed");
    assert.equal(recipe.artifact.artifact.retention.scope, "recipe-content-addressed");
    assert.equal(run.artifact.retention.scope, "run-directory");
    assert.doesNotMatch(JSON.stringify(run.artifact), /frames\/001\.png|relay-artifact-ref/u);
  } finally {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousRecipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previousRecipes;
    await rm(root, { recursive: true, force: true });
  }
});

test("visual policy withholds a content address while nonvisual evidence remains useful", () => {
  const visual = artifactRefFromBytes({
    data: "pixels",
    media: { kind: "image", mime: "image/png" },
    provenance: { source: "external", capture: "imported" },
    retention: { scope: "external", recoverability: "external" },
  });
  const diagnostic = artifactRefFromBytes({
    data: '{"nodes":[]}',
    media: { kind: "structured-data", mime: "application/json" },
    provenance: { source: "external", capture: "imported" },
    retention: { scope: "external", recoverability: "external" },
  });

  const redacted = projectArtifactRef(visual, false);
  const retained = projectArtifactRef(diagnostic, false);

  assert.deepEqual(redacted, {
    status: "redacted",
    source: "external",
    media: { kind: "image", mime: "image/png" },
    reason: "visual-evidence-policy",
  });
  assert.equal(retained.status, "available");
  assert.ok(retained.status === "available");
  assert.equal(retained.artifact.integrity.bytes, Buffer.byteLength('{"nodes":[]}'));
});

test("recipe adapter does not need a filesystem path to project verified integrity", () => {
  const bytes = Buffer.from("recipe-only");
  const projection = projectRecipeEvidenceImageArtifact({
    recipeId: "recipe-a",
    evidenceId: "event-a",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
  });
  assert.equal(projection.status, "available");
  assert.ok(projection.status === "available");
  assert.equal(projection.artifact.locations[0]?.store, "recipe-evidence");
  assert.doesNotMatch(JSON.stringify(projection.artifact), /\.evidence|\.blobs|\.png/u);
});
