import { createRequire } from "node:module";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const runtimeRoot = resolve(repositoryRoot, "packages/runtime");
const runtimeBuild = spawnSync(process.execPath, [resolve(runtimeRoot, "scripts/build.mjs")], {
  cwd: runtimeRoot,
  stdio: "inherit",
});
if (runtimeBuild.status !== 0) process.exit(runtimeBuild.status ?? 1);

const require = createRequire(resolve(packageRoot, "package.json"));
const { build } = (() => {
  try {
    return require("esbuild");
  } catch {
    return createRequire(resolve(runtimeRoot, "package.json"))("esbuild");
  }
})();
const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));

const aliases = {
  name: "relay-workspace-source",
  setup(context) {
    context.onResolve({ filter: /^@relay\// }, async ({ path }) => {
      const [name, ...parts] = path.slice("@relay/".length).split("/");
      const root = resolve(repositoryRoot, "packages", name);
      const definition = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
      const key = parts.length ? `./${parts.join("/")}` : ".";
      const entry = definition.exports?.[key];
      const exported = typeof entry === "string" ? entry : entry?.import;
      if (!exported) throw new Error(`Unresolved workspace entry: ${path}`);
      return { path: resolve(root, exported) };
    });
  },
};

const dist = resolve(packageRoot, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  absWorkingDir: packageRoot,
  entryPoints: { relay: "src/index.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: Object.keys(manifest.dependencies).flatMap((name) => [name, `${name}/*`]),
  plugins: [aliases],
  banner: {
    js: "import {createRequire as __relayCreateRequire} from 'node:module';const require=__relayCreateRequire(import.meta.url);",
  },
  legalComments: "eof",
  logLevel: "info",
});

const executable = resolve(dist, "relay.js");
const bundled = await readFile(executable, "utf8");
await writeFile(executable, `#!/usr/bin/env node\n${bundled.replace(/^#!.*\n/u, "")}`);
await chmod(executable, 0o755);

const runtimeDist = resolve(dist, "runtime");
await mkdir(runtimeDist, { recursive: true });
for (const file of [
  "server.js",
  "startup.js",
  "manifest.json",
  "screenshot-analysis-worker.cjs",
]) {
  await cp(resolve(runtimeRoot, "dist", file), resolve(runtimeDist, file));
}
await cp(resolve(runtimeRoot, "dist/agent-device"), resolve(runtimeDist, "agent-device"), {
  recursive: true,
  filter: (source) => !source.endsWith(".idsig") && !source.split("/").includes(".build"),
});
