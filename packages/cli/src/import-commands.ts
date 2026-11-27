import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { readFileSync } from "node:fs";
import type { ParsedTokens } from "./cli-argv.js";
import { callerCwd } from "./caller-cwd.js";
import { commandPath as path, type CommandPathDescriptor } from "./command-descriptors.js";
import { classifyError, ExitCode, UsageError } from "./errors.js";
import { table } from "./everyday-format.js";
import { convertMaestroFlow } from "./import-maestro.js";
import { convertPlaywrightSpec } from "./import-playwright.js";
import type { ConvertedImportTest, ImportFormat, ImportOverrides } from "./import-shared.js";
import { CliOutput, type OutputStreams } from "./output.js";

export const importMaestroCommandPath: CommandPathDescriptor = path(
  "import maestro",
  ["path"],
  undefined,
  {
    summary: "Convert Maestro YAML flows into Relay test files",
    argumentHelp: [
      { name: "path", type: "file | folder", description: "Maestro YAML flow file or folder" },
    ],
    inputHelp: [
      {
        name: "app",
        type: "string",
        description: "Relay App override when appId is not the App name",
      },
      { name: "url", type: "string", description: "Website override or base for a web flow" },
      { name: "name", type: "string", description: "Test name override for one imported file" },
    ],
    examples: [
      "relay import maestro maestro/checkout.yaml",
      "relay import maestro maestro --out .relay/tests",
      "relay import maestro checkout.yaml --dry-run",
    ],
    note: "Unsupported commands are never dropped quietly; they are listed in warning comments at the top of the output.",
  },
);

export const importPlaywrightCommandPath: CommandPathDescriptor = path(
  "import playwright",
  ["path"],
  undefined,
  {
    summary: "Best-effort conversion of Playwright TS/JS tests into Relay test files",
    argumentHelp: [
      { name: "path", type: "file | folder", description: "Playwright spec file or folder" },
    ],
    inputHelp: [
      { name: "url", type: "string", description: "Base URL for relative page.goto calls" },
      { name: "app", type: "string", description: "Existing Relay App when no URL can be found" },
      { name: "name", type: "string", description: "Test name override for one imported test" },
    ],
    examples: [
      "relay import playwright tests/checkout.spec.ts",
      'relay import playwright tests --out .relay/tests --input \'{"url":"https://shop.example"}\'',
      "relay import playwright checkout.spec.ts --dry-run",
    ],
    note: "This is intentionally partial. Only static, high-confidence actions and checks are extracted; everything else is listed in warning comments.",
  },
);

export const importCommandDescriptors: readonly CommandPathDescriptor[] = [
  importMaestroCommandPath,
  importPlaywrightCommandPath,
];

export type ResolvedImportCommand = {
  format: ImportFormat;
  sourcePath: string;
  outDir: string;
  dryRun: boolean;
  overrides: ImportOverrides;
  commandPath: string;
};

function parseJsonObject(raw: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new UsageError("--input must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UsageError("--input must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function readImportInput(tokens: ParsedTokens, env: Record<string, string | undefined>) {
  const inline = tokens.values.get("--input");
  const file = tokens.values.get("--input-file");
  if (inline !== undefined && file !== undefined) {
    throw new UsageError("Use only one of --input or --input-file");
  }
  if (file !== undefined) {
    const inputPath = isAbsolute(file) ? file : resolve(callerCwd(env), file);
    let contents: string;
    try {
      contents = readFileSync(inputPath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new UsageError(`Could not read --input-file ${file}: ${message}`);
    }
    return parseJsonObject(contents);
  }
  return inline === undefined ? {} : parseJsonObject(inline);
}

function optionalText(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new UsageError(`input ${key} must be non-empty text`);
  }
  return value.trim();
}

/** Local import resolution deliberately mirrors friendly operation commands:
 * declared positionals are merged over --input fields, never the reverse. */
export function resolveImportTokens(
  tokens: ParsedTokens,
  env: Record<string, string | undefined> = process.env,
): ResolvedImportCommand {
  const [family, format, positionalPath, ...extra] = tokens.positionals;
  if (family !== "import")
    throw new UsageError("Expected: relay import <maestro|playwright> <path>");
  if (format !== "maestro" && format !== "playwright") {
    throw new UsageError("Expected: relay import <maestro|playwright> <path>");
  }
  if (!positionalPath || extra.length) {
    throw new UsageError(`import ${format} requires <path>`);
  }
  const input = readImportInput(tokens, env);
  const allowed = new Set(["path", "out", "app", "url", "name"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new UsageError(
      `Unknown input field${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}. Use path, out, app, url, name.`,
    );
  }
  const inputPath = optionalText(input, "path");
  const out = tokens.values.get("--out") ?? optionalText(input, "out") ?? ".relay/tests";
  if (!out.trim()) throw new UsageError("--out requires a directory");
  return {
    format,
    sourcePath: positionalPath ?? inputPath!,
    outDir: out.trim(),
    dryRun: tokens.switches.has("--dry-run"),
    overrides: {
      ...(optionalText(input, "app") ? { app: optionalText(input, "app")! } : {}),
      ...(optionalText(input, "url") ? { url: optionalText(input, "url")! } : {}),
      ...(optionalText(input, "name") ? { name: optionalText(input, "name")! } : {}),
    },
    commandPath: `import ${format}`,
  };
}

const YAML_FILE = new Set([".yaml", ".yml"]);
const SCRIPT_FILE = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);

async function walkFiles(root: string, accept: (name: string) => boolean): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (accept(entry.name)) found.push(full);
    }
  };
  await walk(root);
  return found.sort();
}

async function sourcePaths(cwd: string, format: ImportFormat, value: string): Promise<string[]> {
  const root = resolve(cwd, value);
  const info = await stat(root).catch(() => undefined);
  if (!info) throw new UsageError(`No file or folder at ${value}`);
  if (info.isFile()) {
    const extension = extname(root).toLowerCase();
    if (format === "maestro" && !YAML_FILE.has(extension)) {
      throw new UsageError(`${value} is not a Maestro YAML file`);
    }
    if (format === "playwright" && !SCRIPT_FILE.has(extension)) {
      throw new UsageError(`${value} is not a Playwright TS or JS file`);
    }
    return [root];
  }
  const found = await walkFiles(root, (name) => {
    const extension = extname(name).toLowerCase();
    if (format === "maestro") return YAML_FILE.has(extension);
    return SCRIPT_FILE.has(extension) && /\.(?:spec|test)\.[^.]+$/u.test(name);
  });
  if (!found.length) {
    throw new UsageError(
      format === "maestro"
        ? `No Maestro .yaml flow files in ${value}`
        : `No Playwright spec or test files in ${value}`,
    );
  }
  return found;
}

function displayPath(cwd: string, fullPath: string): string {
  return relative(cwd, fullPath) || fullPath;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function allocateOutputs(
  outRoot: string,
  tests: readonly ConvertedImportTest[],
): Promise<Map<ConvertedImportTest, { file: string; renamed: boolean }>> {
  const reserved = new Set<string>();
  const allocated = new Map<ConvertedImportTest, { file: string; renamed: boolean }>();
  for (const test of tests) {
    const stem = test.outputFileName.replace(/\.yaml$/u, "");
    for (let suffix = 1; ; suffix += 1) {
      const candidate = suffix === 1 ? `${stem}.yaml` : `${stem}-${suffix}.yaml`;
      const key = candidate.toLowerCase();
      if (reserved.has(key)) continue;
      if (await exists(join(outRoot, candidate))) continue;
      reserved.add(key);
      allocated.set(test, { file: candidate, renamed: suffix > 1 });
      break;
    }
  }
  return allocated;
}

export type ImportRunResult = {
  format: ImportFormat;
  dryRun: boolean;
  outDir: string;
  files: Array<{
    source: string;
    output: string;
    name: string;
    steps: number;
    warnings: string[];
    written: boolean;
    renamed: boolean;
    yaml: string;
  }>;
};

async function convertSources(
  cwd: string,
  resolved: ResolvedImportCommand,
): Promise<Array<{ converted: ConvertedImportTest; source: string }>> {
  const sources = await sourcePaths(cwd, resolved.format, resolved.sourcePath);
  if (resolved.overrides.name && sources.length > 1) {
    throw new UsageError("input name is only valid when importing one file");
  }
  const converted: Array<{ converted: ConvertedImportTest; source: string }> = [];
  for (const source of sources) {
    const text = await readFile(source, "utf8");
    const sourceName = displayPath(cwd, source);
    const fileName = source.split(/[\\/]/u).at(-1)!;
    const options = {
      source: text,
      sourceName,
      fileName,
      overrides: resolved.overrides,
    };
    const tests =
      resolved.format === "maestro"
        ? [convertMaestroFlow(options)]
        : convertPlaywrightSpec(options);
    for (const test of tests) converted.push({ converted: test, source: sourceName });
  }
  return converted;
}

export async function executeImportCommand(
  cwd: string,
  resolved: ResolvedImportCommand,
): Promise<ImportRunResult> {
  const converted = await convertSources(cwd, resolved);
  if (!converted.length) throw new UsageError("No tests could be imported");
  if (resolved.overrides.name && converted.length > 1) {
    throw new UsageError("input name is only valid when one test is imported");
  }
  const outRoot = resolve(cwd, resolved.outDir);
  const tests = converted.map(({ converted: test }) => test);
  const allocation = await allocateOutputs(outRoot, tests);
  if (!resolved.dryRun) await mkdir(outRoot, { recursive: true });
  const files: ImportRunResult["files"] = [];
  for (const item of converted) {
    const output = allocation.get(item.converted)!;
    const fullOutput = join(outRoot, output.file);
    if (!resolved.dryRun) {
      await writeFile(fullOutput, item.converted.yaml, { encoding: "utf8", flag: "wx" });
    }
    files.push({
      source: item.source,
      output: displayPath(cwd, fullOutput),
      name: item.converted.name,
      steps: item.converted.stepCount,
      warnings: item.converted.warnings,
      written: !resolved.dryRun,
      renamed: output.renamed,
      yaml: item.converted.yaml,
    });
  }
  return {
    format: resolved.format,
    dryRun: resolved.dryRun,
    outDir: resolved.outDir,
    files,
  };
}

function formatImportResult(result: ImportRunResult): string {
  if (result.dryRun) return result.files.map((file) => file.yaml.trimEnd()).join("\n---\n");
  const noun = result.format === "maestro" ? "Maestro" : "Playwright";
  const rows = result.files.map((file) => [
    file.output,
    file.name,
    file.steps,
    file.warnings.length,
    file.renamed ? "suffix added" : "",
  ]);
  const lines = [
    `Imported ${result.files.length} ${noun} test${result.files.length === 1 ? "" : "s"} into ${result.outDir}`,
    "",
    table(["FILE", "TEST", "STEPS", "WARNINGS", "NOTE"], rows),
  ];
  if (result.files.some((file) => file.warnings.length)) {
    lines.push("", "Warnings are written at the top of each file.");
  }
  lines.push("", `Apply them: relay apply ${result.outDir}`);
  return lines.join("\n");
}

/** Import has its own tiny tokenizer because --dry-run is intentionally not a
 * global Relay option and the global tokenizer would reject it before dispatch. */
function tokenizeImport(argv: readonly string[]): ParsedTokens {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const valueFlags = new Set(["--input", "--input-file", "--out"]);
  const switchFlags = new Set(["--json", "--ndjson", "--quiet", "--dry-run", "--help", "-h"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const name = equals >= 0 ? token.slice(0, equals) : token;
    if (switchFlags.has(name)) {
      if (equals >= 0) throw new UsageError(`${name} does not take a value`);
      switches.add(name);
      continue;
    }
    if (!valueFlags.has(name)) throw new UsageError(`Unknown option for relay import: ${name}`);
    const value = equals >= 0 ? token.slice(equals + 1) : argv[++index];
    if (!value || value.startsWith("--")) throw new UsageError(`${name} requires a value`);
    values.set(name, value);
  }
  return { positionals, values, switches };
}

function assertImportFlags(tokens: ParsedTokens): void {
  const values = new Set(["--input", "--input-file", "--out"]);
  const switches = new Set(["--json", "--ndjson", "--quiet", "--dry-run", "--help", "-h"]);
  for (const flag of tokens.values.keys()) {
    if (!values.has(flag)) throw new UsageError(`${flag} is not an option of relay import`);
  }
  for (const flag of tokens.switches) {
    if (!switches.has(flag)) throw new UsageError(`${flag} is not an option of relay import`);
  }
  if (tokens.switches.has("--json") && tokens.switches.has("--ndjson")) {
    throw new UsageError("Use only one of --json or --ndjson");
  }
}

export async function runImportCommand(
  argv: readonly string[],
  deps: {
    streams: OutputStreams;
    env: Record<string, string | undefined>;
  },
): Promise<number | undefined> {
  const mode = argv.includes("--json") ? "json" : argv.includes("--ndjson") ? "ndjson" : "human";
  const output = new CliOutput(mode, argv.includes("--quiet"), deps.streams);
  let tokens: ParsedTokens;
  try {
    tokens = tokenizeImport(argv);
  } catch (error) {
    if (!argv.includes("import")) return undefined;
    const classified = classifyError(error);
    output.error(classified, "local.import");
    return classified.exitCode;
  }
  if (tokens.positionals[0] !== "import") return undefined;
  if (tokens.switches.has("--help") || tokens.switches.has("-h")) return undefined;
  try {
    assertImportFlags(tokens);
    const resolved = resolveImportTokens(tokens, deps.env);
    const result = await executeImportCommand(callerCwd(deps.env), resolved);
    output.result("local.import", result, true, formatImportResult(result));
    return ExitCode.success;
  } catch (error) {
    const classified = classifyError(error);
    output.error(classified, "local.import");
    return classified.exitCode;
  }
}
