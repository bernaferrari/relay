#!/usr/bin/env tsx
/**
 * grok-device CLI
 *
 * Interactive:  grok-device
 * Direct:       grok-device <action> [--skip-account-switch] [--skip-restore-home]
 * Server:       grok-device serve [--port 8787]
 * TUI:          grok-device tui
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ACTIONS,
  HOME_ACCOUNT_MATCH,
  WORK_ACCOUNT_MATCH,
  createDevice,
  isActionId,
  runAction,
  type ActionId,
} from "@grok-device/core";
import { runInteractive } from "./interactive.js";

const DEFAULT_SERVE_PORT = 8787;

function usage(exitCode = 2): never {
  const actionLines = ACTIONS.map((a) => `  ${a.id.padEnd(22)} ${a.description}`).join("\n");

  console.log(`Usage:
  grok-device                              # interactive: device + action
  grok-device interactive | i               # same as no args
  grok-device <action> [flags]              # run action on default/env device
  grok-device serve [--port <n>] [--host <h>]
  grok-device tui                          # launch terminal UI (if installed)
  grok-device help | -h | --help

Actions:
${actionLines}

Flags (direct action mode):
  --skip-account-switch   Do not ensure/switch Play account before op
  --skip-restore-home     After alpha, do not restore gmail/home

Subcommands:
  serve                   Start local HTTP API (@grok-device/server)
    --port <n>            Listen port (default ${DEFAULT_SERVE_PORT})
    --host <h>            Bind host (default 127.0.0.1)
  tui                     Launch @grok-device/tui if available

Env:
  WORK_ACCOUNT_MATCH=${WORK_ACCOUNT_MATCH}
  HOME_ACCOUNT_MATCH=${HOME_ACCOUNT_MATCH}
  PROD_ACCOUNT_MATCH      required for *-prod
  AGENT_DEVICE_SERIAL     set by interactive picker / serve body
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
  console.log("  GET  /health");
  console.log("  GET  /actions");
  console.log("  GET  /devices");
  console.log("  POST /actions/:id/run");
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
  if (argv.length === 0 || argv[0] === "interactive" || argv[0] === "i") {
    await runInteractive();
    return;
  }

  const cmd = argv[0]!;
  if (cmd === "-h" || cmd === "--help" || cmd === "help") usage(0);

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
    console.error(
      "\nHint: agent-device devices --platform android && agent-device snapshot -i --platform android",
    );
    process.exit(1);
  });
}
