import { copyFile, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const dist = join(packageRoot, "dist");

const workspaceAliases = new Map([
  ["@relay/client", resolve(repositoryRoot, "packages/client/src/index.ts")],
  ["@relay/protocol", resolve(repositoryRoot, "packages/protocol/src/index.ts")],
  ["@relay/workflows", resolve(repositoryRoot, "packages/workflows/src/index.ts")],
  ["@relay/workflows/outcomes", resolve(repositoryRoot, "packages/workflows/src/outcome-jobs.ts")],
  [
    "@relay/workflows/task-guides",
    resolve(repositoryRoot, "packages/workflows/src/task-guides.ts"),
  ],
]);

const workspaceAliasPlugin = {
  name: "relay-workspace-aliases",
  setup(buildContext) {
    buildContext.onResolve(
      { filter: /^@relay\/(client|protocol|workflows)(\/(outcomes|task-guides))?$/ },
      (args) => {
        const target = workspaceAliases.get(args.path);
        return target ? { path: target } : undefined;
      },
    );
  },
};

// Relay's private workspace packages are deliberately bundled into one
// executable. Runtime integrations remain real npm dependencies so optional
// platform providers can keep their own install/loader behavior.
const external = [
  "@modelcontextprotocol/server",
  "@modelcontextprotocol/server/*",
  "playwright-core",
  "pngjs",
  "yaml",
  "zod",
  "zod/*",
  "fsevents",
  "chromium-bidi/*",
];

await rm(dist, { recursive: true, force: true });
await build({
  absWorkingDir: packageRoot,
  entryPoints: {
    "relay-mcp": "src/index.ts",
    "relay-proof-doctor": "src/doctor-cli.ts",
    "relay-mcp-bridge": "src/bridge.ts",
    config: "src/config.ts",
    prompts: "src/prompts.ts",
    "doctor-lib": "src/doctor.ts",
    server: "src/server.ts",
  },
  outdir: dist,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  external,
  plugins: [workspaceAliasPlugin],
  logLevel: "info",
  legalComments: "eof",
  banner: { js: "#!/usr/bin/env node" },
});
for (const [source, target] of [
  ["server-public.d.ts", "server.d.ts"],
  ["config-public.d.ts", "config.d.ts"],
  ["prompts-public.d.ts", "prompts.d.ts"],
  ["doctor-public.d.ts", "doctor.d.ts"],
  ["tools-public.d.ts", "tools.d.ts"],
]) {
  await copyFile(join(packageRoot, "src", source), join(dist, target));
}
for (const file of await readdir(dist)) {
  if (!file.endsWith(".js")) continue;
  const path = join(dist, file);
  const source = await readFile(path, "utf8");
  await writeFile(path, source.replace(/^(?:#![^\n]*\n)+/u, "#!/usr/bin/env node\n"));
}
