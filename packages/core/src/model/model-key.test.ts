import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadSavedModelKey, readSavedModelKey, saveModelKey, validModelKey } from "./model-key.js";

const key = "sk-test-0123456789abcdef0123456789";

async function withState<T>(run: (state: string) => Promise<T>): Promise<T> {
  const state = await mkdtemp(join(tmpdir(), "relay-model-key-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = state;
  try {
    return await run(state);
  } finally {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
  }
}

test("a provider key saved in Settings is owner-only, self-describing, and removable", async () => {
  await withState(async (state) => {
    assert.equal(await loadSavedModelKey(), false);
    await assert.rejects(() => saveModelKey("not a key"), /does not look like/);
    assert.deepEqual(await saveModelKey(key, { provider: "openai" }), {
      configured: true,
      source: "settings",
      provider: "openai",
    });
    const path = join(state, "secrets", "model-key.json");
    const stored = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    assert.equal(stored.version, 1);
    assert.equal(stored.provider, "openai");
    assert.equal(stored.key, key);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(readSavedModelKey(), { version: 1, provider: "openai", key });
    assert.deepEqual(await saveModelKey(""), { configured: false, source: "none" });
    await assert.rejects(() => stat(path));
  });
});

test("legacy bare OpenRouter keys load and migrate without copying into the environment", async () => {
  await withState(async (state) => {
    const legacyPath = join(state, "secrets", "openrouter.key");
    await mkdir(join(state, "secrets"), { recursive: true });
    await writeFile(legacyPath, `${key}\n`, { mode: 0o600 });
    const previous = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      assert.equal(await loadSavedModelKey(), true);
      assert.equal(process.env.OPENROUTER_API_KEY, undefined);
      assert.deepEqual(readSavedModelKey(), { version: 1, provider: "openrouter", key });
      const migrated = JSON.parse(
        await readFile(join(state, "secrets", "model-key.json"), "utf8"),
      ) as Record<string, unknown>;
      assert.equal(migrated.provider, "openrouter");
      await assert.rejects(() => stat(legacyPath));
    } finally {
      if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previous;
    }
  });
});

test("environment configuration is reported after removal without exposing the key", async () => {
  await withState(async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = key;
    try {
      const result = await saveModelKey("");
      assert.equal(result.configured, true);
      assert.equal(result.source, "environment");
      assert.equal(result.provider, "anthropic");
      assert.equal(JSON.stringify(result).includes(key), false);
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }
  });
});

test("key validation remains provider-neutral and permissive", () => {
  assert.equal(validModelKey("sk-ant-api03-_-.:0123456789"), true);
  assert.equal(validModelKey("short"), false);
  assert.equal(validModelKey("has whitespace 0123456789abcdef"), false);
});
