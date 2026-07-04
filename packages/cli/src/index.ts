#!/usr/bin/env tsx
/**
 * grok-device CLI — app testing host (PostHog/Uber bar).
 *
 *   grok-device                              # TTY → TUI workspace
 *   grok-device doctor
 *   grok-device run <action> [flags]
 *   grok-device <action> [flags]             # direct (compat)
 *   grok-device serve | tui | interactive
 */
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  ACTIONS,
  HOME_ACCOUNT_MATCH,
  WORK_ACCOUNT_MATCH,
  createDevice,
  formatJsonReport,
  isActionId,
  runAction,
  runDoctor,
  runJobSync,
  toJobReport,
  toJunitXml,
  type ActionId,
} from "@grok-device/core";
import { runInteractive } from "./interactive.js";

const DEFAULT_SERVE_PORT = 8787;

function usage(exitCode = 2): never {
  const actionLines = ACTIONS.map((a) => `  ${a.id.padEnd(22)} ${a.description}`).join("\n");

  console.log(`grok-device — Grok Android app testing

Usage:
  grok-device                              TTY → testing TUI (OpenCode-style)
  grok-device doctor                       Environment checks (exit 1 if any fail)
  grok-device run <action> [flags]         Run via job session (JSON / JUnit)
  grok-device <action> [flags]             Direct action (compat)
  grok-device serve [--port n] [--host h]  HTTP API
  grok-device tui [--server url]           Explicit TUI
  grok-device interactive | i              Classic readline picker
  grok-device help | -h | --help

Actions:
${actionLines}

run flags:
  --json                     Print JobReport JSON (with summary) to stdout
  --junit <path>             Write JUnit XML to path
  --serial <s>               Target device serial
  --skip-account-switch      Skip Play account ensure/switch
  --skip-restore-home        After alpha flows, do not restore home account

Direct action flags (compat):
  --skip-account-switch
  --skip-restore-home

serve:
  --port <n>                 Listen port (default ${DEFAULT_SERVE_PORT})
  --host <h>                 Bind host (default 127.0.0.1)

Env:
  WORK_ACCOUNT_MATCH=${WORK_ACCOUNT_MATCH}
  HOME_ACCOUNT_MATCH=${HOME_ACCOUNT_MATCH}
  PROD_ACCOUNT_MATCH         required for *-prod actions
  AGENT_DEVICE_SERIAL        default device serial
  GROK_DEVICE_RUNS_DIR       override runs/ directory
`);
  process.exit(exitCode);
}

function parseFlagValue(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = argv.indexOf(name);
  if (idx >= 0) return argv[idx + 1];
  return undefined;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

async function runDoctorCmd(): Promise<void> {
  const result = await runDoctor();
  for (const check of result.checks) {
    const mark = check.ok ? "ok  " : "FAIL";
    console.log(`[${mark}] ${check.id.padEnd(10)} ${check.message}`);
  }
  console.log(result.ok ? "\ndoctor: all checks passed" : "\ndoctor: one or more checks failed");
  process.exit(result.ok ? 0 : 1);
}

async function runActionViaJob(action: ActionId, argv: string[]): Promise<void> {
  const serial = parseFlagValue(argv, "--serial");
  const junitPath = parseFlagValue(argv, "--junit");
  const asJson = hasFlag(argv, "--json");
  const skipAccountSwitch = hasFlag(argv, "--skip-account-switch");
  const skipRestoreHome = hasFlag(argv, "--skip-restore-home");

  if (!asJson) {
    console.log(`→ run ${action}${serial ? ` @ ${serial}` : ""}`);
  }

  const job = await runJobSync({
    action,
    serial,
    skipAccountSwitch,
    skipRestoreHome,
  });
  const report = toJobReport(job);

  if (junitPath) {
    await writeFile(junitPath, toJunitXml([report]), "utf8");
    if (!asJson) console.log(`wrote junit → ${junitPath}`);
  }

  if (asJson) {
    process.stdout.write(formatJsonReport([report]));
  } else {
    const dur = report.durationMs != null ? `${(report.durationMs / 1000).toFixed(1)}s` : "?";
    const device =
      report.deviceName || report.serial ? ` · ${report.deviceName ?? report.serial}` : "";
    if (report.ok) {
      const tag = report.healed ? "HEALED" : "OK";
      console.log(`✓ ${tag} ${report.action}${device} (${dur})`);
      if (report.healMessage) console.log(`  ${report.healMessage}`);
      if (report.runDir) console.log(`  run → ${report.runDir}`);
    } else {
      console.error(
        `✗ FAIL ${report.action}${device} (${dur})${report.errorCode ? ` [${report.errorCode}]` : ""}`,
      );
      if (report.error) console.error(`  ${report.error}`);
      if (report.runDir) console.error(`  run → ${report.runDir}`);
    }
  }

  process.exit(report.ok ? 0 : 1);
}

async function runDirect(action: ActionId, argv: string[]): Promise<void> {
  const device = createDevice();
  const result = await runAction(device, action, {
    skipAccountSwitch: argv.includes("--skip-account-switch"),
    skipRestoreHome: argv.includes("--skip-restore-home"),
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
}

async function runServe(argv: string[]): Promise<void> {
  const portRaw = parseFlagValue(argv, "--port");
  const host = parseFlagValue(argv, "--host") ?? "127.0.0.1";
  const port = portRaw ? Number(portRaw) : DEFAULT_SERVE_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --port: ${portRaw}`);
  }

  const { startServer } = await import("@grok-device/server");
  const server = await startServer({ port, host });
  console.log(`grok-device server listening on http://${server.host}:${server.port}`);
  console.log("  GET  /health  /doctor  /meta  /events(SSE)");
  console.log("  GET  /report  /report/:id  /report/junit");
  console.log("  GET  /devices  /actions  /jobs  /snapshot  /screenshot  /runs");
  console.log("  POST /jobs  /actions/:id/run  /interact  /device/select");
  console.log("Press Ctrl+C to stop.");

  await new Promise<void>((resolve) => {
    const onSignal = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      void server.close().then(() => resolve());
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}

async function runTui(argv: string[]): Promise<void> {
  try {
    const mod = (await import("@grok-device/tui")) as {
      main?: (argv: string[]) => void | Promise<void>;
      default?: (argv: string[]) => void | Promise<void>;
      run?: (argv: string[]) => void | Promise<void>;
    };
    const entry = mod.main ?? mod.run ?? mod.default;
    if (typeof entry !== "function") {
      throw new Error(
        "@grok-device/tui loaded but has no main/run/default export. Check the package version.",
      );
    }
    await entry(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as NodeJS.ErrnoException)?.code;
    const isMissing =
      code === "ERR_MODULE_NOT_FOUND" ||
      /Cannot find (package|module)/i.test(message) ||
      /Failed to resolve/i.test(message);

    if (isMissing) {
      console.error(`error: @grok-device/tui is not installed or not built yet.
  Install/build the monorepo package, then retry:
    pnpm install
    grok-device tui

  Underlying error: ${message}`);
      process.exit(1);
    }
    throw err;
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  // OpenCode-style: bare launch in a TTY opens the testing workspace (TUI).
  // Use `interactive` / `i` for the classic readline picker.
  if (argv.length === 0) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      await runTui([]);
      return;
    }
    await runInteractive();
    return;
  }

  const cmd = argv[0]!;
  if (cmd === "-h" || cmd === "--help" || cmd === "help") usage(0);

  if (cmd === "doctor") {
    await runDoctorCmd();
    return;
  }

  if (cmd === "run") {
    const action = argv[1];
    if (!action || !isActionId(action)) {
      console.error(action ? `error: unknown action "${action}"` : "error: run requires <action>");
      usage(2);
    }
    await runActionViaJob(action, argv.slice(2));
    return;
  }

  if (cmd === "interactive" || cmd === "i") {
    await runInteractive();
    return;
  }

  if (cmd === "serve") {
    await runServe(argv.slice(1));
    return;
  }

  if (cmd === "tui") {
    await runTui(argv.slice(1));
    return;
  }

  if (!isActionId(cmd)) usage(2);

  await runDirect(cmd, argv.slice(1));
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`error: ${message}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    console.error("\nHint: grok-device doctor && agent-device devices --platform android");
    process.exit(1);
  });
}
