#!/usr/bin/env node
/**
 * Stateful Product V2 authoring acceptance. The visual fixture owns a small
 * persisted service state; this script drives the real router with clicks and
 * form input so a reload is an interruption test, not a fixture switch.
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(resolve(root, "packages/mcp/package.json"));
const { chromium } = require("playwright-core");
const base = process.env.RELAY_FIXTURE_URL ?? "http://localhost:3000/visual-fixtures.html";
const url = `${base}?fixture=workflow`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const click = async (pattern) => {
  const button = page.getByRole("button", { name: pattern }).first();
  await button.waitFor({ state: "visible" });
  await button.click();
};
const has = async (pattern) => (await page.getByText(pattern).count()) > 0;
try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /record a test/i }).waitFor();
  await click(/start recording/i);
  await page.getByText(/captured actions/i).waitFor();
  await click(/stop/i);
  await page.getByRole("heading", { name: /review/i }).waitFor();
  await click(/replay recording/i);
  if (
    !(await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("relay:visual-workflow-fixture:v1") ?? "{}")
          .replayAttempts === 1,
    ))
  )
    throw new Error("first replay did not persist its retry state");
  await click(/replay recording/i);
  await page.getByRole("button", { name: /^save test$/i }).click();
  await page.getByRole("heading", { name: /verify checkout totals/i }).waitFor();
  const testUrl = page.url();
  await page.reload({ waitUntil: "networkidle" });
  if (page.url() !== testUrl || !(await has("Verify checkout totals")))
    throw new Error("saved Test identity did not survive reload");
  await click(/run test/i);
  if (
    !(await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("relay:visual-workflow-fixture:v1") ?? "{}").runAttempts ===
        1,
    ))
  )
    throw new Error("first run did not persist its retry state");
  await click(/run test/i);
  await page.getByText(/run report/i).waitFor();
  await click(/view test/i);
  await click(/edit test/i);
  await page.getByRole("heading", { name: /edit/i }).waitFor();
  console.log(
    JSON.stringify({
      ok: true,
      workflow: [
        "start",
        "record",
        "stop",
        "review",
        "replay-failed",
        "replay-passed",
        "approve",
        "run-failed",
        "run-passed",
        "report",
        "edit",
      ],
      testUrl,
    }),
  );
} finally {
  await browser.close();
}
