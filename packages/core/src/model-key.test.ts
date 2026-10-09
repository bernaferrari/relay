import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadSavedModelKey, saveModelKey } from "./model-key.js";

test("a key saved in Settings is owner-only, applied now, and removable", async () => {
  const state = await mkdtemp(join(tmpdir(), "relay-model-key-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.RELAY_STATE_DIR = state;
  delete process.env.OPENROUTER_API_KEY;
  try {
    assert.equal(await loadSavedModelKey(), false);
    await assert.rejects(() => saveModelKey("not a key"), /does not look like/);
    const key = "sk-or-v1-0123456789abcdef0123456789";
    assert.deepEqual(await saveModelKey(key), { configured: true, source: "settings" });
    assert.equal(process.env.OPENROUTER_API_KEY, key);
    const path = join(state, "secrets", "openrouter.key");
    assert.equal((await readFile(path, "utf8")).trim(), key);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await saveModelKey(""), { configured: false, source: "none" });
    assert.equal(process.env.OPENROUTER_API_KEY, undefined);
    await assert.rejects(() => stat(path));
  } finally {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});
