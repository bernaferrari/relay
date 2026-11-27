#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { appendFile, copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const resultsDirectory = join(workspace, ".relay-ci");
const resultsFile = join(resultsDirectory, "results.json");
const junitFile = join(resultsDirectory, "junit.xml");
const cliLogFile = join(resultsDirectory, "relay-cli.log");
const actionErrorFile = join(resultsDirectory, "action-error.txt");
const actionMetadataFile = join(resultsDirectory, "action-metadata.json");
const evidenceDirectory = join(resultsDirectory, "evidence");
const evidenceManifestFile = join(resultsDirectory, "evidence-manifest.json");

const outputs = [];

function output(name, value) {
  outputs.push([name, String(value)]);
}

async function flushOutputs() {
  const target = process.env.GITHUB_OUTPUT;
  if (!target || !outputs.length) return;
  const chunks = [];
  for (const [name, value] of outputs) {
    let delimiter = `relay-output-${Math.random().toString(36).slice(2)}`;
    while (value.includes(delimiter)) delimiter = `${delimiter}x`;
    chunks.push(`${name}<<${delimiter}\n${value}\n${delimiter}\n`);
  }
  await appendFile(target, chunks.join(""));
}

export function hasGlobMagic(value) {
  return ["*", "?", "[", "]", "{", "}"].some((character) => value.includes(character));
}

function generatedDirectory(candidate) {
  const parts = String(candidate).replaceAll("\\", "/").split("/");
  return parts.includes("node_modules") || parts.includes(".git");
}

function sanitizeFilePart(value, fallback = "test") {
  const sanitized = String(value)
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^\.+/, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (sanitized || fallback).slice(0, 100);
}

function shellQuote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * Resolve the action's file-or-glob input into the one positional file/folder
 * that `relay ci` currently accepts. Several matched files are copied into a
 * temporary folder because the CLI does not yet accept a glob or repeated file.
 */
export async function materializeTests(input, options = {}) {
  const cwd = resolve(options.cwd || process.cwd());
  const value = String(input || "").trim();
  if (!value) throw new Error("The tests input is empty.");

  if (!hasGlobMagic(value)) {
    const absolute = resolve(cwd, value);
    const info = await stat(absolute).catch(() => undefined);
    if (!info) throw new Error(`No test file or folder at ${value}`);
    return { argument: value, matched: [value], staged: false };
  }

  const byPath = new Map();
  try {
    for await (const match of glob(value, { cwd, exclude: generatedDirectory })) {
      const normalized = String(match).replaceAll("\\", "/");
      if (!/\.ya?ml$/iu.test(normalized)) continue;
      const absolute = resolve(cwd, normalized);
      const info = await stat(absolute).catch(() => undefined);
      if (info?.isFile()) byPath.set(normalized, { path: normalized, absolute });
    }
  } catch (error) {
    throw new Error(
      `Could not expand tests glob ${value}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const matched = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  if (!matched.length) throw new Error(`No .yaml or .yml test files match ${value}`);
  if (matched.length === 1) {
    return { argument: matched[0].path, matched: [matched[0].path], staged: false };
  }

  const stageDirectory = await mkdtemp(join(options.stageRoot || tmpdir(), "relay-tests-"));
  for (const [index, match] of matched.entries()) {
    const fileName = `${String(index + 1).padStart(3, "0")}-${sanitizeFilePart(
      basename(match.path),
    )}`;
    await copyFile(match.absolute, join(stageDirectory, fileName));
  }
  return {
    argument: stageDirectory,
    matched: matched.map((match) => match.path),
    staged: true,
    stageDirectory,
  };
}

export function relayPackageSpec(version) {
  const requested = String(version || "latest").trim() || "latest";
  if (requested === "latest") return "@relay/cli";
  if (requested.startsWith("@relay/cli")) return requested;
  return `@relay/cli@${requested.replace(/^@/u, "")}`;
}

// ---------------------------------------------------------------------------
// Relay CLI interface used by this action. Keep this block aligned with the
// published CLI; do not add flags here until `relay ci --help` supports them.
// Current source contract read from packages/cli/src/everyday-commands.ts:
//   relay ci [<app> | <folder of test files>]
//     [--device ios|android|browser|<name>]
//     [--output result.json] [--junit junit.xml]
//   relay export <runId> --out <directory>
// ---------------------------------------------------------------------------
function ciCommandArguments(testsArgument, device) {
  return [
    "ci",
    testsArgument,
    ...(device ? ["--device", device] : []),
    "--output",
    resultsFile,
    "--junit",
    junitFile,
  ];
}

function exportCommandArguments(runId, outputDirectory) {
  return ["export", runId, "--out", outputDirectory];
}
// ---------------------------------------------------------------------------

function commandLine(command, args) {
  return [command, ...args].map(shellQuote).join(" ");
}

function runCapture(command, args, options) {
  const echo = options.echo !== false;
  const includeStdout = options.includeStdout !== false;
  return new Promise((resolvePromise) => {
    const log = createWriteStream(options.logFile, { flags: "a" });
    log.write(`\n$ ${commandLine(command, args)}\n`);
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: process.env,
        shell: options.shell === true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.write(`could not start: ${message}\n`);
      log.end(() => resolvePromise({ code: 127, error: message }));
      return;
    }

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      log.end(() => resolvePromise(result));
    };
    const writeOutput = (chunk, stream, include) => {
      if (echo) stream.write(chunk);
      if (include) log.write(chunk);
    };
    child.stdout?.on("data", (chunk) => writeOutput(chunk, process.stdout, includeStdout));
    child.stderr?.on("data", (chunk) => writeOutput(chunk, process.stderr, true));
    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      log.write(`could not start: ${message}\n`);
      if (echo) process.stderr.write(`relay action: could not start ${command}: ${message}\n`);
      finish({ code: 127, error: message });
    });
    child.on("close", (code, signal) => {
      if (signal) log.write(`[terminated by ${signal}]\n`);
      finish({ code: code ?? 1, signal });
    });
  });
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function pathExists(path) {
  return Boolean(await stat(path).catch(() => undefined));
}

/**
 * Windows npm exposes npx as a cmd shim, which Node cannot safely spawn without
 * a shell. The installation beside node.exe contains the real npx entrypoint;
 * use it directly so every CLI argument remains an argument (never shell text).
 */
async function resolveNpxInvocation() {
  if (process.platform !== "win32") return { command: "npx", args: [] };
  const candidate = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (await pathExists(candidate)) return { command: process.execPath, args: [candidate] };
  return { command: "npx", args: [] };
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function verdictFromReport(report, exitCode) {
  if (!report || report.kind !== "relay-ci") return "error";
  const totals = report.totals || {};
  if (numberValue(totals.failed) > 0) return "failed";
  if (numberValue(totals.blocked) > 0) return "blocked";
  if (numberValue(totals.cancelled) > 0) return "cancelled";
  if (numberValue(totals.pendingReview) > 0) return "review-required";
  if (numberValue(totals.passed) > 0) return "passed";
  return exitCode === 0 ? "passed" : "blocked";
}

async function tailText(path, maxCharacters = 4_000) {
  try {
    const text = await readFile(path, "utf8");
    return text.length > maxCharacters ? text.slice(-maxCharacters) : text;
  } catch {
    return "";
  }
}

async function writeEvidenceManifest(entries) {
  await writeFile(evidenceManifestFile, `${JSON.stringify(entries, null, 2)}\n`);
}

async function exportEvidence(report, packageSpec, npx, cwd) {
  const verdicts = Array.isArray(report?.verdicts) ? report.verdicts : [];
  const runs = [];
  const seen = new Set();
  for (const verdict of verdicts) {
    const runId = typeof verdict?.runId === "string" ? verdict.runId : "";
    if (!runId || seen.has(runId)) continue;
    seen.add(runId);
    runs.push({
      runId,
      title: typeof verdict?.title === "string" ? verdict.title : runId,
      status: typeof verdict?.status === "string" ? verdict.status : "unknown",
    });
  }

  const entries = [];
  for (const [index, run] of runs.entries()) {
    const label = sanitizeFilePart(run.title, "run").slice(0, 48);
    const shortRunId = sanitizeFilePart(run.runId, "run").slice(0, 12);
    const folder = `${String(index + 1).padStart(2, "0")}-${label}-${shortRunId}`;
    const outputDirectory = join(evidenceDirectory, folder);
    const args = [
      ...npx.args,
      "-y",
      packageSpec,
      ...exportCommandArguments(run.runId, outputDirectory),
    ];
    // `relay export` prints the full evidence envelope on stdout even after
    // writing the files. That duplicates large screenshots into the log, so
    // stdout is consumed but not persisted; errors still come through stderr.
    const result = await runCapture(npx.command, args, {
      cwd,
      logFile: cliLogFile,
      echo: false,
      includeStdout: false,
    });
    const tracePack = join(outputDirectory, "trace-pack.json");
    const walkthrough = join(outputDirectory, "walkthrough.html");
    const files = [
      ...((await pathExists(tracePack)) ? ["trace-pack.json"] : []),
      ...((await pathExists(walkthrough)) ? ["walkthrough.html"] : []),
    ];
    entries.push({
      runId: run.runId,
      title: run.title,
      status: run.status,
      path: `evidence/${folder}`,
      exitCode: result.code,
      exported: files.includes("trace-pack.json") && files.includes("walkthrough.html"),
      files,
    });
  }
  await writeEvidenceManifest(entries);
  return entries;
}

async function writeActionError(message) {
  await writeFile(actionErrorFile, `${message.trim()}\n`);
}

function workflowWarning(message) {
  const escaped = String(message)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  process.stdout.write(`::warning::${escaped}\n`);
}

async function main() {
  await mkdir(resultsDirectory, { recursive: true });
  output("results-file", resultsFile);
  output("results-directory", resultsDirectory);

  try {
    const testsInput = process.env.RELAY_TESTS_INPUT || ".relay/tests/*.yaml";
    const relayVersion = process.env.RELAY_VERSION || "latest";
    const device = (process.env.RELAY_DEVICE || "").trim();
    const packageSpec = relayPackageSpec(relayVersion);
    const npx = await resolveNpxInvocation();
    const resolution = await materializeTests(testsInput, { cwd: workspace });

    const ciArgs = [
      ...npx.args,
      "-y",
      packageSpec,
      ...ciCommandArguments(resolution.argument, device),
    ];
    const ci = await runCapture(npx.command, ciArgs, { cwd: workspace, logFile: cliLogFile });
    const report = await readJson(resultsFile);
    const reportIsValid =
      report?.kind === "relay-ci" && report.totals && typeof report.totals === "object";

    let evidenceEntries = [];
    if (reportIsValid) {
      evidenceEntries = await exportEvidence(report, packageSpec, npx, workspace);
    } else {
      await writeEvidenceManifest([]);
      const tail = await tailText(cliLogFile);
      await writeActionError(
        [
          `Relay exited with code ${ci.code} without a readable results.json.`,
          report
            ? "results.json exists but is not a relay-ci report."
            : "results.json was not written.",
          tail ? `\nLast Relay output:\n${tail.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    const verdict = verdictFromReport(reportIsValid ? report : undefined, ci.code);
    const metadata = {
      schemaVersion: 1,
      kind: "relay-github-action",
      createdAt: new Date().toISOString(),
      tests: {
        input: testsInput,
        matched: resolution.matched,
        staged: resolution.staged,
        argument: resolution.argument,
      },
      cli: {
        packageSpec,
        command: commandLine(npx.command, ciArgs),
        exitCode: ci.code,
        device: device || undefined,
      },
      verdict,
      evidence: {
        requested: evidenceEntries.length,
        exported: evidenceEntries.filter((entry) => entry.exported).length,
      },
    };
    await writeFile(actionMetadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
    if (metadata.evidence.requested > metadata.evidence.exported) {
      workflowWarning(
        `Relay evidence exported for ${metadata.evidence.exported} of ${metadata.evidence.requested} runs; see evidence-manifest.json and relay-cli.log in the artifact.`,
      );
    }

    output("exit-code", ci.code);
    output("verdict", verdict);
    output("evidence-exported", metadata.evidence.exported);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeActionError(message);
    await writeEvidenceManifest([]).catch(() => undefined);
    output("exit-code", 2);
    output("verdict", "error");
    output("evidence-exported", 0);
    process.stderr.write(`relay action: ${message}\n`);
  } finally {
    await flushOutputs();
  }
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entrypoint === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`relay action: ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 2;
  });
}
