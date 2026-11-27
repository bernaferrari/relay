import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { ExitCode } from "./errors.js";
import { readProjectConfig } from "./everyday-names.js";
import { formatInitResult, runInitCommand } from "./init-command.js";
import { runCli } from "./index.js";

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "relay-init-"));
  for (const [path, text] of Object.entries(files)) {
    await writeFile(join(dir, path), text);
  }
  return dir;
}

test("relay init detects Vite, prefers the running localhost server, and writes minimal files", async () => {
  const dir = await fixture({
    "package.json": JSON.stringify({
      name: "shop-web",
      scripts: { dev: "vite" },
      devDependencies: { vite: "latest" },
    }),
  });
  try {
    const result = await runInitCommand(
      { cwd: dir, env: {} },
      { probeUrl: async (url) => url === "http://127.0.0.1:5173/" },
    );
    assert.equal(result.kind, "vite");
    assert.equal(result.scaffold?.url, "http://127.0.0.1:5173/");
    assert.equal(result.scaffold?.urlSource, "running");
    assert.deepEqual(result.scaffold?.written, [".relay/config.json", ".relay/tests/smoke.yaml"]);
    assert.deepEqual(JSON.parse(await readFile(join(dir, ".relay/config.json"), "utf8")), {
      device: "browser",
      url: "http://127.0.0.1:5173/",
    });
    const yaml = await readFile(join(dir, ".relay/tests/smoke.yaml"), "utf8");
    assert.match(yaml, /^name: Home page loads$/mu);
    assert.match(yaml, /^url: http:\/\/127\.0\.0\.1:5173\/$/mu);
    assert.match(yaml, /- check: The home page renders without an error page/u);
    const text = formatInitResult(result);
    assert.match(text, /Initialized Relay for a Vite project/u);
    assert.match(text, /export OPENROUTER_API_KEY=/u);
    assert.match(text, /relay ci \.relay\/tests/u);
    assert.match(text, /claude mcp add relay -- npx -y @relay\/mcp/u);
    assert.doesNotMatch(text, /Start the app/u, "a running server is not started again");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("relay init reads an explicit framework port from the dev script", async () => {
  const dir = await fixture({
    "package.json": JSON.stringify({
      scripts: { dev: "next dev -p 3005" },
      dependencies: { next: "latest", react: "latest" },
    }),
  });
  try {
    const result = await runInitCommand(
      { cwd: dir, env: { OPENROUTER_API_KEY: "test-key" } },
      { probeUrl: async () => false },
    );
    assert.equal(result.kind, "next");
    assert.equal(result.scaffold?.url, "http://127.0.0.1:3005/");
    assert.equal(result.scaffold?.urlSource, "script");
    assert.equal(result.needsModelKey, false);
    assert.match(result.nextSteps[0] ?? "", /npm run dev/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("relay init is idempotent and --force rewrites only the generated files", async () => {
  const dir = await fixture({});
  try {
    const first = await runInitCommand(
      { cwd: dir, url: "http://127.0.0.1:3999/", env: {} },
      { probeUrl: async () => true },
    );
    assert.deepEqual(first.scaffold?.kept, []);
    await writeFile(
      join(dir, ".relay/tests/smoke.yaml"),
      "name: Custom\nurl: http://x\nsteps: []\n",
    );
    const second = await runInitCommand(
      { cwd: dir, url: "http://127.0.0.1:3999/", env: {} },
      { probeUrl: async () => true },
    );
    assert.deepEqual(second.scaffold?.written, []);
    assert.deepEqual(second.scaffold?.kept, [".relay/config.json", ".relay/tests/smoke.yaml"]);
    assert.match(await readFile(join(dir, ".relay/tests/smoke.yaml"), "utf8"), /^name: Custom/u);
    const forced = await runInitCommand(
      { cwd: dir, url: "http://127.0.0.1:3999/", force: true, env: {} },
      { probeUrl: async () => true },
    );
    assert.deepEqual(forced.scaffold?.written, [".relay/config.json", ".relay/tests/smoke.yaml"]);
    assert.match(
      await readFile(join(dir, ".relay/tests/smoke.yaml"), "utf8"),
      /^name: Home page loads$/mu,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mobile projects are documented without pretending web scaffolding fits them", async () => {
  const dir = await fixture({
    "package.json": JSON.stringify({ dependencies: { expo: "latest", "react-native": "latest" } }),
  });
  try {
    const result = await runInitCommand({ cwd: dir, env: {} }, { probeUrl: async () => false });
    assert.equal(result.kind, "expo");
    assert.ok(result.mobilePath?.some((step) => step.includes("relay guide record")));
    assert.equal(existsSync(join(dir, ".relay")), false);
    assert.match(formatInitResult(result), /does not bootstrap mobile apps automatically/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unknown projects ask for a URL, and an explicit URL initializes them", async () => {
  const dir = await fixture({});
  try {
    const missing = await runInitCommand({ cwd: dir, env: {} }, { probeUrl: async () => false });
    assert.equal(missing.scaffold, undefined);
    assert.match(formatInitResult(missing), /relay init --url/u);
    const explicit = await runInitCommand(
      { cwd: dir, url: "http://localhost:8080/app?welcome=1#fragment", env: {} },
      { probeUrl: async () => true },
    );
    assert.equal(explicit.scaffold?.url, "http://localhost:8080/app?welcome=1");
    assert.equal(existsSync(join(dir, ".relay/config.json")), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(".relay/config.json supplies project defaults and relay.json keeps precedence", async () => {
  const dir = await fixture({});
  try {
    await mkdir(join(dir, ".relay"), { recursive: true });
    await writeFile(
      join(dir, ".relay/config.json"),
      JSON.stringify({ device: "browser", url: "http://127.0.0.1:3000" }),
    );
    assert.deepEqual(readProjectConfig({ RELAY_CALLER_CWD: dir }), {
      device: "browser",
      url: "http://127.0.0.1:3000",
    });
    await writeFile(join(dir, "relay.json"), JSON.stringify({ app: "Shop" }));
    assert.deepEqual(readProjectConfig({ RELAY_CALLER_CWD: dir }), { app: "Shop" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the everyday init verb writes files without creating a client or starting the server", async () => {
  const dir = await fixture({});
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  stdout.on("data", (chunk) => (out += String(chunk)));
  try {
    const code = await runCli(["init", "--url", "http://127.0.0.1:3998"], {
      streams: { stdout, stderr },
      env: { RELAY_CALLER_CWD: dir },
      registerSignalHandlers: false,
      createClient: () => {
        throw new Error("init must not create a server client");
      },
      ensureOutcomeServer: async () => {
        throw new Error("init must not start the server");
      },
    });
    assert.equal(code, ExitCode.success);
    assert.match(out, /Initialized Relay/u);
    assert.equal(existsSync(join(dir, ".relay/tests/smoke.yaml")), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
