import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { downloadFromPage } from "./media-download.js";

test("download receives an actual browser artifact from the selected control", async (t) => {
  const executablePath =
    process.env.RELAY_TEST_CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  try {
    await access(executablePath);
  } catch {
    t.skip("Chrome is not installed");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "media-download-"));
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.setContent(
      '<a id="asset" href="data:text/plain;base64,cHJvb2Y=" download="result.txt">Download result</a>',
    );
    const file = join(root, "result.txt");
    await downloadFromPage(page, { identifier: "asset" }, file);
    assert.equal(await readFile(file, "utf8"), "proof");
  } finally {
    await browser.close();
    await rm(root, { recursive: true, force: true });
  }
});
