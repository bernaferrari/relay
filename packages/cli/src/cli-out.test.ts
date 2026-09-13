import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { pngPathsIn, writeRunOutDir } from "./cli-out.js";
import { ExitCode } from "./errors.js";
import { runCli } from "./index.js";

const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function capture() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk) => (out += String(chunk)));
  stderr.on("data", (chunk) => (err += String(chunk)));
  return {
    streams: { stdout, stderr },
    stdout: () => out,
    stderr: () => err,
  };
}

test("pngPathsIn collects .png strings from nested job envelopes", () => {
  assert.deepEqual(
    pngPathsIn({
      result: { job: { resources: { runDir: "/tmp/run" }, extra: "/tmp/missing.png" } },
    }),
    ["/tmp/missing.png"],
  );
});

test("writeRunOutDir writes result.json, stderr.log, and copies job PNGs", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-cli-out-"));
  const runDir = join(root, "job-run");
  const outDir = join(root, "out");
  try {
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "screen.png"), pngBytes);
    const copied = await writeRunOutDir({
      dir: outDir,
      envelope: { type: "result", ok: true, result: { job: { resources: { runDir } } } },
      stderr: "Waiting on job.get…\n",
    });
    assert.deepEqual(JSON.parse(await readFile(join(outDir, "result.json"), "utf8")), {
      type: "result",
      ok: true,
      result: { job: { resources: { runDir } } },
    });
    assert.equal(await readFile(join(outDir, "stderr.log"), "utf8"), "Waiting on job.get…\n");
    assert.deepEqual(copied, [join(outDir, "screen.png")]);
    assert.deepEqual(await readFile(join(outDir, "screen.png")), pngBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("job watch --out captures stderr progress and copies runDir PNGs", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-cli-out-run-"));
  const runDir = join(root, "job-run");
  const outDir = join(root, "out");
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "frame.png"), pngBytes);
  const io = capture();
  const responses = [
    {
      job: {
        id: "abc",
        action: "app-map.test.run",
        status: "running",
        queuedAt: 1,
        lastLogs: ["tour → Settings"],
        runDir,
      },
    },
    {
      job: {
        id: "abc",
        action: "app-map.test.run",
        status: "ok",
        queuedAt: 1,
        lastLogs: ["tour: done"],
        runDir,
      },
    },
  ];
  try {
    const code = await runCli(["job", "watch", "abc", "--json", "--out", outDir], {
      streams: io.streams,
      createClient: () => ({
        async invoke() {
          return responses.shift();
        },
        events: async () => {},
      }),
      registerSignalHandlers: false,
      pollIntervalMs: 0,
      env: {},
    });
    assert.equal(code, ExitCode.success);
    const stdout = JSON.parse(io.stdout()) as { ok?: boolean; type?: string };
    assert.equal(stdout.type, "result");
    assert.equal(stdout.ok, true);
    assert.equal(io.stdout().trim().split("\n").length, 1);
    assert.match(io.stderr(), /tour → Settings/);
    assert.equal(JSON.parse(await readFile(join(outDir, "result.json"), "utf8")).ok, true);
    assert.match(await readFile(join(outDir, "stderr.log"), "utf8"), /tour → Settings/);
    assert.deepEqual(await readFile(join(outDir, "frame.png")), pngBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
