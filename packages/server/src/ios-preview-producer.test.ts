import assert from "node:assert/strict";
import test from "node:test";
import {
  IOS_SAFE_PREVIEW_PRODUCER_ENV,
  defaultIosPreviewProducerPath,
  resolveSafeIosPreviewProducer,
  safeIosPreviewProducerArgs,
} from "./ios-preview-producer.js";

test("uses a reviewed local sidecar by default and never the go-ios binary", async () => {
  const path = await resolveSafeIosPreviewProducer({
    root: "/workspace/relay",
    accessible: async (candidate) => {
      assert.equal(candidate, "/workspace/relay/.relay/bin/relay-ios-preview");
    },
  });
  assert.equal(path, "/workspace/relay/.relay/bin/relay-ios-preview");
  assert.equal(defaultIosPreviewProducerPath("/workspace/relay"), path);
});

test("honors only an explicit reviewed producer override", async () => {
  const path = await resolveSafeIosPreviewProducer({
    env: { [IOS_SAFE_PREVIEW_PRODUCER_ENV]: "/opt/relay/ios-preview" },
    accessible: async (candidate) => {
      assert.equal(candidate, "/opt/relay/ios-preview");
    },
  });
  assert.equal(path, "/opt/relay/ios-preview");
  assert.deepEqual(safeIosPreviewProducerArgs("ipad-1", ["--tunnel-info-port", "28100"]), [
    "--udid",
    "ipad-1",
    "--tunnel-info-port",
    "28100",
  ]);
});

test("fails closed when the safe sidecar has not been built", async () => {
  await assert.rejects(
    () =>
      resolveSafeIosPreviewProducer({
        root: "/workspace/relay",
        accessible: async () => Promise.reject(new Error("missing")),
      }),
    /will not fall back to go-ios `screenshot --stream`/i,
  );
});
