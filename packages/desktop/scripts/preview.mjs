import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareMacOSDevApp } from "./macos-dev-app.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const entry of ["out/main/index.js", "out/preload/index.js", "out/renderer-v2/index.html"]) {
  if (!existsSync(resolve(root, entry))) {
    throw new Error(
      `Build Relay before previewing: missing ${entry}. Run pnpm --filter @relay/desktop preview.`,
    );
  }
}
const electronCli = fileURLToPath(import.meta.resolve("electron/cli.js"));
const environment = {
  RELAY_DESKTOP_ROOT: root,
  RELAY_URL: process.env.RELAY_URL?.trim() || "http://127.0.0.1:8787",
  // A built preview must not inherit a stale development renderer URL.
  ELECTRON_RENDERER_URL: "",
  RELAY_DEBUG_PORT: "",
};
const executable =
  process.platform === "darwin"
    ? await prepareMacOSDevApp(electronCli, root, environment)
    : process.execPath;
console.log(
  `[desktop] opening ${process.platform === "darwin" ? resolve(root, "out/Relay.app") : "Relay"}`,
);
const child = spawn(executable, process.platform === "darwin" ? [] : [electronCli, root], {
  cwd: root,
  env: { ...process.env, ...environment, ELECTRON_RUN_AS_NODE: undefined },
  stdio: "inherit",
});
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
