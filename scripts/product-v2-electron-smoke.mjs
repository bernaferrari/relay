#!/usr/bin/env node
/** Bounded route, accessibility, and persistence smoke for the built Electron product shell. */
import AxeBuilder from "@axe-core/playwright";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(import.meta.dirname, "..");
const MAIN = resolve(ROOT, "packages/desktop/out/main/index.js");
const API = process.env.RELAY_API ?? "http://127.0.0.1:8787";
const CHECK_TIMEOUT_MS = 12_000;

function coreRequire() {
  return createRequire(resolve(ROOT, "packages/core/package.json"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function appRoute(url) {
  const parsed = new URL(url);
  const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : "";
  return (hash || parsed.pathname || "/").split("?")[0] || "/";
}

async function assertRelayHealthy() {
  let response;
  try {
    response = await fetch(`${API.replace(/\/$/u, "")}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new Error(
      `Relay service is not healthy at ${API}. Start it with 'pnpm ensure:serve' (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const health = await response.json();
  assert(
    response.ok && health.ok === true && health.product === "relay",
    "Unexpected Relay health",
  );
}

async function waitForRoute(page, expected) {
  await page.waitForFunction(
    (route) => {
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      return (hash || window.location.pathname || "/").split("?")[0] === route;
    },
    expected,
    { timeout: CHECK_TIMEOUT_MS },
  );
  await page.locator("#main-content").waitFor({ state: "attached", timeout: CHECK_TIMEOUT_MS });
}

async function clickNav(page, name, route) {
  const link = page.getByRole("link", { name, exact: true }).first();
  if (!(await link.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  }
  await link.click();
  await waitForRoute(page, route);
}

async function assertLayout(page) {
  const layout = await page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assert(
    layout.viewport.width >= 800,
    `Electron viewport is narrower than 800px: ${layout.viewport.width}`,
  );
  assert(
    layout.documentWidth <= layout.viewport.width + 1 &&
      layout.bodyWidth <= layout.viewport.width + 1,
    `Electron has horizontal overflow: ${JSON.stringify(layout)}`,
  );
}

async function assertAccessible(page, route) {
  const result = await new AxeBuilder({ page })
    // Electron's Playwright context cannot create axe's auxiliary blank page.
    // Relay has no cross-origin frames, so the same-origin runner covers the
    // complete renderer without weakening the selected WCAG rule set.
    .setLegacyMode(true)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  if (!result.violations.length) return;
  const detail = result.violations
    .map((violation) => {
      const targets = violation.nodes
        .flatMap((node) => node.target)
        .slice(0, 3)
        .join(", ");
      return `${violation.id} (${violation.impact ?? "unknown"}): ${targets}`;
    })
    .join("\n- ");
  throw new Error(`Accessibility violations on Electron ${route}:\n- ${detail}`);
}

async function run() {
  if (!existsSync(MAIN)) {
    throw new Error("The Electron product is not built. Run 'pnpm --filter @relay/desktop build'.");
  }
  await assertRelayHealthy();
  const profile = await mkdtemp(join(tmpdir(), "relay-product-v2-electron-"));
  const { _electron: electron } = coreRequire()("playwright-core");
  const failures = [];
  let application;
  let checks = 0;
  let reportChecked = false;

  try {
    application = await electron.launch({
      args: [MAIN, `--user-data-dir=${profile}`],
      env: {
        ...process.env,
        RELAY_URL: API,
        RELAY_ELECTRON_SMOKE: "1",
      },
      timeout: 30_000,
    });
    const page = await application.firstWindow({ timeout: 30_000 });
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(`console.error: ${message.text()}`);
    });
    page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));

    const nativeWindow = await application.browserWindow(page);
    await nativeWindow.evaluate((window) => window.setSize(800, 560));
    await waitForRoute(page, "/home");
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    await assertLayout(page);

    const check = async () => {
      const route = appRoute(page.url());
      await assertAccessible(page, route);
      checks += 1;
    };
    await check();
    for (const [name, route] of [
      ["Tests", "/tests"],
      ["Devices", "/devices"],
      ["Changes", "/changes"],
      ["Runs", "/runs"],
    ]) {
      await clickNav(page, name, route);
      await check();
    }

    const reportLink = page.locator('a[href*="#/runs/"]').first();
    if (await reportLink.count()) {
      await reportLink.click();
      await page.waitForFunction(() => window.location.hash.startsWith("#/runs/"), null, {
        timeout: CHECK_TIMEOUT_MS,
      });
      await check();
      reportChecked = true;
    }
    const previousRoute = appRoute(page.url());
    await clickNav(page, "Settings", "/settings/general");
    await check();

    await page.goBack();
    await waitForRoute(page, previousRoute);
    await page.goForward();
    await waitForRoute(page, "/settings/general");
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForRoute(page, "/settings/general");
    await assertLayout(page);
    await check();

    if (failures.length) {
      throw new Error(`Electron captured runtime errors:\n- ${failures.join("\n- ")}`);
    }
    return { route: appRoute(page.url()), checks, reportChecked, failures: 0 };
  } finally {
    await application?.close().catch(() => {});
    await rm(profile, { recursive: true, force: true });
  }
}

try {
  const result = await run();
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
}
