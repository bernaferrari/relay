import assert from "node:assert/strict";
import http from "node:http";
import { access } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright-core";
import { applyBrowserPageTool, observeBrowserPageTools } from "./browser-page-tools.js";

test("page tools find visible literal text, wrap matches, zoom across navigation and retain tab history", async (t) => {
  const executablePath =
    process.env.RELAY_TEST_CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  try {
    await access(executablePath);
  } catch {
    t.skip("Google Chrome is not installed");
    return;
  }
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      `<title>${req.url === "/two" ? "Second" : "First"}</title><p>İ Relay relay [demo]</p><p hidden>relay</p>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({
    executablePath:
      process.env.RELAY_TEST_CHROME_PATH ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    const page = await browser.newPage();
    observeBrowserPageTools(page);
    await page.goto(base);
    const first = await applyBrowserPageTool(page, { kind: "browser.find", query: "relay" });
    assert.deepEqual(first.find, { query: "relay", current: 1, total: 2, truncated: false });
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), "Relay");
    assert.equal(
      (
        await applyBrowserPageTool(page, {
          kind: "browser.find",
          query: "relay",
          direction: "previous",
        })
      ).find?.current,
      2,
    );
    assert.equal(
      (await applyBrowserPageTool(page, { kind: "browser.find", query: "[demo]" })).find?.total,
      1,
    );
    await applyBrowserPageTool(page, { kind: "browser.find", query: "" });
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), "");
    await applyBrowserPageTool(page, { kind: "browser.zoom", factor: 1.5 });
    assert.equal(await page.evaluate(() => document.documentElement.style.zoom), "1.5");
    await page.goto(`${base}/two`);
    await page.waitForFunction(() => document.documentElement.style.zoom === "1.5");
    await page.evaluate(() => history.pushState({}, "", "/three"));
    const history = (await applyBrowserPageTool(page, { kind: "browser.history" })).history!;
    assert.deepEqual(
      history.map((row) => row.url),
      [`${base}/three`, `${base}/two`, `${base}/`],
    );
    assert.equal(history[1]?.title, "Second");
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
