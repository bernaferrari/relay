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
  let openedCompactNavigation = false;
  if (!(await link.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    openedCompactNavigation = true;
  }
  await link.click();
  await waitForRoute(page, route);
  if (openedCompactNavigation) {
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: CHECK_TIMEOUT_MS });
  }
}

async function openRoute(page, route) {
  const target = new URL(page.url());
  target.hash = `#${route}`;
  await page.goto(target.toString(), {
    waitUntil: "domcontentloaded",
    timeout: CHECK_TIMEOUT_MS,
  });
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

async function assertDesktopChrome(page) {
  await page.waitForFunction(() => window.matchMedia("(min-width: 861px)").matches, null, {
    timeout: CHECK_TIMEOUT_MS,
  });
  const chrome = await page.evaluate(() => {
    const measure = (element) => {
      if (!(element instanceof Element)) return null;
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
        display: style.display,
        backgroundColor: style.backgroundColor,
        appRegion: style.getPropertyValue("-webkit-app-region"),
      };
    };
    const rect = (selector) => {
      for (const element of document.querySelectorAll(selector)) {
        const next = measure(element);
        if (next && next.display !== "none" && next.width > 0 && next.height > 0) return next;
      }
      return null;
    };
    return {
      sidebar: rect('[aria-label="Relay navigation"]'),
      toolbar: rect('header[aria-label="Window navigation"]'),
      back: rect('header[aria-label="Window navigation"] button[aria-label="Go back"]'),
      forward: rect('header[aria-label="Window navigation"] button[aria-label="Go forward"]'),
      backIcon: rect('header[aria-label="Window navigation"] button[aria-label="Go back"] svg'),
      forwardIcon: rect(
        'header[aria-label="Window navigation"] button[aria-label="Go forward"] svg',
      ),
      command: rect(
        'header[aria-label="Window navigation"] button[aria-label="Open command palette"]',
      ),
    };
  });
  for (const [name, value] of Object.entries(chrome)) {
    assert(value, `Electron desktop chrome is missing ${name}`);
  }
  assert(
    chrome.command.left >= 80,
    `Desktop command palette overlaps macOS traffic lights: ${chrome.command.left}`,
  );
  assert(chrome.toolbar.display !== "none", "Electron desktop toolbar is hidden at wide size");
  assert(
    chrome.toolbar.height >= 48 && chrome.toolbar.height <= 60,
    `Electron toolbar height drifted: ${chrome.toolbar.height}`,
  );
  assert(chrome.toolbar.appRegion === "drag", "Electron toolbar is not draggable");
  for (const control of [chrome.back, chrome.forward]) {
    assert(
      control.width <= 34 && control.height <= 34,
      `History control is oversized: ${JSON.stringify(control)}`,
    );
  }
  for (const icon of [chrome.backIcon, chrome.forwardIcon]) {
    assert(
      icon.width <= 17 && icon.height <= 17,
      `History icon is oversized: ${JSON.stringify(icon)}`,
    );
  }
  assert(chrome.command.width >= 220, `Command search is too narrow: ${chrome.command.width}`);
}

async function assertCompactChrome(page) {
  await page.waitForFunction(() => !window.matchMedia("(min-width: 861px)").matches, null, {
    timeout: CHECK_TIMEOUT_MS,
  });
  if (process.platform !== "darwin") return;
  const compact = await page.evaluate(() => {
    const header = [...document.querySelectorAll("header")]
      .find((element) => !element.getAttribute("aria-label"))
      ?.getBoundingClientRect();
    const menu = document
      .querySelector('button[aria-label="Open navigation"]')
      ?.getBoundingClientRect();
    return {
      header: header ? { height: header.height } : null,
      menu: menu ? { left: menu.left } : null,
    };
  });
  assert(compact.header && compact.menu, "Electron compact title bar is missing");
  assert(
    compact.header.height >= 56,
    `Electron compact title bar is too short: ${compact.header.height}`,
  );
  assert(
    compact.menu.left >= 80,
    `Compact menu overlaps macOS traffic lights: ${compact.menu.left}`,
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
        .map((node) => `${node.target.join(", ")} (${node.failureSummary ?? "no detail"})`)
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
  const profile = await mkdtemp(join(tmpdir(), "relay-product-electron-"));
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
    await nativeWindow.evaluate((window) => window.setSize(1200, 760));
    await waitForRoute(page, "/tests");
    await page.getByRole("heading", { level: 1, name: "Tests" }).waitFor();
    await assertLayout(page);
    await assertDesktopChrome(page);

    await nativeWindow.evaluate((window) => window.setSize(800, 560));
    await assertCompactChrome(page);

    const check = async () => {
      const route = appRoute(page.url());
      await assertAccessible(page, route);
      checks += 1;
    };
    await check();
    for (const [name, route] of [["Tests", "/tests"]]) {
      await clickNav(page, name, route);
      await check();
    }
    await clickNav(page, "Devices", "/devices");
    await check();
    await clickNav(page, "Runs", "/runs");
    await check();

    const reportLink = page.locator('a[href*="#/runs/"]').first();
    if (await reportLink.count()) {
      await reportLink.click();
      await page.waitForFunction(() => window.location.hash.startsWith("#/runs/"), null, {
        timeout: CHECK_TIMEOUT_MS,
      });
      await page.waitForFunction(
        () => {
          const title = document.querySelector("#main-content h1")?.textContent?.trim();
          return Boolean(title && title !== "Runs");
        },
        null,
        { timeout: CHECK_TIMEOUT_MS },
      );
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
