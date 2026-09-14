import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveMacDistIdentity } from "./require-developer-id.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const identity = resolveMacDistIdentity();
const args = process.argv.slice(2);
if (args.length === 0) {
  throw new Error("sign-mac-dist requires electron-builder arguments, for example --mac dmg zip");
}

const env = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
};
const result = spawnSync(
  "pnpm",
  ["exec", "electron-builder", ...args, `--config.mac.identity=${identity}`],
  { cwd: desktopRoot, env, stdio: "inherit" },
);
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
