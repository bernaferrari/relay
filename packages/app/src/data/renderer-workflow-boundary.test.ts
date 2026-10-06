// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import type { BuildOptions, Metafile } from "../../../mcp/node_modules/esbuild";

const root = resolve(import.meta.dirname, "../../../..");
const requireFromMcp = createRequire(resolve(root, "packages/mcp/package.json"));
const { build } = requireFromMcp("esbuild") as typeof import("../../../mcp/node_modules/esbuild");
type PackageExports = Record<
  string,
  string | { browser?: string; import?: string; default?: string }
>;
const workspace = new Map<string, { directory: string; exports: PackageExports }>();
for (const entry of readdirSync(resolve(root, "packages"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = resolve(root, "packages", entry.name);
  const manifest = resolve(directory, "package.json");
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
    name: string;
    exports?: PackageExports;
  };
  workspace.set(pkg.name, { directory, exports: pkg.exports ?? {} });
}

function packageExport(exports: PackageExports, subpath: string): string | undefined {
  const direct = exports[subpath];
  if (direct)
    return typeof direct === "string"
      ? direct
      : (direct.browser ?? direct.import ?? direct.default);
  for (const [pattern, candidate] of Object.entries(exports)) {
    const wildcard = pattern.indexOf("*");
    if (wildcard < 0) continue;
    const prefix = pattern.slice(0, wildcard);
    const suffix = pattern.slice(wildcard + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const matched = subpath.slice(prefix.length, suffix ? -suffix.length : undefined);
    const target =
      typeof candidate === "string"
        ? candidate
        : (candidate.browser ?? candidate.import ?? candidate.default);
    return target?.replace("*", matched);
  }
  return undefined;
}

async function rendererGraph(
  entry: Pick<BuildOptions, "entryPoints" | "stdin">,
): Promise<Metafile> {
  const result = await build({
    ...entry,
    absWorkingDir: root,
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "esnext",
    jsx: "automatic",
    // Inspect the complete first-party runtime graph. Browser package internals
    // have their own export conditions; no vendor implementation is rewritten.
    packages: "external",
    loader: { ".css": "empty", ".svg": "dataurl" },
    write: false,
    metafile: true,
    logLevel: "silent",
    plugins: [
      {
        name: "renderer-workspace-exports",
        setup(context) {
          context.onResolve({ filter: /^@relay\// }, (args) => {
            const match = /^(@relay\/[^/]+)(.*)$/.exec(args.path)!;
            const pkg = workspace.get(match[1]!);
            if (!pkg) throw new Error(`Unknown renderer workspace package: ${args.path}`);
            const target = packageExport(pkg.exports, match[2] ? `.${match[2]}` : ".");
            if (!target) throw new Error(`Missing renderer workspace export: ${args.path}`);
            return { path: resolve(pkg.directory, target) };
          });
          context.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, external: true }));
        },
      },
    ],
  });
  return result.metafile!;
}

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/u, "")));
function hostDependency(specifier: string): boolean {
  return (
    builtins.has(specifier.replace(/^node:/u, "")) ||
    /^(playwright-core|agent-device)(?:\/|$)/u.test(specifier) ||
    /^packages\/(runtime|server|desktop)\//u.test(specifier)
  );
}

/** Metafile inputs include static imports, runtime re-exports and dynamic
 * imports, with type-only imports removed by esbuild's TypeScript transform. */
function hostDependencyChains(graph: Metafile): string[][] {
  const roots = Object.values(graph.outputs).flatMap((output) =>
    output.entryPoint ? [output.entryPoint] : [],
  );
  const queue = roots.map((entry) => [entry]);
  const seen = new Set<string>();
  const found = new Map<string, string[]>();
  for (let index = 0; index < queue.length; index++) {
    const chain = queue[index]!;
    const file = chain[chain.length - 1]!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const dependency of graph.inputs[file]?.imports ?? []) {
      const next = [...chain, dependency.path];
      if (hostDependency(dependency.path) && !found.has(dependency.path))
        found.set(dependency.path, next);
      if (!dependency.external) queue.push(next);
    }
  }
  return [...found.values()];
}

it("keeps the complete app workspace runtime graph free of Node and device host dependencies", async () => {
  const graph = await rendererGraph({ entryPoints: ["packages/app/src/entry.tsx"] });
  const hostImports = hostDependencyChains(graph);
  const details = hostImports.slice(0, 8).map((chain) => chain.join(" → "));
  if (hostImports.length > details.length)
    details.push(`Plus ${hostImports.length - details.length} more host dependency chains.`);
  expect(hostImports, details.join("\n")).toHaveLength(0);
});

it("detects host dependencies reached through a runtime Workflows barrel import", async () => {
  const graph = await rendererGraph({
    stdin: {
      contents: 'export { createGoalSessionRunner } from "@relay/workflows";',
      sourcefile: "renderer-host-fixture.ts",
      resolveDir: root,
      loader: "ts",
    },
  });
  const chains = hostDependencyChains(graph);
  expect(chains.some((chain) => chain[chain.length - 1] === "node:fs/promises")).toBe(true);
  expect(chains.some((chain) => chain[chain.length - 1] === "playwright-core")).toBe(true);
  expect(chains.some((chain) => chain.includes("packages/workflows/src/index.ts"))).toBe(true);
});
