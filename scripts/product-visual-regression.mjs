#!/usr/bin/env node
/**
 * Deterministic browser visual fixtures for the Product renderer.
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
import { prepareReportVideoFixture } from "./product-visual-video-fixture.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const BASELINE_DIR = resolve(ROOT, "packages/app/visual-fixtures");
const FAILURE_DIR = resolve(ROOT, ".relay/visual-regression");
const PORT = Number(process.env.RELAY_VISUAL_APP_PORT ?? 4178);
const START_TIMEOUT_MS = 30_000;
const PIXEL_DELTA = 18;
const MAX_DIFFERENT_PIXEL_RATIO = 0.0005;
const zoomAcceptanceFixtures = new Set([
  "test-detail",
  "test-editor",
  "recording-review",
  "report-replay",
  "report-failed",
  "report-evidence",
  "device-detail",
  "settings-general",
  "settings-evidence",
  "settings-integrations",
  "settings-appearance",
  "settings-advanced",
  "settings-about",
]);

const fixtures = [
  { id: "home-empty", heading: "Tests" },
  { id: "home-populated", heading: "Tests" },
  { id: "apps-list", heading: "Apps" },
  { id: "app-overview", heading: "Checkout" },
  { id: "apps-error", heading: "Apps" },
  { id: "app-versions", heading: "Versions" },
  { id: "app-versions-error", heading: "Versions" },
  { id: "app-accounts", heading: "Accounts" },
  { id: "app-accounts-error", heading: "Accounts" },
  { id: "prerecord-ready", heading: "New test" },
  { id: "prerecord-connecting", heading: "New test" },
  { id: "prerecord-failure", heading: "New test" },
  {
    id: "recording-review",
    heading: "Review test",
    recordingReview: true,
  },
  { id: "recording-active", heading: "Record test" },
  { id: "test-detail", heading: "Complete checkout and confirm the order" },
  { id: "runs-large", heading: "Runs" },
  { id: "report-replay", heading: "Complete checkout" },
  { id: "report-failed", heading: "Complete checkout" },
  { id: "report-video", heading: "Complete checkout", video: true },
  { id: "report-evidence", heading: "Complete checkout", evidenceMedia: true },
  { id: "batch-completed", heading: "Checkout across saved accounts", batch: true },
  { id: "sessions-list", heading: "Activity" },
  { id: "session-detail", heading: "Complete checkout and confirm the order" },
  { id: "live-test-editor", heading: "Complete checkout and confirm the order" },
  { id: "suite-detail", heading: "Release smoke" },
  { id: "environments-list", heading: "Browsers" },
  { id: "environment-detail", heading: "Checkout staging" },
  { id: "agent-debug", heading: "Investigate" },
  { id: "devices", heading: "Devices" },
  { id: "tests-library", heading: "Tests" },
  { id: "test-editor", heading: "Complete checkout and confirm the order" },
  { id: "map-overview", heading: "App map" },
  { id: "device-detail", heading: "Pixel 9 Pro XL" },
  { id: "changes-list", heading: "Change verification" },
  { id: "change-detail", heading: "Keep Arabic settings readable" },
  { id: "run-across", heading: "Run across" },
  { id: "settings-general", heading: "General" },
  { id: "settings-evidence", heading: "Privacy" },
  { id: "settings-integrations", heading: "Integrations" },
  { id: "settings-appearance", heading: "Appearance" },
  { id: "settings-advanced", heading: "Advanced" },
  { id: "settings-about", heading: "About" },
  { id: "not-found", heading: "This page is not available" },
  { id: "route-error", heading: "This page couldn’t load" },
];
const viewports = [
  { id: "compact", width: 800, height: 560 },
  { id: "desktop", width: 1243, height: 838 },
  { id: "dark", width: 1243, height: 838, colorScheme: "dark" },
];

function parseArgs(argv) {
  const options = { update: false, headed: false, filter: undefined };
  for (const arg of argv) {
    if (arg === "--update") options.update = true;
    else if (arg === "--headed") options.headed = true;
    else if (arg.startsWith("--fixture=")) options.filter = arg.slice(10);
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
      "@relay/app",
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
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes
          .slice(0, 3)
          .map((node) => `${node.target.join(", ")} (${node.html})`)
          .join("; ")}`,
    )
    .join("\n- ");
  throw new Error(`${fixture.id}/${viewport.id} failed accessibility:\n- ${details}`);
}

async function assertZoomedKeyboardReachability(page, fixture, viewport) {
  if (!zoomAcceptanceFixtures.has(fixture.id)) return;
  const originalViewport = page.viewportSize();
  if (!originalViewport) throw new Error("Visual acceptance page has no viewport");
  await page.setViewportSize({
    width: Math.max(1, Math.floor(originalViewport.width / 2)),
    height: Math.max(1, Math.floor(originalViewport.height / 2)),
  });
  try {
    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      mainWidth: document.querySelector("#main-content")?.scrollWidth ?? 0,
      mainClientWidth: document.querySelector("#main-content")?.clientWidth ?? 0,
    }));
    if (
      dimensions.documentWidth > dimensions.viewportWidth + 1 ||
      dimensions.mainWidth > dimensions.mainClientWidth + 1
    ) {
      throw new Error(
        `${fixture.id}/${viewport.id} overflows at 200% zoom: ${JSON.stringify(dimensions)}`,
      );
    }
    const focusable = page.locator(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]):not([role="presentation"])',
    );
    if ((await focusable.count()) === 0) throw new Error(`${fixture.id} has no keyboard controls`);
    const tabCount = Math.min((await focusable.count()) + 2, 96);
    for (let index = 0; index < tabCount; index += 1) {
      await page.keyboard.press("Tab");
      const state = await page.evaluate(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return { visible: false, tag: "none" };
        const rect = active.getBoundingClientRect();
        let hidden = false;
        for (
          let current = active;
          current instanceof HTMLElement;
          current = current.parentElement
        ) {
          const style = getComputedStyle(current);
          if (
            current.hidden ||
            current.inert ||
            current.getAttribute("aria-hidden") === "true" ||
            style.display === "none" ||
            style.visibility === "hidden"
          ) {
            hidden = true;
            break;
          }
        }
        return {
          visible: rect.width > 0 && rect.height > 0 && !hidden,
          tag: active.tagName,
          role: active.getAttribute("role"),
          ariaHidden: active.getAttribute("aria-hidden"),
          html: active.outerHTML.slice(0, 240),
        };
      });
      if (
        !/^(?:presentation|tabpanel)$/u.test(state.role ?? "") &&
        (!state.visible || state.ariaHidden === "true")
      ) {
        throw new Error(
          `${fixture.id}/${viewport.id} reached an inaccessible control at 200% zoom (tab ${index + 1}, ${state.tag}, ${state.html ?? ""})`,
        );
      }
    }
    const critical = page.locator(
      'button:visible:not([disabled]):not([aria-disabled="true"]), a[href]:visible, input:visible:not([type="hidden"]):not([disabled]), select:visible:not([disabled]), textarea:visible:not([disabled])',
    );
    const criticalCount = await critical.count();
    for (let index = 0; index < criticalCount; index += 1) {
      const candidate = critical.nth(index);
      const label = (await candidate.innerText().catch(() => "")).trim();
      if (!/save|run|review|retry|continue|start|open report|check again/iu.test(label)) continue;
      await candidate.scrollIntoViewIfNeeded();
      await candidate.focus();
      const reachable = await candidate.evaluate((element) => {
        if (!(element instanceof HTMLElement) || document.activeElement !== element) return false;
        for (
          let current = element;
          current instanceof HTMLElement;
          current = current.parentElement
        ) {
          const style = getComputedStyle(current);
          if (
            current.hidden ||
            current.inert ||
            current.getAttribute("aria-hidden") === "true" ||
            style.display === "none" ||
            style.visibility === "hidden"
          )
            return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (!reachable)
        throw new Error(
          `${fixture.id}/${viewport.id} critical action is not keyboard reachable at 200% zoom`,
        );
    }
    // Some read-only fixtures intentionally have no Save/Run/Review action; the full tab pass
    // above still proves every interactive control can be reached at this layout size.
  } finally {
    await page.setViewportSize(originalViewport);
  }
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
    const rowGeometry = await renderedReports.evaluateAll((rows) =>
      rows.slice(0, 3).map((row) => {
        const rect = row.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      }),
    );
    for (let index = 1; index < rowGeometry.length; index++) {
      if (Math.abs(rowGeometry[index].top - rowGeometry[index - 1].bottom) > 2) {
        throw new Error(`Run history rows overlap or leave gaps: ${JSON.stringify(rowGeometry)}`);
      }
    }
    await renderedReports.first().focus();
    await page.keyboard.press("End");
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("data-run-index") === "239",
    );
    const lastHref = await page.locator('[data-run-index="239"]').getAttribute("href");
    const lastUrl = new URL(lastHref ?? "", page.url());
    if (
      lastUrl.pathname !== "/runs/run-240" ||
      !lastUrl.searchParams.get("returnTo")?.startsWith("/runs")
    ) {
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
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll("[data-run-index]")]
            .filter((row) => Number(row.getAttribute("data-run-index")) < 6)
            .every((row) => !row.querySelector('[title="Loading screenshot"]')),
        null,
        { timeout: 5_000 },
      )
      .catch(async () => {
        const pending = await page
          .locator('[data-run-index] [title="Loading screenshot"]')
          .evaluateAll((items) =>
            items.map((item) => item.closest("[data-run-index]")?.getAttribute("data-run-index")),
          );
        throw new Error(`Run thumbnail previews did not settle: ${pending.join(", ")}`);
      });
  }
  if (fixture.id === "batch-completed") {
    await page.locator('[title="Loading screenshot"]').first().waitFor({
      state: "detached",
      timeout: 5_000,
    });
  }
  if (fixture.video) {
    await prepareReportVideoFixture(page);
  }
  if (fixture.evidenceMedia) {
    const preview = page.locator('[data-slot="evidence-image-frame"] img').first();
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
    await page.getByRole("button", { name: "Run settings", exact: true }).click();
    const targetSelect = page.getByRole("combobox", { name: "Device or browser" });
    if ((await targetSelect.count()) !== 1)
      throw new Error("Test detail did not render target setup");
    await targetSelect.click();
    const targetItemCount = await page.locator('[data-slot="select-item"]').count();
    if (targetItemCount !== 2) {
      throw new Error(`Test detail did not render both targets (items ${targetItemCount})`);
    }
    await page.locator('[data-slot="select-item"]').first().click();
    if (await page.getByRole("button", { name: "Run now" }).isDisabled()) {
      throw new Error("Test detail did not enable Run now after target selection");
    }
    await page.getByRole("button", { name: "Run settings" }).click();
  }
  if (fixture.recordingReview) {
    const actions = page.locator('ol[aria-label="Recorded actions"] > li');
    if ((await actions.count()) !== 4) {
      throw new Error("Recording review did not render every editable action");
    }
    await page.getByRole("button", { name: "Edit steps" }).click();
    await page.getByRole("button", { name: "Save instruction" }).waitFor();
    if (await page.getByRole("button", { name: "Save instruction" }).isEnabled()) {
      throw new Error("Recording review enabled an unchanged instruction");
    }
    if ((await page.getByText(/Replay runs these steps .* before saving\./u).count()) !== 1) {
      throw new Error("Recording review did not explain its replay gate");
    }
  }
  if (!fixture.batch) return;
  const reportLinks = page.locator("#main-content a[href^='/runs/']");
  if ((await reportLinks.count()) < 1) {
    throw new Error("Batch fixture did not render a Report link");
  }
  if ((await page.getByText("1 product issue to review", { exact: true }).count()) !== 1) {
    throw new Error("Batch fixture did not render the current product-issue review summary");
  }
  if ((await page.getByRole("button", { name: "Next unresolved", exact: true }).count()) !== 1) {
    throw new Error("Batch fixture did not render the unresolved-case review control");
  }
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
  if (options.filter && !fixtures.some((fixture) => fixture.id.includes(options.filter)))
    throw new TypeError(`No visual fixtures match ${options.filter}`);
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
        colorScheme: viewport.colorScheme ?? "light",
        reducedMotion: "reduce",
      });
      await context.route("**/runs/*/thumbnail*", (route) =>
        route.fulfill({ status: 404, body: "" }),
      );
      const page = await context.newPage();
      await page.addInitScript(() => {
        if (
          !["runs-large", "batch-completed"].includes(
            new URLSearchParams(location.search).get("fixture"),
          )
        )
          return;
        window.IntersectionObserver = class {
          constructor(callback) {
            this.callback = callback;
          }
          observe(target) {
            this.callback([{ isIntersecting: true, target }], this);
          }
          disconnect() {}
          unobserve() {}
          takeRecords() {
            return [];
          }
        };
      });
      await page.addInitScript(() => {
        // Every fixture owns its starting state, including when run alone.
        // Navigation keeps the context, but previous recordings must not leak.
        localStorage.clear();
        sessionStorage.clear();
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
      for (const fixture of fixtures.filter(
        (item) => !options.filter || item.id.includes(options.filter),
      )) {
        await page.goto(`http://localhost:${PORT}/visual-fixtures.html?fixture=${fixture.id}`, {
          waitUntil: "domcontentloaded",
          timeout: START_TIMEOUT_MS,
        });
        await page.getByRole("heading", { level: 1, name: fixture.heading }).waitFor({
          timeout: 5_000,
        });
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
        const heading = page.getByRole("heading", { level: 1, name: fixture.heading });
        await heading.waitFor();
        await page.locator(".relay-route-pending").waitFor({ state: "hidden" });
        if (fixture.id === "home-empty") {
          await page
            .getByText("No tests yet")
            .waitFor({ state: "visible", timeout: START_TIMEOUT_MS });
        }
        const actual = await page.screenshot({ animations: "disabled", type: "png" });
        if (!(await heading.isVisible())) {
          throw new Error(
            `${fixture.id}/${viewport.id} reloaded during capture; retry after the source is stable`,
          );
        }
        await assertZoomedKeyboardReachability(page, fixture, viewport);
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
