import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { executeImportCommand, resolveImportTokens } from "./import-commands.js";
import { tokenize } from "./cli-argv.js";
import { runCli } from "./index.js";
import { renderHelp } from "./help.js";
import { parseTestYaml } from "@relay/core";

const MAESTRO = `appId: com.example.shop
name: Checkout flow
---
- launchApp
- tapOn: Checkout
- inputText: me@example.com
- assertVisible: Order total
- swipe:
    direction: UP
- scroll
- back
- runScript: echo hi
`;

function capture() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk) => (out += String(chunk)));
  stderr.on("data", (chunk) => (err += String(chunk)));
  return { streams: { stdout, stderr }, stdout: () => out, stderr: () => err };
}

async function tempdir() {
  return mkdtemp(join(tmpdir(), "relay-import-test-"));
}

test("import command resolution keeps the positional path authoritative over input", () => {
  const tokens = tokenize([
    "import",
    "maestro",
    "flows/checkout.yaml",
    "--input",
    '{"path":"wrong.yaml","app":"Shop","url":"https://shop.example","out":"custom"}',
  ]);
  const resolved = resolveImportTokens(tokens, {});
  assert.equal(resolved.sourcePath, "flows/checkout.yaml");
  assert.equal(resolved.outDir, "custom");
  assert.equal(resolved.dryRun, false);
  assert.deepEqual(resolved.overrides, { app: "Shop", url: "https://shop.example" });
  assert.throws(
    () =>
      resolveImportTokens(tokenize(["import", "maestro", "x.yaml", "--input", '{"wat":1}']), {}),
    /Unknown input field/u,
  );
});

test("Maestro folder import writes YAML files without overwriting an existing file", async () => {
  const dir = await tempdir();
  try {
    await mkdir(join(dir, "flows"));
    await writeFile(join(dir, "flows", "checkout.yaml"), MAESTRO);
    await writeFile(
      join(dir, "flows", "second.yml"),
      MAESTRO.replace("Checkout flow", "Second flow"),
    );
    await mkdir(join(dir, ".relay", "tests"), { recursive: true });
    await writeFile(join(dir, ".relay", "tests", "checkout.yaml"), "name: Keep me\n", "utf8");
    const result = await executeImportCommand(dir, {
      format: "maestro",
      sourcePath: "flows",
      outDir: ".relay/tests",
      dryRun: false,
      overrides: {},
      commandPath: "import maestro",
    });
    assert.equal(result.files.length, 2);
    const checkout = result.files.find((file) => file.source.endsWith("checkout.yaml"))!;
    assert.equal(checkout.output, join(".relay", "tests", "checkout-2.yaml"));
    assert.equal(checkout.renamed, true);
    assert.equal(
      await readFile(join(dir, ".relay", "tests", "checkout.yaml"), "utf8"),
      "name: Keep me\n",
    );
    const written = await readFile(join(dir, ".relay", "tests", "checkout-2.yaml"), "utf8");
    assert.equal(parseTestYaml(written).name, "Checkout flow");
    assert.match(written, /^# Imported from Maestro flow/u);
    assert.deepEqual((await readdir(join(dir, ".relay", "tests"))).sort(), [
      "checkout-2.yaml",
      "checkout.yaml",
      "second.yaml",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runCli import maestro --dry-run prints YAML and writes nothing", async () => {
  const dir = await tempdir();
  try {
    await writeFile(join(dir, "checkout.yaml"), MAESTRO);
    const io = capture();
    const code = await runCli(["import", "maestro", "checkout.yaml", "--dry-run"], {
      streams: io.streams,
      env: { RELAY_CALLER_CWD: dir },
      registerSignalHandlers: false,
    });
    assert.equal(code, 0);
    assert.match(io.stdout(), /name: Checkout flow/u);
    assert.match(io.stdout(), /check: Order total is visible/u);
    assert.match(io.stdout(), /skipped runScript/u);
    assert.equal(io.stderr(), "");
    await assert.rejects(readFile(join(dir, ".relay", "tests", "checkout.yaml"), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runCli import playwright honors url input and reports machine JSON", async () => {
  const dir = await tempdir();
  try {
    await writeFile(
      join(dir, "checkout.spec.ts"),
      `test('checkout', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByText('Paid')).toBeVisible();
});`,
    );
    const io = capture();
    const code = await runCli(
      [
        "import",
        "playwright",
        "checkout.spec.ts",
        "--input",
        '{"url":"https://shop.example/app"}',
        "--out",
        "custom-tests",
        "--json",
      ],
      { streams: io.streams, env: { RELAY_CALLER_CWD: dir }, registerSignalHandlers: false },
    );
    assert.equal(code, 0, io.stderr());
    const envelope = JSON.parse(io.stdout().trim());
    assert.equal(envelope.type, "result");
    assert.equal(envelope.ok, true);
    assert.equal(envelope.operationId, "local.import");
    assert.equal(envelope.result.files.length, 1);
    assert.equal(envelope.result.files[0].output, join("custom-tests", "checkout.yaml"));
    const written = await readFile(join(dir, "custom-tests", "checkout.yaml"), "utf8");
    assert.equal(parseTestYaml(written).url, "https://shop.example/checkout");
    assert.match(written, /Click "Pay"/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("import failures use usage exit code and do not create partial output", async () => {
  const dir = await tempdir();
  try {
    await writeFile(join(dir, "broken.yaml"), "not: [valid");
    const io = capture();
    const code = await runCli(["import", "maestro", "broken.yaml"], {
      streams: io.streams,
      env: { RELAY_CALLER_CWD: dir },
      registerSignalHandlers: false,
    });
    assert.equal(code, 2);
    assert.match(io.stderr(), /invalid YAML/u);
    await assert.rejects(readdir(join(dir, ".relay")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("root, family, and command descriptors document both import formats", () => {
  const root = renderHelp();
  assert.match(root, /relay import maestro <flow\.yaml>/u);
  assert.match(root, /relay import playwright <spec\.ts>/u);
  const family = renderHelp("import");
  assert.match(family, /Convert Maestro YAML flows/u);
  assert.match(family, /Best-effort conversion of Playwright/u);
  assert.match(family, /--dry-run/u);
  assert.match(family, /Unsupported commands are never dropped quietly/u);
  assert.match(renderHelp("advanced"), /import — Convert Maestro and Playwright/u);
});
