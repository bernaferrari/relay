import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "out/desktop-inspection.json");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

async function waitForInspector(url, timeoutMs = 15_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}/json/version`);
      if (response.ok) return;
      lastError = new Error(`Inspector returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(
    `Relay's Electron inspector did not become ready at ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function simplifyAxNode(node) {
  return {
    role: node.role?.value,
    name: node.name?.value,
    description: node.description?.value,
    disabled: node.disabled,
    focused: node.focused,
  };
}

async function main() {
  if (!existsSync(manifestPath)) {
    throw new Error(
      `No running Relay desktop session was found. Start it with \`pnpm dev:desktop\`, then run this command again.`,
    );
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  await waitForInspector(manifest.debugUrl);
  const browser = await chromium.connectOverCDP(manifest.debugUrl);

  try {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page =
      pages.find((candidate) => candidate.url().startsWith(manifest.rendererUrl)) ?? pages.at(0);
    if (!page) throw new Error("Electron is running, but it has no inspectable renderer page.");

    const consoleMessages = [];
    const pageErrors = [];
    const networkFailures = [];
    const pendingFailureBodies = new Set();
    page.on("console", (message) => {
      if (["warning", "error"].includes(message.type())) {
        consoleMessages.push({ type: message.type(), text: message.text() });
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      if (response.status() < 400) return;
      const pending = response
        .text()
        .catch(() => "")
        .then((body) => {
          networkFailures.push({
            status: response.status(),
            method: response.request().method(),
            url: response.url(),
            body: body.slice(0, 2_000),
          });
        })
        .finally(() => pendingFailureBodies.delete(pending));
      pendingFailureBodies.add(pending);
    });

    if (flag("--reload")) {
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    await page.waitForTimeout(Number(option("--settle", "500")));

    const interaction = {};
    const fill = option("--fill");
    if (fill) {
      const separator = fill.indexOf("=");
      if (separator <= 0)
        throw new Error("--fill expects an accessible name and value: Name=value");
      const name = fill.slice(0, separator);
      const value = fill.slice(separator + 1);
      await page.getByRole("textbox", { name, exact: true }).fill(value);
      interaction.fill = name;
    }
    const click = option("--click");
    if (click) {
      await page.getByRole("button", { name: click, exact: true }).click();
      interaction.click = click;
    }
    const clickAt = option("--click-at");
    if (clickAt) {
      const [xText, yText, ...rest] = clickAt.split(",");
      const x = Number(xText);
      const y = Number(yText);
      if (rest.length || !Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("--click-at expects renderer coordinates: X,Y");
      }
      await page.mouse.click(x, y);
      interaction.clickAt = { x, y };
    }
    const clickIn = option("--click-in");
    if (clickIn) {
      const separator = clickIn.indexOf("=");
      const [xText, yText, ...rest] = clickIn.slice(separator + 1).split(",");
      const name = clickIn.slice(0, separator);
      const x = Number(xText);
      const y = Number(yText);
      if (
        separator <= 0 ||
        rest.length ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        x > 1 ||
        y < 0 ||
        y > 1
      ) {
        throw new Error("--click-in expects an accessible name and normalized point: Name=0.5,0.5");
      }
      const target = page.getByLabel(name, { exact: true });
      const box = await target.boundingBox();
      if (!box) throw new Error(`The labeled target is not visible: ${name}`);
      await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
      interaction.clickIn = { name, x, y };
    }
    const press = option("--press");
    if (press) {
      await page.keyboard.press(press);
      interaction.press = press;
    }
    if (Object.keys(interaction).length) {
      await page.waitForTimeout(Number(option("--after-action", "700")));
    }
    await Promise.allSettled(pendingFailureBodies);

    const outputPath = resolve(option("--screenshot", resolve(root, "out/relay-electron.png")));
    mkdirSync(dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath });

    const cdp = await page.context().newCDPSession(page);
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    const interactiveRoles = new Set([
      "button",
      "checkbox",
      "combobox",
      "link",
      "menuitem",
      "option",
      "radio",
      "slider",
      "switch",
      "tab",
      "textbox",
    ]);
    const interactive = nodes
      .filter((node) => interactiveRoles.has(node.role?.value))
      .map(simplifyAxNode)
      .slice(0, 250);
    const layout = await page.evaluate(() => ({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      colorScheme: document.documentElement.dataset.colorScheme ?? "system",
      hasErrorOverlay: Boolean(
        document.querySelector(
          "vite-error-overlay, .vite-error-overlay, #webpack-dev-server-client-overlay",
        ),
      ),
      bodyText: document.body.innerText.slice(0, 8_000),
    }));
    const report = {
      inspectedAt: Date.now(),
      electronPid: manifest.pid,
      debugUrl: manifest.debugUrl,
      rendererUrl: page.url(),
      relayUrl: manifest.relayUrl,
      title: await page.title(),
      interaction,
      screenshot: outputPath,
      layout,
      consoleMessages,
      pageErrors,
      networkFailures,
      interactive,
    };
    const reportPath = outputPath.replace(/\.[^.]+$/, ".json");
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(
      `${JSON.stringify({ ...report, layout: { ...layout, bodyText: undefined } }, null, 2)}\n`,
    );
    process.stdout.write(`\nRenderer text and full details: ${reportPath}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
