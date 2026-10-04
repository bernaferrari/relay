import assert from "node:assert/strict";
import test from "node:test";
import { readAndroidVideoServer } from "./android-live-video-assets.js";
import { HttpError } from "./http.js";

const serverPath = new URL("file:///prepared-android/server.bin");

test("Android preview reads the pinned asset only when requested", async () => {
  const binary = Buffer.from([1, 2, 3]);
  let imports = 0;
  let reads = 0;
  const io = {
    importAssets: async () => {
      imports += 1;
      return { BIN: serverPath, VERSION: "2.5" };
    },
    readBinary: async (path: URL) => {
      assert.equal(path, serverPath);
      reads += 1;
      return binary;
    },
  };
  assert.equal(imports, 0);
  assert.equal(reads, 0);
  assert.deepEqual(await readAndroidVideoServer(io), { binary, version: "2.5" });
  assert.equal(imports, 1);
  assert.equal(reads, 1);
});

test("missing Android setup returns an actionable prerequisite diagnostic", async () => {
  const attempts = [
    async () => {
      throw new Error("Generated module is missing");
    },
    async () => ({}),
    async () => ({ BIN: serverPath, VERSION: "3.0" }),
    async () => ({ BIN: "server.bin", VERSION: "2.5" }),
    async () => ({ BIN: new URL("https://example.com/server.bin"), VERSION: "2.5" }),
  ];
  for (const importAssets of attempts) {
    let reads = 0;
    await assert.rejects(
      readAndroidVideoServer({
        importAssets,
        readBinary: async () => {
          reads += 1;
          return Buffer.from([1]);
        },
      }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === 503 &&
        /npm exec -- fetch-scrcpy-server 2\.5/.test(error.message),
    );
    assert.equal(reads, 0);
  }
});

test("an absent or empty Android binary returns the same setup diagnostic", async () => {
  for (const readBinary of [
    async () => {
      throw new Error("ENOENT");
    },
    async () => Buffer.alloc(0),
  ]) {
    await assert.rejects(
      readAndroidVideoServer({
        importAssets: async () => ({ BIN: serverPath, VERSION: "2.5" }),
        readBinary,
      }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === 503 &&
        /retry live preview/.test(error.message),
    );
  }
});
