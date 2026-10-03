import { createRequire } from "node:module";
import { readFile, mkdir, writeFile, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const require = createRequire(resolve(packageRoot, "package.json"));
const { build } = (() => {
  try {
    return require("esbuild");
  } catch {
    return createRequire(resolve(repositoryRoot, "packages/mcp/package.json"))("esbuild");
  }
})();
const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
const aliases = {
  name: "canonical-relay-workspace",
  setup(context) {
    context.onResolve({ filter: /^@relay\// }, async ({ path }) => {
      const [name, ...parts] = path.slice("@relay/".length).split("/");
      const root = resolve(repositoryRoot, "packages", name);
      const definition = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
      const entry = definition.exports[parts.length ? `./${parts.join("/")}` : "."];
      const exported = typeof entry === "string" ? entry : entry?.import;
      if (!exported) throw new Error(`Unresolved canonical workspace entry: ${path}`);
      return { path: resolve(root, exported) };
    });
  },
};
await mkdir(resolve(packageRoot, "dist"), { recursive: true });
await build({
  absWorkingDir: packageRoot,
  entryPoints: {
    "relay-runtime": "src/cli.mjs",
    server: "src/server-entry.mjs",
    demo: "src/demo.mjs",
    startup: "src/startup.mjs",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: Object.keys(manifest.dependencies).flatMap((name) => [name, `${name}/*`]),
  plugins: [aliases],
  banner: {
    js: "import {createRequire as __runtimeCreateRequire} from 'node:module';const require=__runtimeCreateRequire(import.meta.url);",
  },
  legalComments: "eof",
  metafile: true,
  logLevel: "info",
});
const cliPath = resolve(packageRoot, "dist/relay-runtime.js");
await writeFile(
  resolve(packageRoot, "dist/startup.d.ts"),
  await readFile(resolve(packageRoot, "src/startup.d.ts")),
);
await writeFile(cliPath, `#!/usr/bin/env node\n${await readFile(cliPath, "utf8")}`);
await chmod(cliPath, 0o755);
const server = await readFile(resolve(packageRoot, "dist/server.js"));
await writeFile(
  resolve(packageRoot, "dist/manifest.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      product: "relay",
      version: manifest.version,
      serverSha256: createHash("sha256").update(server).digest("hex"),
      qualified: ["browser"],
      nativeQualification:
        "Native runtime prerequisites and helpers require separate qualification.",
    },
    null,
    2,
  ),
);
