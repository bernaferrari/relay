import { chmod, copyFile, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
//
// The direct model provider SDKs stay external even though nothing imports
// them statically: core lazy-loads one through a dynamic import() only when a
// model-driven goal session runs in this process and resolution picks that
// provider. Bundling them would force every host to download every provider
// for a path most never hit; leaving them as runtime specifiers lets the
// sibling @relay/runtime install (which declares them as real dependencies)
// satisfy the import, and resolution failure degrades to a provider-unavailable
// decision instead of a startup crash because the imports are never eager.
// The OpenRouter stack predates multi-provider resolution and was always part
// of this bundle's self-contained baseline, so it stays bundled.
const external = [
  "@relay/runtime/*",
  "@modelcontextprotocol/server",
  "@modelcontextprotocol/server/*",
  "@ai-sdk/anthropic",
  "@ai-sdk/anthropic/*",
  "@ai-sdk/openai",
  "@ai-sdk/openai/*",
  "@ai-sdk/google",
  "@ai-sdk/google/*",
  "@ai-sdk/openai-compatible",
  "@ai-sdk/openai-compatible/*",
  "playwright-core",
  "pngjs",
  "yaml",
  "zod",
  "zod/*",
  "fsevents",
  "chromium-bidi/*",
];

function assertNoAgentDeviceInputs(metafile) {
  const offenders = Object.keys(metafile.inputs).filter((input) => {
    const path = input.replaceAll("\\", "/");
    return (
      path.startsWith("vendor/agent-device/") ||
      path.includes("/vendor/agent-device/") ||
      path.startsWith("node_modules/agent-device/") ||
      path.includes("/node_modules/agent-device/") ||
      path.includes("/node_modules/.pnpm/agent-device@")
    );
  });
  if (offenders.length > 0) {
    throw new Error(
      `MCP bundle must not include agent-device device-driver code; remove these inputs: ${offenders.join(", ")}`,
    );
  }
}

// Direct provider SDKs are lazy runtime specifiers in this bundle (see the
// external list above), never embedded chunks. Segment-exact matching keeps
// @ai-sdk/openai from shadowing @ai-sdk/openai-compatible. The shared ai
// core, @ai-sdk/provider* support libraries and the OpenRouter provider are
// not listed here: they belong to the self-contained baseline this package
// has always shipped, so they remain bundled on purpose.
const MODEL_PROVIDER_SDK_INPUT =
  /(?:^|\/)node_modules\/@ai-sdk\/(?:anthropic|openai|openai-compatible|google)(?:\/|$)/u;

function assertNoModelProviderSdkInputs(metafile) {
  const offenders = Object.keys(metafile.inputs).filter((input) =>
    MODEL_PROVIDER_SDK_INPUT.test(input.replaceAll("\\", "/")),
  );
  if (offenders.length > 0) {
    throw new Error(
      `MCP bundle must not embed direct model provider SDKs; they are lazy runtime specifiers resolved beside the install. Keep them external and remove these inputs: ${offenders.join(", ")}`,
    );
  }
}

await rm(dist, { recursive: true, force: true });
const nodeBuild = await build({
  absWorkingDir: packageRoot,
  entryPoints: {
    "relay-mcp": "src/index.ts",
    "relay-proof-doctor": "src/doctor-cli.ts",
    "relay-mcp-bridge": "src/bridge.ts",
    config: "src/config.ts",
    prompts: "src/prompts.ts",
    "doctor-lib": "src/doctor.ts",
    server: "src/server.ts",
    tools: "src/tools.ts",
  },
  outdir: dist,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
  splitting: true,
  external,
  plugins: [workspaceAliasPlugin],
  logLevel: "info",
  legalComments: "eof",
  metafile: true,
});
assertNoAgentDeviceInputs(nodeBuild.metafile);
assertNoModelProviderSdkInputs(nodeBuild.metafile);
for (const [source, target] of [
  ["server-public.d.ts", "server.d.ts"],
  ["config-public.d.ts", "config.d.ts"],
  ["prompts-public.d.ts", "prompts.d.ts"],
  ["doctor-public.d.ts", "doctor.d.ts"],
  ["tools-public.d.ts", "tools.d.ts"],
  ["operation-id.d.ts", "operation-id.d.ts"],
]) {
  await copyFile(join(packageRoot, "src", source), join(dist, target));
}
const executables = new Set(["relay-mcp.js", "relay-proof-doctor.js", "relay-mcp-bridge.js"]);
for (const file of await readdir(dist)) {
  if (!file.endsWith(".js")) continue;
  const path = join(dist, file);
  const source = await readFile(path, "utf8");
  const withoutShebang = source.replace(/^(?:#![^\n]*\n)+/u, "");
  await writeFile(
    path,
    executables.has(file) ? `#!/usr/bin/env node\n${withoutShebang}` : withoutShebang,
  );
  if (executables.has(file)) await chmod(path, 0o755);
}

const panel = await build({
  absWorkingDir: packageRoot,
  entryPoints: ["panel/view.ts"],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  write: false,
});
const template = await readFile(join(packageRoot, "panel/template.html"), "utf8");
const browserSource = panel.outputFiles[0].text.replaceAll("</script", "<\\/script");
await writeFile(
  join(dist, "relay-panel.html"),
  template.replace("/* RELAY_PANEL_SCRIPT */", () => browserSource),
);
