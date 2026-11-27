import assert from "node:assert/strict";
import test from "node:test";
import { parseTestYaml } from "@relay/core";
import { convertPlaywrightSpec } from "./import-playwright.js";

function yamlSteps(parsed: ReturnType<typeof parseTestYaml>) {
  return (parsed.steps ?? []).map((step) =>
    typeof step === "string"
      ? step
      : step.kind === "validation"
        ? { check: step.intent }
        : step.intent,
  );
}

function convert(source: string, overrides?: Record<string, string>) {
  return convertPlaywrightSpec({
    source,
    sourceName: "tests/checkout.spec.ts",
    fileName: "checkout.spec.ts",
    ...(overrides ? { overrides } : {}),
  });
}

const representative = `import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('https://shop.example');
});

test('places an order', async ({ page }) => {
  await page
    .getByRole('button', { name: 'Checkout' })
    .click();
  await page.getByLabel('Email').fill('me@example.com');
  await page.click('text=Pay now');
  await page.locator('#save-card').click();
  await page.fill('input[name="card"]', '4242424242424242');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Order total')).toBeVisible();
  await expect(page.locator('.total')).toContainText('$42.00');
  await expect(page.getByText('Error')).not.toBeVisible();
  await page.waitForTimeout(100);
});
`;

test("Playwright conversion extracts high-confidence actions and checks", () => {
  const result = convert(representative)[0]!;
  assert.ok(result);
  const parsed = parseTestYaml(result.yaml);
  assert.equal(parsed.name, "places an order");
  assert.equal(parsed.url, "https://shop.example/");
  assert.deepEqual(yamlSteps(parsed), [
    'Click "Checkout"',
    'Type "me@example.com" into Email',
    'Click "Pay now"',
    "Click the control with identifier save-card",
    'Type "4242424242424242" into the card field',
    "Press Enter",
    { check: "Order total is visible" },
    { check: 'The element identified by .total contains "$42.00"' },
    { check: "Error is not visible" },
  ]);
  assert.match(result.yaml, /partial import/u);
  assert.match(result.yaml, /beforeEach statements were merged/u);
  assert.match(result.yaml, /waitForTimeout\(100\)/u);
  assert.equal(result.outputFileName, "checkout.yaml");
});

test("Playwright semicolon-free and single-line statements still split correctly", () => {
  const result = convert(`test('quick', async ({ page }) => {
  await page.goto("https://shop.example")
  await page.getByText("Don't panic").click()
  await expect(page.getByText('Hi "there"')).toBeVisible()
})`)[0]!;
  const parsed = parseTestYaml(result.yaml);
  assert.deepEqual(yamlSteps(parsed), ['Click "Don\'t panic"', { check: 'Hi "there" is visible' }]);
});

test("relative first navigation resolves against the url override", () => {
  const result = convert(
    `test('relative', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByText('Pay').click();
})`,
    { url: "https://shop.example/app" },
  )[0]!;
  assert.equal(parseTestYaml(result.yaml).url, "https://shop.example/checkout");
});

test("later navigation is a step and dynamic code stays a warning", () => {
  const result = convert(`test('later', async ({ page }) => {
  await page.goto('https://shop.example');
  await page.goto('https://shop.example/help');
  await page.getByText(nextLabel).click();
  await page.locator('css=.generated').click();
})`)[0]!;
  const parsed = parseTestYaml(result.yaml);
  assert.deepEqual(yamlSteps(parsed), ["Open https://shop.example/help"]);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0]!, /nextLabel/u);
  assert.match(result.warnings[1]!, /css=\.generated/u);
});

test("multiple Playwright tests become multiple Relay files", () => {
  const results = convert(`test('one', async ({ page }) => {
  await page.goto('https://one.example');
  await page.getByText('One').click();
});
test('two', async ({ page }) => {
  await page.goto('https://two.example');
  await expect(page.getByText('Two')).toBeVisible();
});`);
  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((result) => result.outputFileName),
    ["checkout-one.yaml", "checkout-two.yaml"],
  );
  assert.equal(parseTestYaml(results[0]!.yaml).url, "https://one.example/");
  assert.equal(parseTestYaml(results[1]!.yaml).url, "https://two.example/");
});

test("unmappable Playwright input is rejected rather than silently emptied", () => {
  assert.throws(
    () =>
      convert(`test('empty', async ({ page }) => { await page.goto('https://shop.example'); })`),
    /no high-confidence/u,
  );
  assert.throws(() => convert(`const x = 1;`), /no static test/u);
  assert.throws(
    () =>
      convert(
        `test('relative', async ({ page }) => { await page.goto('/x'); await page.getByText('x').click(); })`,
      ),
    /no absolute page\.goto/u,
  );
});

test("Playwright exact output is stable partial-import YAML", () => {
  const result = convert(`test('exact', async ({ page }) => {
  await page.goto('https://shop.example');
  await page.getByText('Pay').click();
  await page.waitForTimeout(1);
})`)[0]!;
  assert.equal(
    result.yaml,
    `# Imported from Playwright spec tests/checkout.spec.ts. This is a partial import; review it before running.
# Warnings:
# - test 1 statement 3: unsupported Playwright code: await page.waitForTimeout(1)
name: exact
url: https://shop.example/
steps:
  - Click "Pay"
`,
  );
});

test("navigation after an action stays in order instead of rewriting the test start", () => {
  const result = convert(
    `test('late navigation', async ({ page }) => {
  await page.getByText('Start').click();
  await page.goto('https://shop.example/next');
})`,
    { url: "https://shop.example" },
  )[0]!;
  assert.deepEqual(yamlSteps(parseTestYaml(result.yaml)), [
    'Click "Start"',
    "Open https://shop.example/next",
  ]);
  assert.equal(parseTestYaml(result.yaml).url, "https://shop.example");
});
