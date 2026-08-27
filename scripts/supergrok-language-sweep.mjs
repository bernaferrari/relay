#!/usr/bin/env node
/**
 * SuperGrok language sweep — Grok navigation only. Capture is Relay:
 *   device locale → launch → (hamburger / settings / SuperGrok) →
 *   device survey --dir --no-restore
 *
 * Resume: skips a locale whose accessibility JSON already exists.
 * Force:  RELAY_CAPTURE_FORCE=1
 */
import { mkdir, writeFile, copyFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const serial = "RQCY104BG8X";
const packageName = "ai.x.grok";
const actor = "agent:grok-android-mapper";
const relayUrl = "http://127.0.0.1:8787";
const outputRoot = path.join(root, "runs/2026-08-26_grok-supergrok-supported-locales");
const screenshotsDir = path.join(outputRoot, "screenshots");
const accessibilityDir = path.join(outputRoot, "accessibility");
const framesDir = path.join(outputRoot, "frames");
const supportedLocales = [
  "en",
  "ar",
  "bg",
  "bn",
  "cs",
  "da",
  "de",
  "el",
  "es",
  "es-US",
  "fa",
  "fi",
  "fil",
  "fr",
  "fr-CA",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "lt",
  "mr",
  "ms",
  "nl",
  "no",
  "pl",
  "pt",
  "pt-BR",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "ta",
  "te",
  "th",
  "tr",
  "uk",
  "ur-IN",
  "vi",
  "zh-CN",
  "zh-TW",
];
const flagIndex = process.argv.indexOf("--locales");
const locales =
  (flagIndex >= 0 ? process.argv[flagIndex + 1] : process.env.RELAY_CAPTURE_LOCALES)
    ?.split(",")
    .map((locale) => locale.trim())
    .filter(Boolean) ?? supportedLocales;
const rtlLocales = new Set(["ar", "fa", "he", "ur-IN"]);
const force = process.env.RELAY_CAPTURE_FORCE === "1";
const cli = path.join(root, "node_modules/tsx/dist/cli.mjs");
const cliEntrypoint = path.join(root, "packages/cli/src/index.ts");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const filenameFor = (locale) => `supergrok-${locale.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`;

async function retry(label, operation, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(600 * attempt);
    }
  }
  throw new Error(
    `${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function relay(args) {
  const { stdout, stderr } = await execFile(
    process.execPath,
    [cli, cliEntrypoint, ...args, "--json", "--quiet", "--timeout", "240000"],
    {
      cwd: root,
      env: {
        ...process.env,
        RELAY_URL: relayUrl,
        RELAY_ACTOR_ID: actor,
        RELAY_TIMEOUT_MS: "240000",
      },
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const events = stdout.split(/\r?\n/u).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const event = [...events]
    .reverse()
    .find((candidate) => candidate.type === "result" || candidate.type === "error");
  if (!event?.ok)
    throw new Error(
      event?.error?.message || stderr.trim() || "Relay command did not return a result",
    );
  return event.result;
}

async function snapshot() {
  const response = await fetch(`${relayUrl}/snapshot?serial=${encodeURIComponent(serial)}`, {
    headers: {
      "x-relay-actor-id": actor,
      "x-relay-actor-kind": "agent",
      "x-relay-operation-id": "target.snapshot.capture",
      "x-relay-request-id": randomUUID(),
      "idempotency-key": `sg-nav-${randomUUID()}`,
      "x-relay-command-at": String(Date.now()),
    },
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok || !body || !Array.isArray(body.nodes)) {
    throw new Error(body?.error || `snapshot HTTP ${response.status}`);
  }
  return body;
}

function hamburgerPoint(tree, locale) {
  const buttons = (tree.nodes || []).filter(
    (node) =>
      node.bundleId === packageName &&
      node.type === "android.widget.Button" &&
      typeof node.rect?.y === "number" &&
      node.rect.y > 90 &&
      node.rect.y < 220 &&
      node.rect.height >= 100 &&
      node.rect.height <= 160,
  );
  if (!buttons.length) return rtlLocales.has(locale) ? { x: 985, y: 195 } : { x: 95, y: 195 };
  buttons.sort((left, right) => left.rect.x - right.rect.x);
  const target = rtlLocales.has(locale) ? buttons[buttons.length - 1] : buttons[0];
  return {
    x: Math.round(target.rect.x + target.rect.width / 2),
    y: Math.round(target.rect.y + target.rect.height / 2),
  };
}

const has = (tree, predicate) => (tree.nodes || []).some(predicate);
const tap = (input) =>
  retry("tap", () =>
    relay(["device", "interact", serial, "--actor", actor, "--input", JSON.stringify(input)]),
  );
const swipeUp = () =>
  tap({ kind: "swipe", from: { x: 540, y: 1900 }, to: { x: 540, y: 1000 }, durationMs: 280 });

async function captureLocale(locale) {
  const stem = filenameFor(locale);
  const treePath = path.join(accessibilityDir, `${stem}.json`);
  if (!force && existsSync(treePath)) return { locale, status: "skipped-existing" };

  await retry("locale", () =>
    relay(["device", "locale", serial, packageName, locale, "--actor", actor]),
  );
  await retry("launch", () =>
    relay([
      "device",
      "launch",
      serial,
      packageName,
      "--actor",
      actor,
      "--input",
      JSON.stringify({ relaunch: true }),
    ]),
  );
  await wait(2500);

  const home = await retry("home", snapshot);
  await tap({ kind: "point", ...hamburgerPoint(home, locale) });
  await wait(800);
  let drawer = await retry("drawer", snapshot);
  if (!has(drawer, (node) => node.identifier === "settings_button")) {
    await swipeUp();
    await wait(400);
    drawer = await retry("drawer after swipe", snapshot);
  }
  await tap({ kind: "identifier", identifier: "settings_button" });
  await wait(1000);
  let settings = await retry("settings", snapshot);
  if (!has(settings, (node) => node.label === "SuperGrok")) {
    await swipeUp();
    await wait(400);
  }
  await tap({ kind: "label", label: "SuperGrok" });
  await wait(1200);

  const localeFrames = path.join(framesDir, stem);
  const survey = await retry("survey", () =>
    relay([
      "device",
      "survey",
      serial,
      "--actor",
      actor,
      "--dir",
      localeFrames,
      "--max-scrolls",
      "4",
      "--no-restore",
      "--force",
    ]),
  );
  const fullPng = path.join(localeFrames, "full.png");
  const fullJson = path.join(localeFrames, "full.json");
  const heroPng = existsSync(fullPng) ? fullPng : path.join(localeFrames, "00.png");
  const heroJson = existsSync(fullJson) ? fullJson : path.join(localeFrames, "00.json");
  if (!existsSync(heroPng) || !existsSync(heroJson)) {
    throw new Error("survey --dir did not write frames or full.png / full.json");
  }
  const body = JSON.parse(await readFile(heroJson, "utf8"));
  const nodes = body.nodes ?? body.snapshot?.nodes ?? [];
  await copyFile(heroPng, path.join(screenshotsDir, `${stem}.png`));
  await writeFile(
    treePath,
    `${JSON.stringify({ locale, capturedAt: Date.now(), width: body.width, height: body.height, nodes }, null, 2)}\n`,
  );
  if (existsSync(fullPng)) {
    const fullDir = path.join(outputRoot, "full");
    await mkdir(fullDir, { recursive: true });
    await copyFile(fullPng, path.join(fullDir, `${stem}.png`));
    if (existsSync(fullJson)) await copyFile(fullJson, path.join(fullDir, `${stem}.json`));
  }
  return {
    locale,
    status: "captured",
    frames: survey.frameCount ?? survey.frames?.length,
    full: existsSync(fullPng),
  };
}

for (const dir of [outputRoot, screenshotsDir, accessibilityDir, framesDir]) {
  await mkdir(dir, { recursive: true });
}
const results = [];
const began = Date.now();
for (const locale of locales) {
  try {
    const result = await captureLocale(locale);
    results.push(result);
    console.log(
      `${result.status === "captured" ? "✓" : result.status === "skipped-existing" ? "→" : "△"} ${locale} ${result.status}${
        result.frames ? ` (${result.frames} frames)` : ""
      }`,
    );
  } catch (error) {
    results.push({ locale, status: "failed", error: String(error.message).slice(0, 300) });
    console.log(`✗ ${locale} ${String(error.message).slice(0, 160)}`);
  }
}
await writeFile(
  path.join(outputRoot, "sweep.json"),
  `${JSON.stringify({ began, finished: Date.now(), results }, null, 2)}\n`,
);
console.log(
  `\n${results.filter((result) => result.status === "captured").length}/${results.length} captured in ${Math.round((Date.now() - began) / 60000)}m → ${path.relative(root, outputRoot)}`,
);
