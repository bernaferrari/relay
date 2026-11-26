import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { attachFilesOnPage } from "./browser-live-controls.js";
import { resolveBrowserExecutable } from "./browser-executable.js";

test("a failed named attachment never writes to another widget's file input", async (t) => {
  const executablePath = resolveBrowserExecutable().path;
  if (!executablePath) return t.skip("No installed browser; set RELAY_BROWSER_EXECUTABLE");
  const root = await mkdtemp(join(tmpdir(), "relay-upload-"));
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const file = join(root, "sample.txt");
    await writeFile(file, "fixture");
    const page = await browser.newPage();
    page.setDefaultTimeout(1000);
    await page.setContent(
      '<input id="unrelated" type="file"><button aria-label="Edit image">Edit image</button>',
    );
    await assert.rejects(
      attachFilesOnPage(page, file, { label: "Edit image" }),
      /file chooser did not open/,
    );
    assert.equal(
      await page
        .locator("#unrelated")
        .evaluate((input) => (input as HTMLInputElement).files?.length),
      0,
    );
    await attachFilesOnPage(page, file, { identifier: "unrelated" });
    assert.equal(
      await page
        .locator("#unrelated")
        .evaluate((input) => (input as HTMLInputElement).files?.[0]?.name),
      "sample.txt",
    );
  } finally {
    await browser.close();
    await rm(root, { recursive: true, force: true });
  }
});
