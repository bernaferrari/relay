/**
 * @grok-device/tui — interactive terminal UI for Grok device actions.
 *
 * Prefer in-process @grok-device/core. If `serverUrl` / `GROK_DEVICE_URL` is set
 * and the server is healthy, use HTTP instead.
 */
import { runApp } from "./app.js";

export type RunOptions = {
  serverUrl?: string;
};

function parseArgv(argv: string[]): RunOptions {
  const opts: RunOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--server-url" || a === "--url") {
      opts.serverUrl = argv[i + 1];
      i++;
      continue;
    }
    if (a.startsWith("--server-url=")) {
      opts.serverUrl = a.slice("--server-url=".length);
      continue;
    }
    if (a.startsWith("--url=")) {
      opts.serverUrl = a.slice("--url=".length);
      continue;
    }
  }
  return opts;
}

function normalizeOpts(input?: RunOptions | string[]): RunOptions {
  if (!input) return {};
  if (Array.isArray(input)) return parseArgv(input);
  return input;
}

/**
 * Launch the interactive TUI.
 *
 * Accepts either `{ serverUrl }` or a CLI argv list (as used by `@grok-device/cli`).
 */
export async function run(opts?: RunOptions | string[]): Promise<void> {
  const options = normalizeOpts(opts);
  await runApp(options);
}

/** Alias for CLI hosts that look for `main`. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  await run(argv);
}

export default main;

export { runApp } from "./app.js";
export { theme, ansi, palette, banner } from "./theme.js";
export { createClient, createHttpClient, createInProcessClient } from "./client.js";

/** Direct execution: `tsx packages/tui/src/index.ts` */
const isDirect =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/tui/src/index.ts") ||
    process.argv[1].endsWith("\\tui\\src\\index.ts") ||
    process.argv[1].includes("@grok-device/tui"));

if (isDirect) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`error: ${message}`);
    process.exit(1);
  });
}
