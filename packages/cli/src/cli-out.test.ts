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
const overlayBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
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
    assert.deepEqual(await readFile(join(outDir, "checkpoint.png")), pngBytes);
    assert.deepEqual(await readFile(join(outDir, "run", "screen.png")), pngBytes);
    assert.ok(copied.includes(join(outDir, "checkpoint.png")));
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
    assert.deepEqual(await readFile(join(outDir, "checkpoint.png")), pngBytes);
    assert.deepEqual(await readFile(join(outDir, "abc", "frame.png")), pngBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeRunOutDir exports capture-review dest frame instead of flattening home cookies onto 003.png", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-cli-out-checkpoint-"));
  const homeDir = join(root, "home-run");
  const settingsDir = join(root, "settings-run");
  const outDir = join(root, "out");
  try {
    await mkdir(join(homeDir, "frames"), { recursive: true });
    await mkdir(join(settingsDir, "frames"), { recursive: true });
    await writeFile(join(homeDir, "frames", "001.png"), pngBytes);
    await writeFile(join(homeDir, "frames", "003.png"), pngBytes);
    await writeFile(join(settingsDir, "frames", "001.png"), pngBytes);
    await writeFile(join(settingsDir, "frames", "003.png"), overlayBytes);
    await writeFile(join(settingsDir, "frames", "004.png"), overlayBytes);
    const copied = await writeRunOutDir({
      dir: outDir,
      envelope: {
        type: "result",
        ok: true,
        result: {
          jobs: [
            {
              id: "9c7a40d9-eb06-43ee-8807-ba5ffdbd32e3",
              resources: { runDir: homeDir },
              frames: [{ path: "frames/001.png" }, { path: "frames/003.png" }],
              artifacts: [
                {
                  kind: "capture-review",
                  data: { status: "pending", framePath: "frames/001.png", caption: "Observe" },
                },
              ],
            },
            {
              id: "ab4823a9-5dc4-4ab4-8acb-60b32475e045",
              resources: { runDir: settingsDir },
              frames: [
                { path: "frames/001.png" },
                { path: "frames/003.png" },
                { path: "frames/004.png" },
              ],
              artifacts: [
                {
                  kind: "capture-review",
                  data: {
                    status: "pending",
                    framePath: "frames/003.png",
                    caption: "Settings",
                    lookFor: "Settings",
                  },
                },
              ],
            },
          ],
        },
      },
      stderr: "",
    });
    const checkpoint = await readFile(join(outDir, "checkpoint.png"));
    assert.deepEqual(checkpoint, overlayBytes);
    assert.notDeepEqual(checkpoint, pngBytes);
    try {
      const flattened = await readFile(join(outDir, "003.png"));
      assert.deepEqual(
        flattened,
        overlayBytes,
        "flattened 003.png must be the Settings overlay, not home cookies",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    assert.ok(
      copied.some((path) => path.endsWith("checkpoint.png")),
      "checkpoint.png must be exported as the capture-review dest frame",
    );
    assert.deepEqual(await readFile(join(outDir, "ab4823a9", "frames", "003.png")), overlayBytes);
    assert.deepEqual(await readFile(join(outDir, "9c7a40d9", "frames", "003.png")), pngBytes);
    assert.deepEqual(await readFile(join(outDir, "ab4823a9", "checkpoint.png")), overlayBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeRunOutDir falls back to the last dest frame when capture-review is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-cli-out-last-dest-"));
  const runDir = join(root, "job-run");
  const outDir = join(root, "out");
  try {
    await mkdir(join(runDir, "frames"), { recursive: true });
    await writeFile(join(runDir, "frames", "001.png"), pngBytes);
    await writeFile(join(runDir, "frames", "004.png"), overlayBytes);
    await writeRunOutDir({
      dir: outDir,
      envelope: {
        type: "result",
        ok: true,
        result: {
          job: {
            id: "ab4823a9-last-dest",
            resources: { runDir },
            frames: [{ path: "frames/001.png" }, { path: "frames/004.png" }],
            artifacts: [],
          },
        },
      },
      stderr: "",
    });
    assert.deepEqual(await readFile(join(outDir, "checkpoint.png")), overlayBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeRunOutDir dest checkpoint is dest wait-for 003, not leftover Close 004 last-frame", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-cli-out-leftover-004-"));
  const runDir = join(root, "job-run");
  const outDir = join(root, "out");
  try {
    await mkdir(join(runDir, "frames"), { recursive: true });
    await writeFile(join(runDir, "frames", "003.png"), overlayBytes);
    await writeFile(join(runDir, "frames", "004.png"), pngBytes);
    const copied = await writeRunOutDir({
      dir: outDir,
      envelope: {
        type: "result",
        ok: true,
        result: {
          job: {
            id: "4b93702b-leftover-004",
            resources: { runDir },
            frames: [
              { path: "frames/003.png", caption: "step:step-observe:Observe" },
              { path: "frames/004.png", caption: "after · Run saved Test" },
            ],
            artifacts: [
              {
                kind: "capture-review",
                data: {
                  caption: "step:step-observe:Observe",
                  lookFor: "Observe",
                  framePath: "frames/003.png",
                  phase: "dest",
                  policy: "fast",
                  status: "pending",
                },
              },
              {
                kind: "capture-review",
                data: {
                  caption: "Close",
                  framePath: "frames/004.png",
                },
              },
            ],
          },
        },
      },
      stderr: "",
    });
    assert.deepEqual(await readFile(join(outDir, "checkpoint.png")), overlayBytes);
    assert.notDeepEqual(await readFile(join(outDir, "checkpoint.png")), pngBytes);
    assert.ok(copied.some((path) => path.endsWith("frames/003.png")));
    assert.equal(
      copied.some((path) => path.endsWith("frames/004.png")),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeRunOutDir listed destIdentity leftover Close 004 cannot fill dest checkpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-cli-out-listed-004-"));
  const runDir = join(root, "job-run");
  const outDir = join(root, "out");
  try {
    await mkdir(join(runDir, "frames"), { recursive: true });
    await writeFile(join(runDir, "frames", "003.png"), overlayBytes);
    await writeFile(join(runDir, "frames", "004.png"), pngBytes);
    await writeRunOutDir({
      dir: outDir,
      envelope: {
        type: "result",
        ok: true,
        result: {
          job: {
            id: "4b93702b-listed-004",
            resources: { runDir },
            destIdentity: [
              { path: "frames/003.png", caption: "Observe" },
              { path: "frames/004.png", caption: "Close" },
            ],
          },
        },
      },
      stderr: "",
    });
    assert.deepEqual(await readFile(join(outDir, "checkpoint.png")), overlayBytes);
    assert.notDeepEqual(await readFile(join(outDir, "checkpoint.png")), pngBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeRunOutDir listed destIdentity leftover Transition executed cannot fill dest checkpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-cli-out-listed-transition-"));
  const runDir = join(root, "job-run");
  const outDir = join(root, "out");
  try {
    await mkdir(join(runDir, "frames"), { recursive: true });
    await writeFile(join(runDir, "frames", "003.png"), overlayBytes);
    await writeFile(join(runDir, "frames", "002.png"), pngBytes);
    await writeFile(join(runDir, "frames", "004.png"), pngBytes);
    await writeRunOutDir({
      dir: outDir,
      envelope: {
        type: "result",
        ok: true,
        result: {
          job: {
            id: "4b93702b-listed-transition",
            resources: { runDir },
            destIdentity: [
              { path: "frames/002.png", caption: "after · Transition executed" },
              { path: "frames/003.png", caption: "Observe" },
              {
                path: "frames/004.png",
                caption: "after · Inspect setup skipped — already on this view",
              },
            ],
          },
        },
      },
      stderr: "",
    });
    assert.deepEqual(await readFile(join(outDir, "checkpoint.png")), overlayBytes);
    assert.notDeepEqual(await readFile(join(outDir, "checkpoint.png")), pngBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeRunOutDir listed destIdentity opener Tap beside leftover Transition cannot fill checkpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-cli-out-listed-opener-"));
  const runDir = join(root, "job-run");
  const outDir = join(root, "out");
  try {
    await mkdir(join(runDir, "frames"), { recursive: true });
    await writeFile(join(runDir, "frames", "003.png"), overlayBytes);
    await writeFile(join(runDir, "frames", "001.png"), pngBytes);
    await writeFile(join(runDir, "frames", "002.png"), pngBytes);
    await writeRunOutDir({
      dir: outDir,
      envelope: {
        type: "result",
        ok: true,
        result: {
          job: {
            id: "e79b55ac-listed-opener",
            resources: { runDir },
            destIdentity: [
              { path: "frames/001.png", caption: "before · Tap identifier sidebar.open.button" },
              { path: "frames/002.png", caption: "after · Transition executed" },
              { path: "frames/003.png", caption: "step:step-action:Sidebar open-close" },
            ],
          },
        },
      },
      stderr: "",
    });
    assert.deepEqual(await readFile(join(outDir, "checkpoint.png")), overlayBytes);
    assert.notDeepEqual(await readFile(join(outDir, "checkpoint.png")), pngBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeRunOutDir unphased leftover Transition executed cannot fill per-job dest PNGs", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-cli-out-unphased-transition-"));
  const runDir = join(root, "job-run");
  const outDir = join(root, "out");
  try {
    await mkdir(join(runDir, "frames"), { recursive: true });
    await writeFile(join(runDir, "frames", "002.png"), pngBytes);
    await writeFile(join(runDir, "frames", "003.png"), overlayBytes);
    await writeFile(join(runDir, "frames", "004.png"), pngBytes);
    const copied = await writeRunOutDir({
      dir: outDir,
      envelope: {
        type: "result",
        ok: true,
        result: {
          job: {
            id: "unphased-transition-pngs",
            resources: { runDir },
            frames: [
              { path: "frames/002.png", caption: "after · Transition executed" },
              { path: "frames/003.png", caption: "Observe" },
              {
                path: "frames/004.png",
                caption: "after · Inspect setup skipped — already on this view",
              },
            ],
            artifacts: [],
          },
        },
      },
      stderr: "",
    });
    assert.deepEqual(await readFile(join(outDir, "checkpoint.png")), overlayBytes);
    assert.ok(copied.some((path) => path.endsWith("frames/003.png")));
    assert.equal(
      copied.some((path) => path.endsWith("frames/002.png")),
      false,
    );
    assert.equal(
      copied.some((path) => path.endsWith("frames/004.png")),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeRunOutDir unphased Android dest-wait with no leftover caption keeps every PNG", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-cli-out-android-keep-"));
  const runDir = join(root, "job-run");
  const outDir = join(root, "out");
  try {
    await mkdir(join(runDir, "frames"), { recursive: true });
    await writeFile(join(runDir, "frames", "001.png"), pngBytes);
    await writeFile(join(runDir, "frames", "002.png"), overlayBytes);
    const copied = await writeRunOutDir({
      dir: outDir,
      envelope: {
        type: "result",
        ok: true,
        result: {
          job: {
            id: "android-r368-keep",
            resources: { runDir },
            frames: [
              { path: "frames/001.png", caption: "after · Reach home" },
              { path: "frames/002.png", caption: "Observe" },
            ],
            artifacts: [],
          },
        },
      },
      stderr: "",
    });
    assert.ok(copied.some((path) => path.endsWith("frames/001.png")));
    assert.ok(copied.some((path) => path.endsWith("frames/002.png")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeRunOutDir reads dest wait-for from run.json when the job summary omitted artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-cli-out-summarized-"));
  const runDir = join(root, "job-run");
  const outDir = join(root, "out");
  try {
    await mkdir(join(runDir, "frames"), { recursive: true });
    await writeFile(join(runDir, "frames", "003.png"), overlayBytes);
    await writeFile(join(runDir, "frames", "004.png"), pngBytes);
    await writeFile(
      join(runDir, "run.json"),
      JSON.stringify({
        id: "4b93702b-summarized",
        frames: [
          { path: "frames/003.png", caption: "step:step-observe:Observe" },
          { path: "frames/004.png", caption: "after · Run saved Test" },
        ],
        artifacts: [
          {
            kind: "capture-review",
            data: {
              caption: "step:step-observe:Observe",
              framePath: "frames/003.png",
              phase: "dest",
              policy: "fast",
            },
          },
        ],
      }),
    );
    await writeRunOutDir({
      dir: outDir,
      envelope: {
        type: "result",
        ok: true,
        result: {
          job: {
            id: "4b93702b-summarized",
            status: "ok",
            frameCount: 4,
            artifactCount: 30,
            resources: { runDir },
          },
        },
      },
      stderr: "",
    });
    assert.deepEqual(await readFile(join(outDir, "checkpoint.png")), overlayBytes);
    assert.notDeepEqual(await readFile(join(outDir, "checkpoint.png")), pngBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
