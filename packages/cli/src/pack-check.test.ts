import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { ExitCode } from "./errors.js";
import { runCli } from "./index.js";

function capture() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk) => (out += String(chunk)));
  stderr.on("data", (chunk) => (err += String(chunk)));
  return { streams: { stdout, stderr }, stdout: () => out, stderr: () => err };
}

async function writeLocale(
  dir: string,
  name: string,
  body: Record<string, unknown>,
): Promise<void> {
  await writeFile(join(dir, "accessibility", name), `${JSON.stringify(body)}\n`);
}

test("relay pack check fails when a locale is missing a baseline slot", async () => {
  const io = capture();
  const dir = await mkdtemp(join(tmpdir(), "relay-pack-check-cli-"));
  await mkdir(join(dir, "accessibility"));
  try {
    await writeLocale(dir, "data-controls-en.json", {
      locale: "en",
      slots: {
        found: [
          { id: "grok_delete_account", label: "Delete Account" },
          { id: "grok_data_controls", label: "Data Controls" },
        ],
        complete: true,
      },
      strings: ["Delete Account", "Data Controls", "Grok"],
    });
    await writeLocale(dir, "data-controls-he.json", {
      locale: "he",
      slots: {
        found: [{ id: "grok_data_controls", label: "Data Controls" }],
        complete: false,
      },
      strings: ["Delete Account", "Data Controls", "Grok"],
    });

    const code = await runCli(["pack", "check", dir, "--against", "en", "--json"], {
      streams: io.streams,
      registerSignalHandlers: false,
      env: {},
    });

    assert.equal(code, ExitCode.validation);
    const report = JSON.parse(io.stdout()) as {
      ok: boolean;
      findings: Array<{ code: string; slotId?: string }>;
    };
    assert.equal(report.ok, false);
    assert.ok(
      report.findings.some(
        (finding) => finding.code === "missing-slot" && finding.slotId === "grok_delete_account",
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("relay pack check accepts --baseline as an alias of --against", async () => {
  const io = capture();
  const dir = await mkdtemp(join(tmpdir(), "relay-pack-check-baseline-"));
  await mkdir(join(dir, "accessibility"));
  try {
    await writeLocale(dir, "en.json", {
      locale: "en",
      slots: { found: [{ id: "grok_delete_account" }], complete: true },
      strings: ["Delete Account"],
    });
    const code = await runCli(["pack", "check", dir, "--baseline", "en", "--json"], {
      streams: io.streams,
      registerSignalHandlers: false,
      env: {},
    });
    assert.equal(code, ExitCode.success);
    assert.equal(JSON.parse(io.stdout()).ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
