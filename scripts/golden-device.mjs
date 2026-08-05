#!/usr/bin/env node
/**
 * Golden device path for local/CI smoke.
 *
 * Default behavior is honest skip when the Relay server is down or no ready
 * device is attached. Set GOLDEN_REQUIRE_DEVICE=1 to fail instead of skip.
 *
 * Env:
 *   RELAY_URL                 default http://127.0.0.1:8787
 *   GOLDEN_REQUIRE_DEVICE     "1" to require a ready device (fail otherwise)
 *   RELAY_GOLDEN_RECIPE       optional recipe id to run after doctor smoke
 *   GOLDEN_FETCH_TIMEOUT_MS   default 5000
 *   GOLDEN_CLI_TIMEOUT_MS     default 60000
 */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RELAY_URL = (process.env.RELAY_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const REQUIRE_DEVICE = process.env.GOLDEN_REQUIRE_DEVICE === "1";
const GOLDEN_RECIPE = process.env.RELAY_GOLDEN_RECIPE?.trim() || "";
const FETCH_TIMEOUT_MS = Number(process.env.GOLDEN_FETCH_TIMEOUT_MS ?? 5_000);
const CLI_TIMEOUT_MS = Number(process.env.GOLDEN_CLI_TIMEOUT_MS ?? 60_000);

const ACTOR_HEADERS = {
  "X-Relay-Actor-Id": "system:golden-device",
  "X-Relay-Actor-Kind": "system",
};

function log(line) {
  console.log(line);
}

function skip(reason) {
  log(`SKIP  ${reason}`);
  log(`golden: skip — ${reason}`);
  process.exit(0);
}

function fail(reason, detail) {
  log(`FAIL  ${reason}`);
  if (detail) log(detail);
  process.exit(1);
}

function pass(reason) {
  log(`PASS  ${reason}`);
}

async function fetchJson(path, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${RELAY_URL}${path}`, {
      headers: {
        ...ACTOR_HEADERS,
        "X-Relay-Request-Id": crypto.randomUUID(),
        "X-Relay-Operation-Id": path === "/doctor" ? "system.doctor.get" : "target.devices.list",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function isReadyDevice(device) {
  if (!device || typeof device !== "object") return false;
  if (device.platform === "browser" || device.targetKind === "browser") return false;
  if (device.booted === false) return false;
  if (device.connectionState === "unauthorized" || device.connectionState === "offline") {
    return false;
  }
  if (device.developerMode === "disabled") return false;
  if (device.developerServicesAvailable === false) return false;
  const serial = typeof device.serial === "string" ? device.serial.trim() : "";
  return serial.length > 0;
}

function runCli(args, timeoutMs = CLI_TIMEOUT_MS) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@relay/cli", "exec", "tsx", "src/index.ts", ...args],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          RELAY_URL,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref?.();
      resolvePromise({
        code: 124,
        stdout,
        stderr: `${stderr}\n[golden] CLI timed out after ${timeoutMs}ms`.trim(),
        timedOut: true,
      });
    }, timeoutMs);
    timer.unref?.();

    child.once("error", (error) => {
      clearTimeout(timer);
      resolvePromise({
        code: 1,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        timedOut: false,
      });
    });

    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({
        code: code ?? (signal ? 1 : 0),
        stdout,
        stderr,
        timedOut: false,
      });
    });
  });
}

function handleUnavailable(kind) {
  const message = kind === "server" ? "Relay server not running" : "no ready device attached";
  if (REQUIRE_DEVICE) {
    fail(message, `Set GOLDEN_REQUIRE_DEVICE=0 to allow skip (RELAY_URL=${RELAY_URL})`);
  }
  skip(message);
}

async function main() {
  log(`golden: probing ${RELAY_URL}`);

  let doctor;
  let devicesPayload;
  try {
    // Probe doctor first; unreachable server → skip/require.
    doctor = await fetchJson("/doctor");
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      handleUnavailable("server");
    }
    handleUnavailable("server");
    return;
  }

  try {
    devicesPayload = await fetchJson("/devices");
  } catch {
    handleUnavailable("server");
    return;
  }

  if (!devicesPayload.ok) {
    fail(
      `GET /devices returned HTTP ${devicesPayload.status}`,
      typeof devicesPayload.body === "object"
        ? JSON.stringify(devicesPayload.body, null, 2)
        : String(devicesPayload.body),
    );
  }

  const devices = Array.isArray(devicesPayload.body?.devices) ? devicesPayload.body.devices : [];
  const ready = devices.filter(isReadyDevice);

  if (ready.length === 0) {
    handleUnavailable("device");
    return;
  }

  const primary = ready[0];
  log(
    `golden: ready device ${primary.serial}${primary.name ? ` (${primary.name})` : ""}` +
      (ready.length > 1 ? ` +${ready.length - 1} more` : ""),
  );

  // Doctor may return 503 when toolchain checks fail; still surface the body.
  if (doctor.body && typeof doctor.body === "object") {
    const checks = Array.isArray(doctor.body.checks) ? doctor.body.checks : [];
    for (const check of checks) {
      const mark = check.ok ? "ok" : "fail";
      log(`  doctor[${mark}] ${check.id}: ${check.message}`);
    }
  } else if (!doctor.ok) {
    log(`  doctor HTTP ${doctor.status}`);
  }

  const doctorCli = await runCli(["system", "doctor", "--json"], Math.min(CLI_TIMEOUT_MS, 30_000));
  if (doctorCli.timedOut) {
    fail("CLI system doctor timed out", doctorCli.stderr);
  }
  if (doctorCli.code !== 0) {
    // Doctor is informative; with a ready device we still treat non-zero as soft
    // failure only when the CLI could not talk to the server.
    const combined = `${doctorCli.stdout}\n${doctorCli.stderr}`;
    if (/ECONNREFUSED|fetch failed|network|not running|ENOTFOUND/i.test(combined)) {
      fail("CLI system doctor could not reach Relay", combined.trim());
    }
    log("  note: CLI system doctor exited non-zero (continuing; device is ready)");
    if (doctorCli.stdout.trim()) log(doctorCli.stdout.trim());
    if (doctorCli.stderr.trim()) log(doctorCli.stderr.trim());
  } else {
    pass("CLI system doctor --json");
  }

  if (GOLDEN_RECIPE) {
    log(`golden: running recipe ${GOLDEN_RECIPE}`);
    const input = {
      serial: primary.serial,
      ...(primary.platform === "ios" || primary.platform === "android"
        ? { platform: primary.platform }
        : {}),
    };
    const recipeCli = await runCli(
      ["run", "start", GOLDEN_RECIPE, "--json", "--input", JSON.stringify(input)],
      CLI_TIMEOUT_MS,
    );
    if (recipeCli.stdout.trim()) log(recipeCli.stdout.trim());
    if (recipeCli.stderr.trim()) log(recipeCli.stderr.trim());
    if (recipeCli.timedOut) {
      fail(`recipe ${GOLDEN_RECIPE} timed out`, recipeCli.stderr);
    }
    if (recipeCli.code !== 0) {
      fail(`recipe ${GOLDEN_RECIPE} failed (exit ${recipeCli.code})`);
    }
    pass(`recipe ${GOLDEN_RECIPE}`);
  }

  pass(`golden device path (${ready.length} ready device${ready.length === 1 ? "" : "s"})`);
  process.exit(0);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
