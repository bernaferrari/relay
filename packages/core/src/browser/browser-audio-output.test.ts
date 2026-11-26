import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { recordHtmlMediaAudio } from "./browser-audio-output.js";
import { measureAudioOutput } from "../audio-output-level.js";

function wav(silent: boolean): Buffer {
  const samples = 16000;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    bytes.writeInt16LE(
      silent ? 0 : Math.round(Math.sin((i * 440 * 2 * Math.PI) / 16000) * 12000),
      44 + i * 2,
    );
  return bytes;
}

test("HTML media audio captures real decodable sound, distinguishes silence, and rejects icons/muted media", async (t) => {
  const executablePath =
    process.env.RELAY_TEST_CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  try {
    await access(executablePath);
  } catch {
    t.skip("Google Chrome is not installed");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "relay-audio-output-"));
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<button id="icon">Speaker</button><audio id="voice" loop src="data:audio/wav;base64,${wav(false).toString("base64")}"></audio>`,
    );
    await page.locator("#voice").evaluate(async (element) => {
      if (element instanceof HTMLMediaElement) await element.play();
    });
    const file = join(root, "recording.webm");
    await writeFile(file, await recordHtmlMediaAudio(page, { identifier: "voice" }, 1500));
    const loud = await measureAudioOutput(file);
    assert.ok(loud.rms > 0.1, JSON.stringify(loud));
    assert.ok(loud.durationMs >= 100, JSON.stringify(loud));
    await assert.rejects(
      recordHtmlMediaAudio(page, { identifier: "icon" }, 1500),
      /HTML audio\/video/,
    );
    await page.locator("#voice").evaluate((element) => {
      if (element instanceof HTMLMediaElement) element.muted = true;
    });
    await assert.rejects(recordHtmlMediaAudio(page, { identifier: "voice" }, 1500), /unmuted/);
    await page.setContent(
      `<audio id="silence" loop src="data:audio/wav;base64,${wav(true).toString("base64")}"></audio>`,
    );
    await page.locator("#silence").evaluate(async (element) => {
      if (element instanceof HTMLMediaElement) await element.play();
    });
    await writeFile(file, await recordHtmlMediaAudio(page, { identifier: "silence" }, 1500));
    const silent = await measureAudioOutput(file);
    assert.ok(silent.rms < 0.001, JSON.stringify(silent));
    await assert.rejects(
      recordHtmlMediaAudio(page, { identifier: "missing" }, 1500),
      /exactly one|did not match/,
    );
  } finally {
    await browser.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("audio output requires both frozen and current consent and rejects redacted collection", async () => {
  const { assertAudioOutputConsent } = await import("./browser-audio-output.js");
  const allowed = {
    schemaVersion: 1 as const,
    sensitive: { audio: { grantedAt: 1, grantedBy: "tester", reason: "Voice QA" } },
    redaction: { enabled: false, locked: false, source: "workspace" as const },
  };
  assert.doesNotThrow(() => assertAudioOutputConsent(allowed, allowed));
  assert.throws(() => assertAudioOutputConsent({ ...allowed, sensitive: {} }, allowed), /consent/);
  assert.throws(() => assertAudioOutputConsent(allowed, { ...allowed, sensitive: {} }), /consent/);
  assert.throws(
    () =>
      assertAudioOutputConsent(allowed, {
        ...allowed,
        redaction: { ...allowed.redaction, enabled: true },
      }),
    /redaction/,
  );
});

test("audio-record validates duration and remains browser-only", async () => {
  const { validateRecipeSteps } = await import("../recipe/recipe-validation.js");
  const { recipeStepPlatformBlocker } = await import("@relay/protocol");
  const step = {
    kind: "audio-record" as const,
    target: { identifier: "voice" },
    file: "voice.webm",
    durationMs: 1500,
  };
  assert.equal(validateRecipeSteps([step])[0]?.kind, "audio-record");
  assert.throws(() => validateRecipeSteps([{ ...step, durationMs: 30_001 }]), /durationMs/);
  assert.throws(() => validateRecipeSteps([{ ...step, target: undefined }]), /target/);
  assert.match(recipeStepPlatformBlocker(step, "ios") ?? "", /unsupported/);
  assert.equal(recipeStepPlatformBlocker(step, "browser"), undefined);
});
