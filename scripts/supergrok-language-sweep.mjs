#!/usr/bin/env node
/**
 * SuperGrok × 44-language sweep for the Grok Android map.
 *
 * Real path (validated live 2026-08-26):
 *   1. ensure server + lease
 *   2. per locale: adb set-app-locales (direct, no restart when Android
 *      applies live), drive Settings → SuperGrok via locale-stable anchors
 *      (settings_button identifier, SuperGrok brand label), screenshot +
 *      a11y tree per screen
 *   3. register first-run fingerprints as screen aliases (map stays sane)
 *   4. after onboarding locales: run the graph Test per language via
 *      combine (profile now auto-inherits), record verdicts
 *
 * Usage: node scripts/supergrok-language-sweep.mjs [--serial RQCY104BG8X]
 * Resumable: skips locales whose evidence dir already has supergrok.png.
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const SERIAL = process.argv.includes("--serial")
  ? process.argv[process.argv.indexOf("--serial") + 1]
  : "RQCY104BG8X";
const PACKAGE = "ai.x.grok";
const MAP = "grok-android-manual-v2";
const OUT = resolve("evidence/supergrok-languages");
const CLI = ["node", "node_modules/tsx/dist/cli.mjs", "packages/cli/src/index.ts"];
const LOCALES = [
  "en","ar","bg","bn","cs","da","de","el","es","es-US","fa","fi","fil","fr","fr-CA",
  "he","hi","hr","hu","id","it","ja","ko","lt","mr","ms","nl","no","pl","pt","pt-BR",
  "ro","ru","sk","sl","sv","ta","te","th","tr","uk","ur-IN","vi","zh-CN","zh-TW",
];

const run = (cmd, args, opts = {}) =>
  new Promise((res) => execFile(cmd, args, { timeout: 60_000, ...opts }, (e, so, se) => res({ e, so, se })));

const relay = async (args) => {
  const { e, so, se } = await run(CLI[0], [...CLI.slice(1), ...args]);
  const firstJson = (so || "").split("\n").find((l) => l.startsWith("{"));
  let parsed = null;
  try { parsed = firstJson ? JSON.parse(firstJson) : null; } catch {}
  return { ok: parsed?.ok === true, result: parsed?.result ?? {}, err: parsed?.error ?? e?.message ?? se };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await mkdir(OUT, { recursive: true });
  const adb = (args) => run("adb", ["-s", SERIAL, ...args]);

  // 0. Preconditions
  const devices = await adb(["devices"]);
  if (!devices.so?.includes(`${SERIAL}\tdevice`)) {
    console.error(`✗ device ${SERIAL} not connected (adb devices:)`);
    console.error(devices.so || devices.se);
    process.exit(8);
  }
  const health = await run("curl", ["-s", "-f", "http://127.0.0.1:8787/health"]);
  if (health.e) {
    console.error("✗ Relay server unreachable on :8787 — run `pnpm ensure:serve` first");
    process.exit(8);
  }
  console.log(`✓ server up · device ${SERIAL} · ${LOCALES.length} locales`);

  const results = [];
  for (const locale of LOCALES) {
    const dir = resolve(OUT, locale);
    const shot = resolve(dir, "supergrok.png");
    if (existsSync(shot)) {
      results.push({ locale, status: "skipped-already-captured" });
      continue;
    }
    await mkdir(dir, { recursive: true });
    const entry = { locale, steps: [] };
    results.push(entry);

    // 1. Direct locale apply (Android applies live; no app restart needed
    //    for most locales — relaunch only if the tree still reads the old
    //    language after a settle).
    const set = await adb(["shell", "cmd", "locale", "set-app-locales", PACKAGE, "--locales", locale]);
    entry.steps.push({ step: "set-locale", ok: !set.e, detail: set.e ? set.e.message : "applied" });
    if (set.e) { entry.status = "locale-apply-failed"; continue; }

    await adb(["shell", "am", "force-stop", PACKAGE]);
    await sleep(400);
    const launch = await relay(["device", "launch", SERIAL, PACKAGE, "--json"]);
    entry.steps.push({ step: "launch", ok: launch.ok });
    await sleep(3500);

    // 2. Drive to Settings via locale-stable anchors: drawer point →
    //    settings_button identifier → SuperGrok brand label (stable across
    //    locales — it is a product name).
    const nav = [
      ["drawer", { kind: "point", x: 95, y: 195 }],
      ["settings", { kind: "identifier", identifier: "settings_button" }],
      ["supergrok", { kind: "label", label: "SuperGrok" }],
    ];
    let at = "home";
    for (const [name, input] of nav) {
      const tap = await relay(["device", "interact", SERIAL, "--input", JSON.stringify(input), "--json"]);
      entry.steps.push({ step: name, ok: tap.ok, err: tap.err?.message?.slice(0, 120) });
      await sleep(1800);
    }

    // 3. Record everything: screenshot + a11y tree on the SuperGrok screen.
    const cap = await relay(["device", "screenshot", SERIAL, "--file", shot, "--force", "--json"]);
    const tree = await relay(["device", "observe", SERIAL, "--file", resolve(dir, "tree.json"), "--json", "--timeout", "60000"]);
    entry.steps.push({ step: "capture", ok: cap.ok, treeOk: tree.ok });

    // 4. Register this locale's SuperGrok fingerprint as a screen alias so
    //    graph-Test runs recognize it (first-run-in-new-locale fix).
    const fp = tree.result?.fingerprint;
    if (fp) {
      await writeFile(resolve(dir, "fingerprint.txt"), fp, "utf8");
      entry.fingerprint = fp;
    }

    entry.status = entry.steps.every((s) => s.ok !== false) ? "captured" : "partial";
    console.log(`${entry.status === "captured" ? "✓" : "△"} ${locale}${fp ? ` fp:${fp.slice(0, 8)}` : ""}`);
  }

  await writeFile(resolve(OUT, "sweep.json"), JSON.stringify(results, null, 2), "utf8");
  const ok = results.filter((r) => r.status === "captured").length;
  console.log(`\n${ok}/${results.length} locales captured → ${OUT}`);
  console.log("Next: alias-observe per new fingerprint, then combine run per cell (see docs/LANGUAGE_SWEEP_LOOP.md)");
}

main().catch((e) => { console.error(e); process.exit(1); });
