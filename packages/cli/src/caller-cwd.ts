import { statSync } from "node:fs";

type Environment = Record<string, string | undefined>;

/**
 * The directory the person typed `relay` in. `bin/relay` and `pnpm relay` both
 * run the CLI from the Relay checkout, so user paths (--out, --file, --output,
 * relay.json) must resolve against the caller's directory, not the process cwd.
 */
export function callerCwd(env: Environment = process.env): string {
  return env.RELAY_CALLER_CWD?.trim() || env.INIT_CWD?.trim() || process.cwd();
}

/** Make relative paths everywhere in this process resolve against the caller. */
export function enterCallerCwd(env: Environment = process.env): void {
  const target = callerCwd(env);
  try {
    if (target !== process.cwd() && statSync(target).isDirectory()) process.chdir(target);
  } catch {
    // A vanished or unreadable directory keeps the process cwd.
  }
}
