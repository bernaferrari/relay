import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEVELOPER_ID_APPLICATION =
  /"((?:Developer ID Application):[^"\n]+?)\s*\(([A-Z0-9]{6,32})\)"/g;

const MISSING_DEVELOPER_ID =
  "A Developer ID Application identity is required to ship a signed operator build. Apple Development is not enough. Morning review stays on the Vite UI and local server until that identity exists.";

/**
 * Fail closed before electron-builder. Apple Development and ad-hoc signing
 * must not ship as an operator build.
 */
export function developerIdApplicationFromKeychain(output) {
  if (!output) throw new Error(MISSING_DEVELOPER_ID);
  for (const match of output.matchAll(DEVELOPER_ID_APPLICATION)) {
    const name = match[1]?.trim();
    if (name) return name;
  }
  throw new Error(MISSING_DEVELOPER_ID);
}

function codesigningIdentities() {
  const result = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() ||
        "security find-identity failed; cannot confirm a Developer ID Application identity.",
    );
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

export function resolveMacDistIdentity() {
  return developerIdApplicationFromKeychain(codesigningIdentities());
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  console.log(`[desktop] Developer ID Application ready: ${resolveMacDistIdentity()}`);
}
