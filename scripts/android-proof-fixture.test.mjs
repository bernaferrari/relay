import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";
import {
  androidProofFixtureArtifact,
  verifyTrackedAndroidProofFixture,
} from "./android-proof-fixture.mjs";

const execFileAsync = promisify(execFile);

test("tracked Android Proof fixture is source-bound and reproducible", async () => {
  const manifest = await verifyTrackedAndroidProofFixture();
  assert.equal(manifest.applicationId, "dev.relay.prooffixture");
  assert.equal(manifest.launchActivity, "dev.relay.prooffixture.MainActivity");
  assert.equal(manifest.reproducible, true);
  assert.match(manifest.sourceDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(manifest.artifactDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(androidProofFixtureArtifact, /relay-android-proof-fixture-1\.0\.apk$/u);
  assert.ok(
    manifest.sourceFiles.includes("app/src/main/java/dev/relay/prooffixture/MainActivity.java"),
  );
  assert.ok(
    manifest.sourceFiles.includes("app/src/main/java/dev/relay/prooffixture/LanguageActivity.java"),
  );
  assert.ok(
    manifest.sourceFiles.includes("app/src/main/java/dev/relay/prooffixture/ArabicActivity.java"),
  );
});

test("repaired fixture preserves the distinct seeded-regression source parent", async () => {
  const root = new URL("..", import.meta.url);
  const repairedXml = await readFile(
    new URL(
      "../fixtures/android-proof-app/app/src/main/res/layout/activity_arabic.xml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(repairedXml, /android:layout_marginTop="24dp"/u);
  assert.doesNotMatch(repairedXml, /regression_marker|overlaps description/u);

  const { stdout: seededCommit } = await execFileAsync(
    "git",
    ["log", "--format=%H", "--grep=^test(android): seed cross-platform language regression$", "-1"],
    { cwd: root },
  );
  const { stdout: repairedCommit } = await execFileAsync(
    "git",
    ["log", "--format=%H", "--grep=^fix(android): repair Arabic proof layout$", "-1"],
    { cwd: root },
  );
  assert.match(seededCommit.trim(), /^[a-f0-9]{40}$/u);
  assert.match(repairedCommit.trim(), /^[a-f0-9]{40}$/u);
  const { stdout: repairedParent } = await execFileAsync(
    "git",
    ["rev-parse", `${repairedCommit.trim()}^`],
    { cwd: root },
  );
  assert.equal(repairedParent.trim(), seededCommit.trim());
  const { stdout: seededXml } = await execFileAsync(
    "git",
    [
      "show",
      `${seededCommit.trim()}:fixtures/android-proof-app/app/src/main/res/layout/activity_arabic.xml`,
    ],
    { cwd: root },
  );
  assert.match(seededXml, /android:layout_marginTop="-22dp"/u);
  assert.match(
    seededXml,
    /Seeded layout regression: primary action overlaps description by 22 dp/u,
  );
});
