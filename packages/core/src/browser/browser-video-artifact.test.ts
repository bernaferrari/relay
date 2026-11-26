import assert from "node:assert/strict";
import { access, copyFile, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { saveBrowserVideoArtifact } from "./browser-video-artifact.js";

test("a finalized browser copy releases only its owned source video", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-browser-video-copy-"));
  const source = join(root, "source.webm");
  const output = join(root, "run.webm");
  const older = join(root, "older.webm");
  await writeFile(source, "fixture-video");
  await writeFile(older, "historical-video");
  let deletions = 0;
  const video = {
    path: async () => source,
    saveAs: async (path: string) => copyFile(source, path),
    delete: async () => {
      deletions++;
      assert.equal(await readFile(output, "utf8"), "fixture-video");
      await unlink(source);
    },
  };
  try {
    await saveBrowserVideoArtifact(video as never, output);
    assert.equal(deletions, 1);
    await assert.rejects(access(source));
    assert.equal(await readFile(output, "utf8"), "fixture-video");
    assert.equal(await readFile(older, "utf8"), "historical-video");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed or empty copies preserve the source, as does choosing the source as output", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-browser-video-preserve-"));
  const source = join(root, "source.webm");
  const output = join(root, "run.webm");
  await writeFile(source, "fixture-video");
  let deletions = 0;
  const video = {
    path: async () => source,
    delete: async () => {
      deletions++;
    },
  };
  try {
    await assert.rejects(
      saveBrowserVideoArtifact(
        {
          ...video,
          saveAs: async () => {
            throw new Error("copy failed");
          },
        } as never,
        output,
      ),
      /copy failed/,
    );
    await assert.rejects(
      saveBrowserVideoArtifact(
        { ...video, saveAs: async (path: string) => writeFile(path, "") } as never,
        output,
      ),
      /copy is empty/,
    );
    await saveBrowserVideoArtifact({ ...video, saveAs: async () => undefined } as never, source);
    assert.equal(deletions, 0);
    assert.equal(await readFile(source, "utf8"), "fixture-video");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
