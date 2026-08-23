#!/usr/bin/env node
/**
 * Seed realistic immutable Test runs so Runs/replay surfaces have real
 * multi-step evidence to show (frames, traces, durations, a failure).
 *
 * Writes schema-v5 run directories under runs/ exactly like core/runs.ts
 * (run.json + log.txt + digest-matched .complete),
 * rendering phone-sized PNG frames with the system Chrome via playwright-core.
 *
 * Usage: node scripts/seed-demo-run.mjs [testId]
 * Requires the Relay API on http://localhost:8787 (pnpm dev:serve).
 */
import { createRequire } from "node:module";
import { mkdir, writeFile, rm, copyFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const API = process.env.RELAY_API ?? "http://localhost:8787";
const TEST_ID = process.argv[2] ?? "demo-sign-in";
const RUNS_ROOT = process.env.RELAY_RUNS_DIR ?? join(ROOT, "runs");

const coreRequire = createRequire(join(ROOT, "packages/core/package.json"));
const { chromium } = coreRequire("playwright-core");

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function folderFor(run) {
  const ts = new Date(run.startedAt ?? run.queuedAt)
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  return `${ts}_${slug(run.action)}_${slug(run.serial ?? "nodevice")}_${run.id.slice(0, 8)}`;
}

/* ── Mock app screens (phone-sized, neutral styling) ─────────────────── */

const SHELL = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; font-family: -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif; }
  html, body { width: 390px; height: 844px; background: #f6f7fb; overflow: hidden; }
  .statusbar { display: flex; justify-content: space-between; align-items: center;
    padding: 14px 28px 0; font-size: 15px; font-weight: 600; color: #0d0f14; }
  .statusbar .icons { display: flex; gap: 6px; align-items: center; }
  .bar { width: 18px; height: 10px; border-radius: 3px; background: #0d0f14; }
  .dot-row { display: flex; gap: 3px; }
  .sig { width: 3px; border-radius: 1px; background: #0d0f14; }
</style></head><body>
  <div class="statusbar"><span>9:41</span><span class="icons">
    <span class="dot-row"><span class="sig" style="height:4px"></span><span class="sig" style="height:6px"></span><span class="sig" style="height:8px"></span><span class="sig" style="height:10px"></span></span>
    <span class="bar"></span></span></div>
  ${body}
</body></html>`;

function welcomeScreen({ cta, tapped }) {
  return SHELL(`
  <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:720px;padding:0 36px;text-align:center">
    <div style="width:84px;height:84px;border-radius:24px;background:linear-gradient(135deg,#6f5bf3,#9b8cff);box-shadow:0 18px 40px rgb(111 91 243 / 30%)"></div>
    <h1 style="margin-top:28px;font-size:30px;letter-spacing:-0.02em;color:#0d0f14">Welcome to Lumen</h1>
    <p style="margin-top:10px;font-size:15px;line-height:1.5;color:#5b6070;max-width:26ch">Track your projects and stay in flow, wherever you are.</p>
    <div style="position:relative;margin-top:44px;width:100%">
      ${
        tapped
          ? `<div style="position:absolute;inset:-7px;border:3px solid rgb(111 91 243 / 55%);border-radius:22px"></div>`
          : ""
      }
      <div style="width:100%;padding:17px 0;border-radius:15px;background:#6f5bf3;color:#fff;font-size:17px;font-weight:600;box-shadow:0 10px 26px rgb(111 91 243 / 35%)">${cta}</div>
    </div>
    <div style="margin-top:16px;font-size:14px;color:#8a8fa3">Create an account</div>
  </div>`);
}

function homeScreen() {
  const row = (title, meta, tint) => `
    <div style="display:flex;align-items:center;gap:14px;background:#fff;border-radius:16px;padding:16px;box-shadow:0 2px 10px rgb(13 15 20 / 5%)">
      <div style="width:42px;height:42px;border-radius:12px;background:${tint}"></div>
      <div><div style="font-size:15px;font-weight:600;color:#0d0f14">${title}</div>
      <div style="margin-top:3px;font-size:12.5px;color:#8a8fa3">${meta}</div></div>
    </div>`;
  return SHELL(`
  <div style="padding:26px 22px 0">
    <div style="font-size:13px;font-weight:600;color:#6f5bf3;letter-spacing:0.06em;text-transform:uppercase">Home</div>
    <h1 style="margin-top:8px;font-size:28px;letter-spacing:-0.02em;color:#0d0f14">Welcome back, Bernardo</h1>
    <p style="margin-top:6px;font-size:14px;color:#5b6070">3 projects moved forward since yesterday.</p>
    <div style="display:grid;gap:12px;margin-top:24px">
      ${row("Q3 launch checklist", "8 of 12 tasks done", "#e8e4ff")}
      ${row("Design review", "2 comments waiting", "#ffe9dd")}
      ${row("Weekly report", "Draft saved 2h ago", "#ddf3e6")}
    </div>
  </div>`);
}

/* ── Run assembly ────────────────────────────────────────────────────── */

function frameRef(rel, caption, at, bytes) {
  return { path: rel, caption, capturedAt: at, bytes, mime: "image/png", width: 780, height: 1688 };
}

async function writeRun(payload, pngs) {
  const dir = join(RUNS_ROOT, folderFor(payload));
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, "frames"), { recursive: true });
  await mkdir(join(dir, "video"), { recursive: true });
  for (const [rel, buffer] of Object.entries(pngs)) {
    await writeFile(join(dir, rel), buffer);
  }
  const run = { ...payload, dir };
  const json = JSON.stringify(run, null, 2);
  await writeFile(join(dir, "run.json"), json, "utf8");
  await writeFile(join(dir, "log.txt"), run.logs.join("\n"), "utf8");
  await writeFile(
    join(dir, ".complete"),
    JSON.stringify({ schemaVersion: 1, id: run.id, digest: sha256(json) }),
    "utf8",
  );
  return dir;
}

function basePayload(recipe, { id, queuedAt, startedAt, finishedAt }) {
  const frozenInput = JSON.stringify({
    action: recipe.id,
    serial: "demo-iphone-16",
    recipe,
    variables: {},
  });
  return {
    schemaVersion: 5,
    id,
    action: recipe.id,
    title: recipe.title,
    serial: "demo-iphone-16",
    deviceName: "iPhone 16",
    platform: "ios",
    targetProfile: {
      id: "profile-demo-iphone-16",
      targetId: "demo-iphone-16",
      source: "device",
      platform: "ios",
      name: "iPhone 16",
      model: "iPhone 16",
      osVersion: "18.5",
      viewport: { width: 390, height: 844 },
      capabilities: [],
      observedAt: startedAt,
    },
    attempts: 1,
    queuedAt,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    resolvedInputs: {},
    recipeSnapshot: recipe,
    artifacts: [],
    inputDigest: sha256(frozenInput),
    writtenAt: finishedAt + 60,
  };
}

async function main() {
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`Relay API unreachable at ${API} — start it with: pnpm dev:serve`);
    process.exit(1);
  }
  // Compiled Recipe is private execution IR. A seeded run may retain its
  // immutable snapshot, but the script never reads or mutates a Recipe store.
  const recipe = {
    id: `app-map:demo:test:${TEST_ID}:root:r1`,
    title: "Sign in",
    source: "custom",
    steps: [
      { kind: "tap", target: { label: "Sign in" } },
      { kind: "expect", target: { text: "Welcome back" }, condition: "visible" },
    ],
    createdAt: 0,
    updatedAt: 0,
  };

  console.log(`Rendering frames with system Chrome…`);
  const browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() =>
    chromium.launch({
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
    }),
  );
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  async function shot(html) {
    await page.setContent(html, { waitUntil: "load" });
    return await page.screenshot({ type: "png" });
  }
  const pngTap = await shot(welcomeScreen({ cta: "Sign in", tapped: true }));
  const pngHome = await shot(homeScreen());
  const pngRenamed = await shot(welcomeScreen({ cta: "Get started" }));

  /* Record a real-time webm for the passed run's replay, matching its step
   * offsets: welcome ~2.1s, tapped state ~0.7s, home screen through 6.8s. The
   * run dir gets rm -rf'd by writeRun, so this records to a scratch dir first
   * and gets moved in after the dir (and its video/ subfolder) exist. */
  console.log("Recording replay video…");
  const videoScratchDir = join(tmpdir(), `relay-seed-video-${Date.now()}`);
  await mkdir(videoScratchDir, { recursive: true });
  let recordedVideoPath = null;
  try {
    const videoContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      recordVideo: { dir: videoScratchDir, size: { width: 390, height: 844 } },
    });
    const videoPage = await videoContext.newPage();
    await videoPage.setContent(welcomeScreen({ cta: "Sign in", tapped: false }), {
      waitUntil: "load",
    });
    await videoPage.waitForTimeout(2_100);
    await videoPage.setContent(welcomeScreen({ cta: "Sign in", tapped: true }), {
      waitUntil: "load",
    });
    await videoPage.waitForTimeout(700);
    await videoPage.setContent(homeScreen(), { waitUntil: "load" });
    await videoPage.waitForTimeout(4_000);
    const video = videoPage.video();
    await videoContext.close();
    recordedVideoPath = video ? await video.path() : null;
  } catch (error) {
    console.error("warn: could not record replay video —", error?.message ?? error);
  }

  await browser.close();

  const now = Date.now();

  /* Passed run — ~2 hours ago */
  {
    const startedAt = now - 2 * 60 * 60 * 1000;
    const finishedAt = startedAt + 6_800;
    const t = (ms) => startedAt + ms;
    const videoBytes = recordedVideoPath ? (await stat(recordedVideoPath)).size : 0;
    const payload = {
      ...basePayload(recipe, {
        id: "run-demo-signin-pass",
        queuedAt: startedAt - 900,
        startedAt,
        finishedAt: t(6_800),
      }),
      status: "ok",
      outcome: "passed",
      appVersion: "2.4.1 (843)",
      artifacts: recordedVideoPath
        ? [
            {
              kind: "video",
              capturedAt: finishedAt,
              data: {
                startedAt,
                stoppedAt: finishedAt,
                durationMs: 6_800,
                files: [{ path: "video/replay.webm", bytes: videoBytes }],
                result: null,
              },
            },
          ]
        : [],
      logs: [
        "Session started on iPhone 16 (iOS 18.5)",
        'Step 1 · Found "Sign in" by label · tapped at (195, 664)',
        "Step 1 · Screen settled after 420ms",
        'Step 2 · "Welcome back" visible after 1.1s',
        "Run passed · 2 steps · 6.8s",
      ],
      steps: [
        {
          id: "demo-pass-step-1",
          index: 0,
          kind: "Replay",
          tone: "pass",
          title: 'Tap "Sign in"',
          glyphs: ["tap"],
          actions: [
            { kind: "wait", at: t(600), label: "Wait for welcome screen" },
            { kind: "tap", at: t(2_100), label: 'Tap "Sign in"' },
            { kind: "shot", at: t(2_700), label: "Capture result" },
          ],
          startedAt: t(400),
          finishedAt: t(2_780),
          durationMs: 2_380,
          frames: [frameRef("frames/001.png", 'Tapped "Sign in"', t(2_700), pngTap.byteLength)],
          log: 'Found "Sign in" by label · tapped at (195, 664)',
          status: "ok",
        },
        {
          id: "demo-pass-step-2",
          index: 1,
          kind: "Verify",
          tone: "pass",
          title: 'Check "Welcome" is visible',
          glyphs: ["ok"],
          actions: [
            { kind: "wait", at: t(3_200), label: "Wait for home screen" },
            { kind: "ok", at: t(4_300), label: '"Welcome back" visible' },
            { kind: "shot", at: t(4_500), label: "Capture evidence" },
          ],
          startedAt: t(2_900),
          finishedAt: t(4_540),
          durationMs: 1_640,
          frames: [
            frameRef("frames/002.png", '"Welcome back" visible', t(4_500), pngHome.byteLength),
          ],
          log: '"Welcome back" visible after 1.1s',
          status: "ok",
        },
      ],
      frames: [
        frameRef("frames/001.png", 'Tapped "Sign in"', t(2_700), pngTap.byteLength),
        frameRef("frames/002.png", '"Welcome back" visible', t(4_500), pngHome.byteLength),
      ],
      frameCount: 2,
    };
    const dir = await writeRun(payload, { "frames/001.png": pngTap, "frames/002.png": pngHome });
    if (recordedVideoPath) {
      await copyFile(recordedVideoPath, join(dir, "video", "replay.webm"));
    }
    await rm(videoScratchDir, { recursive: true, force: true });
    console.log(`Seeded passed run → ${dir}`);
  }

  /* Product failure — ~26 hours ago (button renamed in that build) */
  {
    const startedAt = now - 26 * 60 * 60 * 1000;
    const t = (ms) => startedAt + ms;
    const payload = {
      ...basePayload(recipe, {
        id: "run-demo-signin-fail",
        queuedAt: startedAt - 1_100,
        startedAt,
        finishedAt: t(9_400),
      }),
      status: "error",
      outcome: "product-failure",
      failureCategory: "locator",
      error:
        'Could not find "Sign in" on the welcome screen. The closest visible control is "Get started".',
      appVersion: "2.4.0 (839)",
      logs: [
        "Session started on iPhone 16 (iOS 18.5)",
        'Step 1 · Searching for "Sign in" by label…',
        'Step 1 · No match · closest visible control: "Get started"',
        "Step 1 · Retried for 8s before stopping",
        "Run stopped at step 1 of 2 · product failure (locator)",
      ],
      steps: [
        {
          id: "demo-fail-step-1",
          index: 0,
          kind: "Replay",
          tone: "fail",
          title: 'Tap "Sign in"',
          glyphs: ["tap", "fail"],
          actions: [
            { kind: "wait", at: t(700), label: "Wait for welcome screen" },
            { kind: "tap", at: t(2_400), label: 'Look for "Sign in"' },
            { kind: "re", at: t(5_600), label: "Retry search" },
            { kind: "fail", at: t(8_900), label: "Not found" },
          ],
          startedAt: t(400),
          finishedAt: t(9_100),
          durationMs: 8_700,
          frames: [
            frameRef(
              "frames/001.png",
              'No "Sign in" on this screen',
              t(8_950),
              pngRenamed.byteLength,
            ),
          ],
          log: 'No element labeled "Sign in" · closest match "Get started"',
          status: "error",
        },
      ],
      frames: [
        frameRef("frames/001.png", 'No "Sign in" on this screen', t(8_950), pngRenamed.byteLength),
      ],
      frameCount: 1,
    };
    const dir = await writeRun(payload, { "frames/001.png": pngRenamed });
    console.log(`Seeded failed run → ${dir}`);
  }

  const rebuild = await fetch(`${API}/runs/catalog/rebuild`, { method: "POST" });
  console.log(`Catalog rebuilt:`, await rebuild.json());
}

await main();
