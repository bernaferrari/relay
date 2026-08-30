import assert from "node:assert/strict";
import test from "node:test";
import {
  androidProofFixtureArtifact,
  verifyTrackedAndroidProofFixture,
} from "./android-proof-fixture.mjs";

test("tracked Android Proof fixture is source-bound and reproducible", async () => {
  const manifest = await verifyTrackedAndroidProofFixture();
  assert.equal(manifest.applicationId, "dev.relay.prooffixture");
  assert.equal(manifest.launchActivity, "dev.relay.prooffixture.MainActivity");
  assert.equal(manifest.reproducible, true);
  assert.match(manifest.sourceDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(manifest.artifactDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(androidProofFixtureArtifact, /relay-android-proof-fixture-1\.0\.apk$/u);
});
