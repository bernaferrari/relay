import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const relayBin = join(repoRoot, "bin/relay");
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const health = {
  ok: true,
  product: "relay",
  version: "0.1.0",
  at: 1,
  uptimeMs: 10,
};

function spawnRelay(
  args: string[],
  cwd = repoRoot,
): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.RELAY_CALLER_CWD;
    const child = spawn(process.execPath, [relayBin, ...args], { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`relay bin timed out\n${stderr}`));
    }, 20_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

function oneJson(stdout: string): { ok?: boolean; type?: string; operationId?: string } {
  const trimmed = stdout.trim();
  const parsed = JSON.parse(trimmed) as { ok?: boolean; type?: string; operationId?: string };
  assert.equal(typeof parsed, "object");
  assert.equal(Array.isArray(parsed), false);
  return parsed;
}

async function withServer(
  handler: (req: IncomingMessage, url: URL, res: ServerResponse) => boolean,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (handler(req, url, res)) return;
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected tcp address");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("relay bin --json success is exactly one stdout JSON document", async () => {
  await withServer(
    (_req, url, res) => {
      if (url.pathname !== "/health") return false;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(health));
      return true;
    },
    async (url) => {
      const result = await spawnRelay([
        "system",
        "health",
        "--json",
        "--server",
        url,
        "--timeout",
        "5000",
      ]);
      assert.equal(result.status, 0, result.stderr);
      const body = oneJson(result.stdout);
      assert.equal(body.type, "result");
      assert.equal(body.ok, true);
      assert.equal(body.operationId, "system.health.get");
      assert.doesNotMatch(result.stdout, /"type":"progress"/);
    },
  );
});

test("relay bin resolves user paths against the caller's directory, not the checkout", async () => {
  const caller = await mkdtemp(join(tmpdir(), "relay-caller-"));
  try {
    await writeFile(join(caller, "query.json"), JSON.stringify({ limit: 3 }));
    let seen = "";
    await withServer(
      (_req, url, res) => {
        if (url.pathname !== "/runs") return false;
        seen = url.search;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ runs: [] }));
        return true;
      },
      async (url) => {
        const result = await spawnRelay(
          ["run", "list", "--input-file", "query.json", "--json", "--server", url],
          caller,
        );
        assert.equal(result.status, 0, result.stderr);
        assert.equal(oneJson(result.stdout).ok, true);
        assert.match(seen, /limit=3/u);
      },
    );
  } finally {
    await rm(caller, { recursive: true, force: true });
  }
});

test("relay bin --json failure is exactly one stdout JSON document", async () => {
  const result = await spawnRelay(["operation", "invoke", "not.real", "--input", "{}", "--json"]);
  assert.equal(result.status, 2);
  const body = oneJson(result.stdout);
  assert.equal(body.type, "error");
  assert.equal(body.ok, false);
  assert.match(result.stdout, /Unknown operation/);
  assert.doesNotMatch(result.stderr, /relay:/);
  assert.doesNotMatch(result.stdout, /relay:/);
});

test("relay bin --json keeps progress and heartbeat on stderr", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-bin-out-"));
  const runDir = join(root, "job-run");
  const outDir = join(root, "out");
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "frame.png"), pngBytes);
  let polls = 0;
  try {
    await withServer(
      (_req, url, res) => {
        if (!url.pathname.startsWith("/jobs/")) return false;
        polls += 1;
        const job = {
          id: "abc",
          action: "app-map.test.run",
          status: polls === 1 ? "running" : "ok",
          queuedAt: 1,
          lastLogs: polls === 1 ? ["tour → Haptics"] : ["tour: done"],
          runDir,
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ job }));
        return true;
      },
      async (url) => {
        const result = await spawnRelay([
          "job",
          "watch",
          "abc",
          "--json",
          "--out",
          outDir,
          "--server",
          url,
          "--timeout",
          "5000",
        ]);
        assert.equal(result.status, 0, result.stderr);
        const body = oneJson(result.stdout);
        assert.equal(body.type, "result");
        assert.equal(body.ok, true);
        assert.match(result.stderr, /tour → Haptics/);
        assert.match(result.stderr, /"type":"progress"/);
        assert.doesNotMatch(result.stdout, /"type":"progress"/);
        assert.doesNotMatch(result.stdout, /tour → Haptics/);
      },
    );
    const saved = JSON.parse(await readFile(join(outDir, "result.json"), "utf8")) as {
      ok?: boolean;
    };
    assert.equal(saved.ok, true);
    assert.match(await readFile(join(outDir, "stderr.log"), "utf8"), /tour → Haptics/);
    assert.deepEqual(await readFile(join(outDir, "abc", "frame.png")), pngBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
