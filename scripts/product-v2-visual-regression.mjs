#!/usr/bin/env node
/**
 * Deterministic browser visual fixtures for the Product V2 renderer.
 *
 * The fixture entry mounts production route components with fixed, in-memory
 * product services. It never talks to the operator-owned Relay service.
 */
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(import.meta.dirname, "..");
const BASELINE_DIR = resolve(ROOT, "packages/app-v2/visual-fixtures");
const FAILURE_DIR = resolve(ROOT, ".relay/visual-regression");
const PORT = Number(process.env.RELAY_VISUAL_APP_PORT ?? 4178);
const START_TIMEOUT_MS = 30_000;
const PIXEL_DELTA = 18;
const MAX_DIFFERENT_PIXEL_RATIO = 0.0005;

const fixtures = [
  { id: "home-empty", heading: "Prove one journey that matters" },
  { id: "home-populated", heading: "Your workspace" },
  { id: "apps-list", heading: "Apps" },
  { id: "app-overview", heading: "Checkout" },
  { id: "apps-error", heading: "Apps" },
  { id: "app-versions", heading: "Versions" },
  { id: "app-versions-error", heading: "Versions" },
  { id: "app-accounts", heading: "Accounts" },
  { id: "app-accounts-error", heading: "Accounts" },
  { id: "prerecord-ready", heading: "Record a Test" },
  { id: "prerecord-connecting", heading: "Record a Test" },
  { id: "prerecord-failure", heading: "Record a Test" },
  { id: "recording-review", heading: "Review your recording", recordingReview: true },
  { id: "test-detail", heading: "Complete checkout and confirm the order" },
  { id: "runs-large", heading: "Run history" },
  { id: "report-failed", heading: "Complete checkout" },
  { id: "report-evidence", heading: "Complete checkout", evidenceMedia: true },
  { id: "batch-completed", heading: "Checkout across saved accounts", batch: true },
  { id: "sessions-list", heading: "Sessions" },
  { id: "session-detail", heading: "Complete checkout and confirm the order" },
  { id: "live-test-editor", heading: "Complete checkout and confirm the order" },
  { id: "suites-list", heading: "Suites" },
  { id: "suite-detail", heading: "Release smoke" },
  { id: "environments-list", heading: "Environments" },
  { id: "environment-detail", heading: "Checkout staging" },
  { id: "agent-debug", heading: "Investigate a bug" },
  { id: "devices", heading: "Devices" },
];
const viewports = [
  { id: "compact", width: 800, height: 560 },
  { id: "desktop", width: 1243, height: 838 },
];

function parseArgs(argv) {
  const options = { update: false, headed: false };
  for (const arg of argv) {
    if (arg === "--update") options.update = true;
    else if (arg === "--headed") options.headed = true;
    else throw new TypeError(`Unknown option: ${arg}`);
  }
  return options;
}

function coreRequire() {
  return createRequire(resolve(ROOT, "packages/core/package.json"));
}

async function waitForHttp(url) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
  }
  throw new Error(`Timed out waiting for ${url} (${lastError})`);
}

function startRenderer() {
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@relay/app-v2",
      "dev",
      "--",
      "--host",
      "localhost",
      "--port",
      String(PORT),
      "--strictPort",
    ],
    { cwd: ROOT, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout?.on("data", (chunk) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk) => (output += chunk.toString()));
  return {
    child,
    ready: waitForHttp(`http://localhost:${PORT}/visual-fixtures.html`).catch((error) => {
      throw new Error(`${error.message}\n${output.trim().slice(-1_500)}`);
    }),
  };
}

function stopRenderer(child) {
  if (child.killed || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function launchBrowser(chromium, headed) {
  try {
    return await chromium.launch({ channel: "chrome", headless: !headed });
  } catch (error) {
    const candidates = [
      process.env.CHROME_BIN,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ].filter((candidate) => candidate && existsSync(candidate));
    if (!candidates.length) throw error;
    return chromium.launch({ executablePath: candidates[0], headless: !headed });
  }
}

async function assertAccessible(page, fixture, viewport) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  if (!result.violations.length) return;
  const details = result.violations
    .map((violation) => `${violation.id}: ${violation.nodes[0]?.target.join(", ")}`)
    .join("\n- ");
  throw new Error(`${fixture.id}/${viewport.id} failed accessibility:\n- ${details}`);
}

async function assertLayout(page, fixture, viewport) {
  const dimensions = await page.evaluate(() => {
    const main = document.querySelector("#main-content");
    return {
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      mainWidth: main?.scrollWidth ?? 0,
      mainClientWidth: main?.clientWidth ?? 0,
    };
  });
  if (
    dimensions.documentWidth > viewport.width + 1 ||
    dimensions.bodyWidth > viewport.width + 1 ||
    dimensions.mainWidth > dimensions.mainClientWidth + 1
  ) {
    throw new Error(
      `${fixture.id}/${viewport.id} has horizontal overflow: ${JSON.stringify(dimensions)}`,
    );
  }
  if (fixture.id === "runs-large") {
    const renderedReports = page.locator("[data-run-index]");
    const renderedCount = await renderedReports.count();
    if (renderedCount < 1 || renderedCount >= 40) {
      throw new Error(
        `Run history rendered ${renderedCount} of 240 rows instead of a bounded window`,
      );
    }
    await renderedReports.first().focus();
    await page.keyboard.press("End");
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("data-run-index") === "239",
    );
    const lastHref = await page.locator('[data-run-index="239"]').getAttribute("href");
    if (lastHref !== "/runs/run-240") {
      throw new Error(`Windowed Run history lost the final Report URL (${lastHref ?? "missing"})`);
    }
    await page.keyboard.press("Home");
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("data-run-index") === "0",
    );
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const viewport = document.querySelector(
        ".relay-windowed-run-scroll [data-slot='scroll-area-viewport']",
      );
      if (viewport) viewport.scrollTop = 0;
      const main = document.querySelector("#main-content");
      if (main) main.scrollTop = 0;
    });
  }
  if (fixture.evidenceMedia) {
    const preview = page.locator(".relay-evidence-image-frame img").first();
    await preview.waitFor();
    const loaded = await preview.evaluate(
      (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
    );
    if (!loaded) throw new Error("Report evidence fixture did not load its direct image preview");
  }
  if (["apps-list", "app-versions", "app-accounts"].includes(fixture.id)) {
    const copy = await page.locator("#main-content").innerText();
    if (/isn't available here yet|placeholder/iu.test(copy)) {
      throw new Error(`${fixture.id}/${viewport.id} rendered placeholder copy`);
    }
  }
  if (fixture.id === "test-detail") {
    const radios = page.getByRole("radio");
    const titles = page.locator('[data-slot="run-target-title"]');
    if ((await radios.count()) !== 2) throw new Error("Test detail did not render both targets");
    if ((await titles.count()) !== 2) throw new Error("Test detail did not render both targets");
    const clipped = await titles.evaluateAll((nodes) =>
      nodes.some((node) => node.scrollWidth > node.clientWidth + 1),
    );
    if (clipped) throw new Error("Test detail truncated a target name");
    await radios.first().click();
    if (await page.getByRole("button", { name: "Run Test" }).isDisabled()) {
      throw new Error("Test detail did not enable Run Test after target selection");
    }
  }
  if (fixture.recordingReview) {
    const actions = page.locator(".relay-review-step");
    if ((await actions.count()) !== 4) {
      throw new Error("Recording review did not render every editable action");
    }
    if (await page.getByRole("button", { name: "Save instruction" }).isEnabled()) {
      throw new Error("Recording review enabled an unchanged instruction");
    }
    if ((await page.getByText("A passing replay is required before saving.").count()) !== 1) {
      throw new Error("Recording review did not explain its replay gate");
    }
  }
  if (!fixture.batch) return;
  const reportLinks = page.getByRole("link", { name: /Open Report/iu });
  if ((await reportLinks.count()) !== 6) throw new Error("Batch fixture did not render 6 Reports");
  const firstLink = await reportLinks.first().boundingBox();
  if (!firstLink || firstLink.height < 44) {
    throw new Error(`Batch Report link misses the 44px target floor (${firstLink?.height ?? 0}px)`);
  }
}

function comparePng(PNG, expectedBytes, actualBytes) {
  const expected = PNG.sync.read(expectedBytes);
  const actual = PNG.sync.read(actualBytes);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return { ratio: 1, differentPixels: expected.width * expected.height, dimensionsChanged: true };
  }
  let differentPixels = 0;
  for (let offset = 0; offset < expected.data.length; offset += 4) {
    const delta = Math.max(
      Math.abs(expected.data[offset] - actual.data[offset]),
      Math.abs(expected.data[offset + 1] - actual.data[offset + 1]),
      Math.abs(expected.data[offset + 2] - actual.data[offset + 2]),
      Math.abs(expected.data[offset + 3] - actual.data[offset + 3]),
    );
    if (delta > PIXEL_DELTA) differentPixels += 1;
  }
  return {
    ratio: differentPixels / (expected.width * expected.height),
    differentPixels,
    dimensionsChanged: false,
  };
}

async function run(options) {
  if (!Number.isInteger(PORT) || PORT < 1) throw new TypeError("Visual fixture port is invalid");
  const renderer = startRenderer();
  await renderer.ready;
  const { chromium } = coreRequire()("playwright-core");
  const { PNG } = coreRequire()("pngjs");
  const browser = await launchBrowser(chromium, options.headed);
  const results = [];
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        colorScheme: "light",
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        const fixedNow = 1_788_390_000_000;
        const NativeDate = Date;
        class FixedDate extends NativeDate {
          constructor(...args) {
            super(args.length ? args[0] : fixedNow);
          }
          static now() {
            return fixedNow;
          }
        }
        window.Date = FixedDate;
      });
      for (const fixture of fixtures) {
        await page.goto(`http://localhost:${PORT}/visual-fixtures.html?fixture=${fixture.id}`, {
          waitUntil: "domcontentloaded",
          timeout: START_TIMEOUT_MS,
        });
        await page.getByRole("heading", { level: 1, name: fixture.heading }).waitFor();
        if (fixture.id === "apps-error") {
          await page.getByRole("alert").waitFor({ timeout: START_TIMEOUT_MS });
        }
        await page.addStyleTag({
          content:
            "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
        });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((resolveFrame) =>
            requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
          );
        });
        await assertLayout(page, fixture, viewport);
        await page.evaluate(
          () =>
            new Promise((resolveFrame) =>
              requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
            ),
        );
        await assertAccessible(page, fixture, viewport);
        const actual = await page.screenshot({ animations: "disabled", type: "png" });
        const filename = `${fixture.id}-${viewport.id}.png`;
        const baselinePath = resolve(BASELINE_DIR, filename);
        if (options.update) {
          await mkdir(BASELINE_DIR, { recursive: true });
          await writeFile(baselinePath, actual);
          results.push({ fixture: fixture.id, viewport: viewport.id, status: "updated" });
          continue;
        }
        let expected;
        try {
          expected = await readFile(baselinePath);
        } catch {
          throw new Error(
            `Missing visual baseline ${baselinePath}. Run with --update to create it.`,
          );
        }
        const comparison = comparePng(PNG, expected, actual);
        if (comparison.ratio > MAX_DIFFERENT_PIXEL_RATIO) {
          await mkdir(FAILURE_DIR, { recursive: true });
          const failurePath = resolve(FAILURE_DIR, filename);
          await writeFile(failurePath, actual);
          throw new Error(
            `${fixture.id}/${viewport.id} changed ${comparison.differentPixels} pixels (${(
              comparison.ratio * 100
            ).toFixed(3)}%). Actual: ${failurePath}`,
          );
        }
        results.push({ fixture: fixture.id, viewport: viewport.id, status: "matched" });
      }
      await context.close();
    }
  } finally {
    await browser.close().catch(() => {});
    stopRenderer(renderer.child);
  }
  return results;
}

try {
  const results = await run(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ ok: true, fixtures: results })}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
}
