import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const IOS_SAFE_PREVIEW_PRODUCER_ENV = "RELAY_IOS_PREVIEW_PRODUCER_BIN";

function repositoryRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

export function defaultIosPreviewProducerPath(root = repositoryRoot()): string {
  return join(root, ".relay", "bin", "relay-ios-preview");
}

export function safeIosPreviewProducerMissingMessage(path: string): string {
  return [
    "Safe iOS preview producer is unavailable or not executable.",
    `Run \`pnpm ios-preview:build\` once, or set ${IOS_SAFE_PREVIEW_PRODUCER_ENV} to a reviewed producer binary.`,
    `Expected: ${path}`,
    "Relay will not fall back to go-ios `screenshot --stream` because its upstream HTTP fanout is unsafe.",
  ].join(" ");
}

/**
 * Resolve only Relay's reviewed, pixel-only producer. This intentionally does
 * not accept the regular go-ios binary as a fallback: that binary's
 * `screenshot --stream` server owns an unsafe, unbounded HTTP fanout.
 */
export async function resolveSafeIosPreviewProducer(
  options: {
    env?: NodeJS.ProcessEnv;
    root?: string;
    accessible?: (path: string) => Promise<void>;
  } = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const configured = env[IOS_SAFE_PREVIEW_PRODUCER_ENV]?.trim();
  const path = configured || defaultIosPreviewProducerPath(options.root);
  try {
    await (options.accessible ?? ((candidate) => access(candidate, constants.X_OK)))(path);
    return path;
  } catch {
    throw new Error(safeIosPreviewProducerMissingMessage(path));
  }
}

/** The sidecar understands only pixels and tunnel lookup; it has no input API. */
export function safeIosPreviewProducerArgs(
  serial: string,
  tunnelInfoArgs: readonly string[],
): string[] {
  return ["--udid", serial, ...tunnelInfoArgs];
}
