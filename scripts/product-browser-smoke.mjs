#!/usr/bin/env node
/**
 * Bounded browser quality smoke for the Product renderer.
 *
 * This script starts only the Vite renderer. The package command prepares the
 * repository-owned Relay service with this renderer's exact browser origins
 * before entering this bounded smoke. Playwright-core uses system Chrome.
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import AxeBuilder from "@axe-core/playwright";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_API = process.env.RELAY_API ?? "http://127.0.0.1:8787";
// 3000 is the renderer origin that `dev-app` registers with Relay's exact
// origin allow-list. An isolated CI run can override this before starting its
// server; arbitrary ports are deliberately not registered by this script.
const DEFAULT_APP_PORT = Number(process.env.RELAY_SMOKE_APP_PORT ?? 3000);
const START_TIMEOUT_MS = 30_000;
const CHECK_TIMEOUT_MS = 12_000;

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    appUrl: process.env.RELAY_APP_URL,
    apiUrl: DEFAULT_API,
    appPort: DEFAULT_APP_PORT,
    headed: false,
    keepApp: false,
  };
  while (args.length) {
    const arg = args.shift();
    if (arg === "--headed") options.headed = true;
    else if (arg === "--keep-app") options.keepApp = true;
    else if (arg === "--url") options.appUrl = args.shift();
    else if (arg === "--api") options.apiUrl = args.shift();
    else if (arg === "--port") options.appPort = Number(args.shift());
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.appUrl && (!Number.isInteger(options.appPort) || options.appPort < 1)) {
    throw new Error("--port must be a positive integer");
  }
  return options;
}

function coreRequire() {
  return createRequire(resolve(ROOT, "packages/core/package.json"));
}

function appRoute(url) {
  const parsed = new URL(url);
  const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : "";
  return (hash || parsed.pathname || "/").split("?")[0] || "/";
}

async function waitForHttp(url, timeoutMs = START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error(`Timed out waiting for ${url} (${lastError})`);
}

async function assertRelayHealthy(apiUrl) {
  let response;
  try {
    response = await waitForHttp(`${apiUrl.replace(/\/$/u, "")}/health`, 5_000);
  } catch (error) {
    throw new Error(
      `Relay service is not healthy at ${apiUrl}. Start it with 'pnpm ensure:serve' before the smoke (${error.message})`,
    );
  }
  const health = await response.json();
  if (health.ok !== true || health.product !== "relay") {
    throw new Error(`Unexpected Relay health response from ${apiUrl}`);
  }
}

function startRenderer({ apiUrl, appPort }) {
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
      String(appPort),
      "--strictPort",
    ],
    {
      cwd: ROOT,
      detached: true,
      env: { ...process.env, VITE_SERVER_URL: apiUrl },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });
  const url = `http://localhost:${appPort}`;
  const ready = waitForHttp(url).catch((error) => {
    const detail = output.trim().slice(-1_500);
    throw new Error(`${error.message}${detail ? `\n${detail}` : ""}`);
  });
  return { child, url, ready };
}

async function connectOrStartRenderer(options) {
  const url = options.appUrl ?? `http://localhost:${options.appPort}`;
  try {
    await waitForHttp(url, 1_000);
    return { child: undefined, url, ready: Promise.resolve() };
  } catch {
    const renderer = startRenderer(options);
    return { ...renderer, ready: renderer.ready };
  }
}

function stopRenderer(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function currentRoute(page) {
  return page.evaluate(() => {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    return (hash || window.location.pathname || "/").split("?")[0];
  });
}

async function clickNav(page, name, route) {
  process.stderr.write(`[browser-smoke] navigate ${name} -> ${route}\n`);
  if ((await currentRoute(page)) === route) {
    process.stderr.write(`[browser-smoke] already on ${route}\n`);
    return;
  }
  // 800px is the Product minimum shell and uses the compact navigation
  // drawer. Open it only when the desktop sidebar is not in the DOM.
  let openedCompactNavigation = false;
  if (!(await page.getByRole("link", { name, exact: true }).count())) {
    process.stderr.write(`[browser-smoke] opening compact navigation\n`);
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    openedCompactNavigation = true;
    process.stderr.write(`[browser-smoke] compact navigation open\n`);
  }
  process.stderr.write(`[browser-smoke] clicking ${name}\n`);
  await page.getByRole("link", { name, exact: true }).click();
  process.stderr.write(`[browser-smoke] clicked ${name}; url=${page.url()}; waiting for route\n`);
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
    timeout: START_TIMEOUT_MS,
  });
  await waitForRoute(page, route);
}

async function assertMinimumLayout(page) {
  const layout = await page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    document: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    },
    body: { width: document.body.scrollWidth, height: document.body.scrollHeight },
  }));
  assert(
    layout.viewport.width === 800 && layout.viewport.height === 560,
    "Smoke viewport is not 800x560",
  );
  assert(
    layout.document.width <= 801 && layout.body.width <= 801,
    `Horizontal overflow at 800px (${JSON.stringify(layout)})`,
  );
}

async function assertKeyboardFocus(page) {
  await page.keyboard.press("Home").catch(() => {});
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName,
      role: element.getAttribute("role"),
      name: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 80),
      href: element.getAttribute("href"),
      visible: rect.width > 0 && rect.height > 0,
    };
  });
  assert(
    focus && /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/u.test(focus.tag),
    `Tab did not focus a control (${JSON.stringify(focus)})`,
  );
  assert(focus.visible, `Tab focused an invisible control (${JSON.stringify(focus)})`);
}

async function assertAccessible(page, route) {
  const result = await new AxeBuilder({ page })
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
  throw new Error(`Accessibility violations on ${route}:\n- ${detail}`);
}

async function runSmoke(options) {
  const trace = (message) => process.stderr.write(`[browser-smoke] ${message}\n`);
  trace("checking Relay health");
  await assertRelayHealthy(options.apiUrl);
  let renderer;
  let appUrl = options.appUrl?.replace(/\/$/u, "");
  if (!appUrl) {
    renderer = await connectOrStartRenderer(options);
    appUrl = renderer.url;
    await renderer.ready;
  } else {
    await waitForHttp(appUrl);
  }

  const { chromium } = coreRequire()("playwright-core");
  const browser = await chromium
    .launch({ channel: "chrome", headless: !options.headed })
    .catch(async (error) => {
      const candidates = [
        process.env.CHROME_BIN,
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      ].filter((candidate) => candidate && existsSync(candidate));
      if (!candidates.length) {
        throw new Error(`Could not launch system Chrome: ${error.message}`);
      }
      return chromium.launch({ executablePath: candidates[0], headless: !options.headed });
    });
  const context = await browser.newContext({
    viewport: { width: 800, height: 560 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) =>
    failures.push(
      `requestfailed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown"})`,
    ),
  );
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  let reportChecked = false;
  let accessibilityChecks = 0;

  const checkAccessibility = async () => {
    const route = appRoute(page.url());
    trace(`checking WCAG on ${route}`);
    await assertAccessible(page, route);
    accessibilityChecks += 1;
  };

  try {
    trace(`opening ${appUrl}/tests`);
    await page.goto(`${appUrl}/tests`, {
      waitUntil: "domcontentloaded",
      timeout: START_TIMEOUT_MS,
    });
    await waitForRoute(page, "/tests");
    await page.getByRole("heading", { level: 1, name: "Tests" }).waitFor();
    await assertMinimumLayout(page);
    await assertKeyboardFocus(page);
    await checkAccessibility();

    trace("checking Tests, Live, Agent Debug, Devices, Changes, Runs and Settings routes");
    await clickNav(page, "Tests", "/tests");
    await checkAccessibility();
    if (await page.getByRole("link", { name: "Live", exact: true }).count()) {
      await clickNav(page, "Live", "/sessions");
    } else {
      trace("Live is reached through Devices; opening its route directly");
      await openRoute(page, "/sessions");
    }
    await checkAccessibility();
    const debugLink = page.getByRole("link", { name: "Agent Debug", exact: true });
    if (await debugLink.count()) {
      await debugLink.first().click();
      await waitForRoute(page, "/debug");
    } else {
      // Agent Debug is contextual to an active Live target, so keep the route
      // coverage even when this fixture has no target that can expose its link.
      trace("Agent Debug is not exposed by the current Live fixture; opening its route directly");
      await openRoute(page, "/debug");
    }
    await checkAccessibility();
    await clickNav(page, "Devices", "/devices");
    await checkAccessibility();
    trace("Changes is reached through search; opening its route directly");
    await openRoute(page, "/changes");
    await checkAccessibility();
    await clickNav(page, "Runs", "/runs");
    await checkAccessibility();
    const reportLink = page.locator('a[href*="#/runs/"]').first();
    await reportLink.waitFor({ state: "attached", timeout: 3_000 }).catch(() => {});
    if (await reportLink.count()) {
      trace("opening first Run report");
      await reportLink.evaluate((element) => element.click());
      await page.waitForFunction(() => window.location.hash.startsWith("#/runs/"), null, {
        timeout: CHECK_TIMEOUT_MS,
      });
      await page.locator("#main-content").waitFor({ state: "attached" });
      await page.waitForFunction(
        () => {
          const title = document.querySelector("#main-content h1")?.textContent?.trim();
          return Boolean(title && title !== "Runs");
        },
        null,
        { timeout: CHECK_TIMEOUT_MS },
      );
      reportChecked = true;
      await checkAccessibility();
    }
    const previousRoute = appRoute(page.url());
    await clickNav(page, "Settings", "/settings/general");

    await page.goBack();
    await waitForRoute(page, previousRoute);
    await page.goForward();
    await waitForRoute(page, "/settings/general");
    const durableRoute = appRoute(page.url());
    await page.reload({ waitUntil: "domcontentloaded", timeout: START_TIMEOUT_MS });
    await waitForRoute(page, durableRoute);
    await assertMinimumLayout(page);
    await checkAccessibility();
    trace("route, history, refresh, layout and keyboard checks passed");
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    if (renderer && !options.keepApp) stopRenderer(renderer.child);
  }
  if (failures.length) {
    throw new Error(
      `Browser smoke captured ${failures.length} console/page failure(s):\n- ${failures.join("\n- ")}`,
    );
  }
  return {
    appUrl,
    viewport: "800x560",
    route: "/settings/general",
    reportChecked,
    accessibilityChecks,
    failures: 0,
  };
}

try {
  const result = await runSmoke(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
}
