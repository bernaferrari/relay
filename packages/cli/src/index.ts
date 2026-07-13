#!/usr/bin/env tsx
/**
 * relay CLI — app testing host (PostHog/Uber bar).
 *
 *   relay                              # TTY → TUI workspace
 *   relay doctor
 *   relay run <action> [flags]
 *   relay <action> [flags]             # direct (compat)
 *   relay serve | tui | interactive
 */
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  ACTIONS,
  HOME_ACCOUNT_MATCH,
  WORK_ACCOUNT_MATCH,
  cancelActiveJob,
  cancelJob,
  formatJsonReport,
  getActiveJob,
  isActionId,
  buildTargetProfiles,
  createDiscoverySession,
  formatDiscoveryExport,
  listDiscoverySessions,
  listCompatibilityMatrices,
  listDevices,
  listRecipes,
  listTargets,
  listYamlRecipeFiles,
  parseRecipeYaml,
  pauseJob,
  readRecipe,
  readCompatibilityMatrix,
  readDiscoverySession,
  readTarget,
  resumeJob,
  resolveCompatibilityMatrix,
  setDiscoveryStatus,
  runDoctor,
  runJobSync,
  toJobReport,
  toJunitXml,
  formatRecipeYaml,
  formatMatrixYaml,
  findWorkspaceRoot,
  parseMatrixYaml,
  recipeYamlPath,
  saveRecipe,
  testsRoot,
  type ActionId,
  type TestJob,
  saveCompatibilityMatrix,
} from "@relay/core";
import { runInteractive } from "./interactive.js";

const DEFAULT_SERVE_PORT = 8787;

function usage(exitCode = 2): never {
  const actionLines = ACTIONS.map((a) => `  ${a.id.padEnd(22)} ${a.description}`).join("\n");

  console.log(`Relay — mobile app testing on real devices

Usage:
  relay                              TTY → testing TUI (OpenCode-style)
  relay doctor                       Environment checks (exit 1 if any fail)
  relay cancel [jobId]               Cancel active or specific job
  relay pause [jobId]                Pause running job
  relay resume [jobId]               Resume paused job
  relay run <action> [flags]         Run a legacy action (JSON / JUnit)
  relay init [--dry-run]             Create git-friendly Relay test layout
  relay test list [--json]           List editable tests
  relay test validate [path...]      Validate tracked YAML test definitions
  relay test run <id> [flags]        Run an editable test by id
  relay test import <path> [--force] Import YAML; replacing an existing test requires --force
  relay test export <id> [--out p]   Print or write canonical YAML
  relay matrix list [--json]         List named compatibility matrices
  relay matrix validate <id>         Preview a compatibility matrix against observed targets
  relay matrix import <path> [--force] Import a Git-friendly matrix YAML file
  relay matrix export <id> [--out p] Print or write canonical matrix YAML
  relay discover start <target>      Start a bounded Discovery Map session
  relay discover status [id]         Inspect Discovery Map sessions
  relay discover stop <id>           Stop a Discovery Map session
  relay discover export <id>         Export a Discovery Map as JSON or Markdown
  relay <action> [flags]             Direct action (compat)
  relay serve [--port n] [--host h] [--token value]  HTTP API
  relay tui [--server url]           Explicit TUI
  relay interactive | i              Classic readline picker
  relay help | -h | --help

Actions:
${actionLines}

run flags:
  --json                     Print JobReport JSON (with summary) to stdout
  --junit <path>             Write JUnit XML to path
  --serial <s>               Target device serial
  --all-devices              Run on every connected Android device
  --target <id>              Connected serial or managed-browser target id
  --repeat <n>               Repeat an editable test (1–20, default 1)
  --matrix <id>              Run an editable test across a named compatibility matrix
  --retries <n>              Device op retries (default 3, env RELAY_RETRY_ATTEMPTS)

serve:
  --port <n>                 Listen port (default ${DEFAULT_SERVE_PORT})
  --host <h>                 Bind host (default 127.0.0.1)
  --token <value>            Bearer token (required outside loopback; prefer env)

Env:
  WORK_ACCOUNT_MATCH=${WORK_ACCOUNT_MATCH}
  HOME_ACCOUNT_MATCH=${HOME_ACCOUNT_MATCH}
  PROD_ACCOUNT_MATCH         required for *-prod actions
  AGENT_DEVICE_SERIAL        default device serial
  RELAY_RUNS_DIR             override runs/ directory
  RELAY_AUTH_TOKEN           HTTP bearer token for non-loopback serving
`);
  process.exit(exitCode);
}

function parseFlagValue(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = argv.indexOf(name);
  if (idx >= 0) return argv[idx + 1];
  return undefined;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

async function resolveJobId(argv: string[]): Promise<string> {
  const id = argv[0]?.trim();
  if (id) return id;
  const active = getActiveJob();
  if (!active) throw new Error("No active job — pass a job id");
  return active.id;
}

async function cmdCancel(argv: string[]): Promise<void> {
  const id = argv[0]?.trim();
  const job = id ? cancelJob(id) : cancelActiveJob();
  if (!job) {
    console.error("No job to cancel");
    process.exit(1);
  }
  console.log(`cancelled ${job.id.slice(0, 8)}  ${job.action}  (${job.status})`);
  process.exit(0);
}

async function cmdPause(argv: string[]): Promise<void> {
  const id = await resolveJobId(argv);
  const job = pauseJob(id);
  console.log(`paused ${job.id.slice(0, 8)}  ${job.action}`);
}

async function cmdResume(argv: string[]): Promise<void> {
  const id = await resolveJobId(argv);
  const job = resumeJob(id);
  console.log(`resumed ${job.id.slice(0, 8)}  ${job.action}`);
}

async function runDoctorCmd(): Promise<void> {
  const result = await runDoctor();
  for (const check of result.checks) {
    const mark = check.ok ? "ok  " : "FAIL";
    console.log(`[${mark}] ${check.id.padEnd(10)} ${check.message}`);
  }
  console.log(result.ok ? "\ndoctor: all checks passed" : "\ndoctor: one or more checks failed");
  process.exit(result.ok ? 0 : 1);
}

function printReportHuman(report: ReturnType<typeof toJobReport>): void {
  const dur = report.durationMs != null ? `${(report.durationMs / 1000).toFixed(1)}s` : "?";
  const device =
    report.deviceName || report.serial ? ` · ${report.deviceName ?? report.serial}` : "";
  if (report.ok) {
    const tag = report.healed ? "HEALED" : report.status === "cancelled" ? "CANCELLED" : "OK";
    console.log(`✓ ${tag} ${report.action}${device} (${dur})`);
    if (report.healMessage) console.log(`  ${report.healMessage}`);
    if (report.runDir) console.log(`  run → ${report.runDir}`);
  } else {
    const tag = report.status === "cancelled" ? "CANCELLED" : "FAIL";
    console.error(
      `✗ ${tag} ${report.action}${device} (${dur})${report.errorCode ? ` [${report.errorCode}]` : ""}`,
    );
    if (report.error) console.error(`  ${report.error}`);
    if (report.runDir) console.error(`  run → ${report.runDir}`);
  }
}

async function runOneJob(
  action: ActionId,
  opts: {
    serial?: string;
  },
): Promise<TestJob> {
  const onSigInt = () => {
    console.error("\n→ cancel (Ctrl+C)…");
    try {
      cancelActiveJob();
    } catch {
      /* ignore */
    }
  };
  process.on("SIGINT", onSigInt);
  process.on("SIGTERM", onSigInt);
  try {
    return await runJobSync({
      action,
      serial: opts.serial,
    });
  } finally {
    process.off("SIGINT", onSigInt);
    process.off("SIGTERM", onSigInt);
  }
}

async function runActionViaJob(action: ActionId, argv: string[]): Promise<void> {
  const serialFlag = parseFlagValue(argv, "--serial");
  const junitPath = parseFlagValue(argv, "--junit");
  const asJson = hasFlag(argv, "--json");
  const allDevices = hasFlag(argv, "--all-devices");
  const retries = parseFlagValue(argv, "--retries");
  if (retries) process.env.RELAY_RETRY_ATTEMPTS = retries;

  let serials: (string | undefined)[] = [serialFlag];
  if (allDevices) {
    const devices = await listDevices();
    if (devices.length === 0) {
      console.error("error: --all-devices but no Android devices connected");
      process.exit(1);
    }
    serials = devices.map((d) => d.serial);
    if (!asJson) {
      console.log(`→ matrix ${action} on ${serials.length} device(s)`);
    }
  } else if (!asJson) {
    console.log(`→ run ${action}${serialFlag ? ` @ ${serialFlag}` : ""}`);
  }

  const jobs: TestJob[] = [];
  for (const serial of serials) {
    if (!asJson && allDevices) {
      console.log(`\n→ device ${serial}`);
    }
    const job = await runOneJob(action, { serial });
    jobs.push(job);
    if (!asJson) printReportHuman(toJobReport(job));
  }

  const reports = jobs.map(toJobReport);

  if (junitPath) {
    await writeFile(junitPath, toJunitXml(reports), "utf8");
    if (!asJson) console.log(`wrote junit → ${junitPath}`);
  }

  if (asJson) {
    process.stdout.write(formatJsonReport(reports));
  }

  const failed = reports.some((r) => !r.ok);
  process.exit(failed ? 1 : 0);
}

function parsePositiveInt(raw: string | undefined, flag: string, max = 20): number {
  if (raw === undefined) return 1;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${flag} must be an integer from 1 to ${max}`);
  }
  return value;
}

async function resolveTarget(target?: string): Promise<{
  serial?: string;
  targetKind?: "device" | "browser";
  browserTargetId?: string;
}> {
  if (!target) return {};
  const browser = await readTarget(target);
  return browser?.kind === "browser"
    ? { serial: target, targetKind: "browser", browserTargetId: target }
    : { serial: target, targetKind: "device" };
}

async function runRecipeViaJob(recipeId: string, argv: string[]): Promise<void> {
  const recipe = await readRecipe(recipeId);
  if (!recipe) throw new Error(`Test not found: ${recipeId}`);
  if (recipe.quarantined) {
    throw new Error(
      `Test is quarantined${recipe.quarantineReason ? `: ${recipe.quarantineReason}` : ""}`,
    );
  }
  const asJson = hasFlag(argv, "--json");
  const junitPath = parseFlagValue(argv, "--junit");
  const repeat = parsePositiveInt(parseFlagValue(argv, "--repeat"), "--repeat");
  const matrixId = parseFlagValue(argv, "--matrix");
  if (matrixId && (parseFlagValue(argv, "--target") || parseFlagValue(argv, "--serial"))) {
    throw new Error("use either --matrix or --target/--serial, not both");
  }
  const target = await resolveTarget(
    parseFlagValue(argv, "--target") ?? parseFlagValue(argv, "--serial"),
  );
  const profiles = matrixId ? await resolveMatrixProfiles(matrixId) : [null];
  const reports = [];
  for (const profile of profiles) {
    const profileTarget = profile ? await resolveTarget(profile.targetId) : target;
    for (let index = 0; index < repeat; index += 1) {
      if (!asJson) {
        console.log(
          `→ run ${recipe.id}${repeat > 1 ? ` (${index + 1}/${repeat})` : ""}${profile ? ` @ ${profile.name}` : profileTarget.serial ? ` @ ${profileTarget.serial}` : ""}`,
        );
      }
      const job = await runJobSync({
        recipe: recipe.id,
        ...profileTarget,
        ...(profile ? { targetProfile: profile } : {}),
        caseIndex: index,
        caseCount: repeat,
      });
      const report = toJobReport(job);
      reports.push(report);
      if (!asJson) printReportHuman(report);
    }
  }
  if (junitPath) {
    await writeFile(junitPath, toJunitXml(reports), "utf8");
    if (!asJson) console.log(`wrote junit → ${junitPath}`);
  }
  if (asJson) process.stdout.write(formatJsonReport(reports));
  process.exit(reports.some((report) => !report.ok) ? 1 : 0);
}

async function resolveMatrixProfiles(matrixId: string) {
  const matrix = await readCompatibilityMatrix("default", matrixId);
  if (!matrix) throw new Error(`Compatibility matrix not found: ${matrixId}`);
  const profiles = buildTargetProfiles({
    devices: await listDevices().catch(() => []),
    targets: await listTargets(),
  });
  const expansion = resolveCompatibilityMatrix(matrix, profiles);
  if (expansion.profiles.length === 0) {
    const reasons = expansion.excluded
      .map((item) => `${item.profile.name}: ${item.reason}`)
      .join("; ");
    throw new Error(
      `Compatibility matrix “${matrix.name}” matched no targets${reasons ? ` (${reasons})` : ""}`,
    );
  }
  return expansion.profiles;
}

async function cmdMatrix(argv: string[]): Promise<void> {
  const command = argv[0];
  if (command === "list") {
    const matrices = await listCompatibilityMatrices("default");
    if (hasFlag(argv, "--json")) {
      process.stdout.write(`${JSON.stringify(matrices, null, 2)}\n`);
      return;
    }
    if (matrices.length === 0) {
      console.log("No compatibility matrices yet.");
      return;
    }
    for (const matrix of matrices) {
      console.log(
        `${matrix.id.padEnd(30)} ${matrix.name} · ${matrix.selectors.length} selector${matrix.selectors.length === 1 ? "" : "s"}`,
      );
    }
    return;
  }
  if (command === "validate") {
    const id = argv[1];
    if (!id) throw new Error("relay matrix validate requires a matrix id");
    const matrix = await readCompatibilityMatrix("default", id);
    if (!matrix) throw new Error(`Compatibility matrix not found: ${id}`);
    const profiles = buildTargetProfiles({
      devices: await listDevices().catch(() => []),
      targets: await listTargets(),
    });
    const expansion = resolveCompatibilityMatrix(matrix, profiles);
    for (const profile of expansion.profiles) {
      console.log(
        `include ${profile.name} · ${profile.platform}${profile.osVersion ? ` ${profile.osVersion}` : ""}`,
      );
    }
    for (const item of expansion.excluded) {
      console.log(`exclude ${item.profile.name} · ${item.reason}`);
    }
    if (expansion.profiles.length === 0) {
      console.error("Matrix matched no targets.");
      process.exit(1);
    }
    return;
  }
  if (command === "import") {
    const file = argv[1];
    if (!file) throw new Error("relay matrix import requires a YAML file path");
    const parsed = parseMatrixYaml(await readFile(path.resolve(file), "utf8"), {
      projectId: "default",
      createdAt: 0,
      updatedAt: 0,
    });
    const existing = await readCompatibilityMatrix("default", parsed.id);
    if (existing && !hasFlag(argv.slice(2), "--force")) {
      throw new Error(`Matrix “${parsed.id}” already exists; pass --force to replace it`);
    }
    const saved = await saveCompatibilityMatrix({
      id: parsed.id,
      projectId: "default",
      name: parsed.name,
      selectors: parsed.selectors,
    });
    console.log(`imported ${saved.id} · ${saved.name}`);
    return;
  }
  if (command === "export") {
    const id = argv[1];
    if (!id) throw new Error("relay matrix export requires a matrix id");
    const matrix = await readCompatibilityMatrix("default", id);
    if (!matrix) throw new Error(`Compatibility matrix not found: ${id}`);
    const output = formatMatrixYaml(matrix);
    const destination = parseFlagValue(argv.slice(2), "--out");
    if (destination) {
      await writeFile(destination, output, "utf8");
      console.log(`exported ${matrix.id} → ${destination}`);
    } else process.stdout.write(output);
    return;
  }
  throw new Error(`Unknown matrix command: ${command ?? "(missing)"}`);
}

async function cmdDiscover(argv: string[]): Promise<void> {
  const command = argv[0];
  if (command === "start") {
    const targetId = argv[1];
    if (!targetId) throw new Error("relay discover start requires a target id");
    const profiles = buildTargetProfiles({
      devices: await listDevices().catch(() => []),
      targets: await listTargets(),
    });
    const profile = profiles.find((item) => item.targetId === targetId);
    const session = await createDiscoverySession({
      name: parseFlagValue(argv, "--name") ?? `Discovery · ${profile?.name ?? targetId}`,
      targetId,
      ...(profile ? { targetProfile: profile } : {}),
    });
    await setDiscoveryStatus(session.id, "running");
    console.log(`discovery started ${session.id} → ${session.name}`);
    return;
  }
  if (command === "status") {
    const id = argv[1];
    const sessions = id ? [await readDiscoverySession(id)] : await listDiscoverySessions();
    const present = sessions.filter((session): session is NonNullable<typeof session> =>
      Boolean(session),
    );
    if (hasFlag(argv, "--json")) {
      process.stdout.write(`${JSON.stringify(present, null, 2)}\n`);
      return;
    }
    if (present.length === 0) {
      console.log("No Discovery Map sessions yet.");
      return;
    }
    for (const session of present) {
      console.log(
        `${session.id.padEnd(46)} ${session.status.padEnd(8)} ${session.screens.length} screens · ${session.transitions.length} transitions · ${session.name}`,
      );
    }
    return;
  }
  if (command === "stop") {
    const id = argv[1];
    if (!id) throw new Error("relay discover stop requires a session id");
    const session = await setDiscoveryStatus(id, "stopped");
    console.log(`discovery stopped ${session.id}`);
    return;
  }
  if (command === "export") {
    const id = argv[1];
    if (!id) throw new Error("relay discover export requires a session id");
    const session = await readDiscoverySession(id);
    if (!session) throw new Error(`Discovery session not found: ${id}`);
    const format = parseFlagValue(argv, "--format") === "markdown" ? "markdown" : "json";
    const output = formatDiscoveryExport(session, format);
    const destination = parseFlagValue(argv, "--out");
    if (destination) {
      await writeFile(destination, output, "utf8");
      console.log(`exported ${session.id} → ${destination}`);
    } else process.stdout.write(output);
    return;
  }
  throw new Error(`Unknown discover command: ${command ?? "(missing)"}`);
}

async function cmdTestList(argv: string[]): Promise<void> {
  const recipes = await listRecipes();
  if (hasFlag(argv, "--json")) {
    process.stdout.write(
      `${JSON.stringify(
        recipes.map((recipe) => ({
          id: recipe.id,
          name: recipe.title,
          description: recipe.description,
          steps: recipe.steps.length,
          quarantined: Boolean(recipe.quarantined),
        })),
        null,
        2,
      )}\n`,
    );
    return;
  }
  for (const recipe of recipes) {
    console.log(
      `${recipe.id.padEnd(34)} ${recipe.title}${recipe.quarantined ? " [quarantined]" : ""}`,
    );
  }
}

async function cmdTestValidate(paths: string[]): Promise<void> {
  const files =
    paths.length > 0
      ? paths.map((file) => path.resolve(file))
      : await listYamlRecipeFiles(testsRoot());
  if (files.length === 0) {
    console.log("No Relay YAML tests yet. Add tests/<id>.relay.yaml or import one from the app.");
    return;
  }
  let invalid = 0;
  for (const file of files) {
    try {
      const source = await readFile(file, "utf8");
      const recipe = parseRecipeYaml(source);
      console.log(`ok   ${file} · ${recipe.id}`);
    } catch (error) {
      invalid += 1;
      console.error(`FAIL ${file} · ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  process.exit(invalid === 0 ? 0 : 1);
}

async function cmdTestImport(file: string, argv: string[]): Promise<void> {
  if (!file) throw new Error("relay test import requires a YAML file path");
  const recipe = parseRecipeYaml(await readFile(file, "utf8"));
  const existing = await readRecipe(recipe.id);
  if (existing && !argv.includes("--force")) {
    throw new Error(`Test “${recipe.id}” already exists; pass --force to replace it`);
  }
  const saved = await saveRecipe({
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    variables: recipe.variables,
    parameters: recipe.parameters,
    steps: recipe.steps,
    quarantined: recipe.quarantined,
    quarantineReason: recipe.quarantineReason,
  });
  console.log(`imported ${saved.id} → ${recipeYamlPath(testsRoot(), saved.id)}`);
}

async function cmdTestExport(recipeId: string, argv: string[]): Promise<void> {
  if (!recipeId) throw new Error("relay test export requires a test id");
  const recipe = await readRecipe(recipeId);
  if (!recipe) throw new Error(`Test not found: ${recipeId}`);
  const output = formatRecipeYaml(recipe);
  const destination = parseFlagValue(argv, "--out");
  if (destination) {
    await writeFile(destination, output, "utf8");
    console.log(`exported ${recipe.id} → ${destination}`);
  } else {
    process.stdout.write(output);
  }
}

async function cmdInit(argv: string[]): Promise<void> {
  // Resolve from the workspace marker, not the package that happened to
  // launch the binary. `pnpm --filter @relay/cli exec relay init` should
  // initialize the repository root just like a globally installed binary.
  const root = findWorkspaceRoot();
  const tests = testsRoot();
  const config = path.join(root, "relay.yaml");
  const dryRun = hasFlag(argv, "--dry-run");
  const planned = [!existsSync(config) ? config : null, !existsSync(tests) ? tests : null].filter(
    (entry): entry is string => Boolean(entry),
  );
  if (dryRun) {
    for (const entry of planned) console.log(`create ${entry}`);
    if (planned.length === 0) console.log("Relay project layout is already initialized.");
    console.log("tracked: relay.yaml, tests/*.relay.yaml, and *.relay.matrix.yaml");
    console.log("local: runs/, recipes/.history/, .relay/, and generated screenshots/videos");
    return;
  }
  await mkdir(tests, { recursive: true });
  await writeFile(path.join(tests, ".gitkeep"), "", { flag: "a" });
  if (!existsSync(config)) {
    await writeFile(config, "schemaVersion: 1\nname: Relay project\ntestsDir: tests\n", "utf8");
  }
  console.log(`initialized Relay tests in ${tests}`);
  console.log("Tracked: relay.yaml, tests/*.relay.yaml, and *.relay.matrix.yaml");
  console.log("Keep local: runs/, recipes/.history/, .relay/, and generated screenshots/videos");
  console.log("Next: add tests/<id>.relay.yaml, then run `relay test validate`.");
}

async function cmdTest(argv: string[]): Promise<void> {
  const command = argv[0];
  if (command === "list") return await cmdTestList(argv.slice(1));
  if (command === "validate") return await cmdTestValidate(argv.slice(1));
  if (command === "run") {
    const id = argv[1];
    if (!id) throw new Error("relay test run requires a test id");
    return await runRecipeViaJob(id, argv.slice(2));
  }
  if (command === "import") return await cmdTestImport(argv[1] ?? "", argv.slice(2));
  if (command === "export") return await cmdTestExport(argv[1] ?? "", argv.slice(2));
  throw new Error(`Unknown test command: ${command ?? "(missing)"}`);
}

async function runDirect(action: ActionId, argv: string[]): Promise<void> {
  // Compat path — same as `run` without requiring the subcommand name
  await runActionViaJob(action, argv);
}

async function runServe(argv: string[]): Promise<void> {
  const portRaw = parseFlagValue(argv, "--port");
  const host = parseFlagValue(argv, "--host") ?? "127.0.0.1";
  const token =
    parseFlagValue(argv, "--token") ??
    process.env.RELAY_AUTH_TOKEN ??
    process.env.GROK_DEVICE_AUTH_TOKEN;
  const port = portRaw ? Number(portRaw) : DEFAULT_SERVE_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --port: ${portRaw}`);
  }

  const { startServer } = await import("@relay/server");
  const server = await startServer({ port, host, token });
  console.log(`relay server listening on http://${server.host}:${server.port}`);
  console.log("  GET  /health  /doctor  /meta  /events(SSE)");
  console.log("  GET  /report  /report/:id  /report/junit");
  console.log("  GET  /devices  /actions  /jobs  /snapshot  /screenshot  /runs");
  console.log("  POST /jobs  /actions/:id/run  /interact  /device/select");
  console.log("Press Ctrl+C to stop.");

  await new Promise<void>((resolve) => {
    const onSignal = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      void server.close().then(() => resolve());
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}

async function runTui(argv: string[]): Promise<void> {
  try {
    const mod = (await import("@relay/tui")) as {
      main?: (argv: string[]) => void | Promise<void>;
      default?: (argv: string[]) => void | Promise<void>;
      run?: (argv: string[]) => void | Promise<void>;
    };
    const entry = mod.main ?? mod.run ?? mod.default;
    if (typeof entry !== "function") {
      throw new Error(
        "@relay/tui loaded but has no main/run/default export. Check the package version.",
      );
    }
    await entry(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as NodeJS.ErrnoException)?.code;
    const isMissing =
      code === "ERR_MODULE_NOT_FOUND" ||
      /Cannot find (package|module)/i.test(message) ||
      /Failed to resolve/i.test(message);

    if (isMissing) {
      console.error(`error: @relay/tui is not installed or not built yet.
  Install/build the monorepo package, then retry:
    pnpm install
    relay tui

  Underlying error: ${message}`);
      process.exit(1);
    }
    throw err;
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  // OpenCode-style: bare launch in a TTY opens the testing workspace (TUI).
  // Use `interactive` / `i` for the classic readline picker.
  if (argv.length === 0) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      await runTui([]);
      return;
    }
    await runInteractive();
    return;
  }

  const cmd = argv[0]!;
  if (cmd === "-h" || cmd === "--help" || cmd === "help") usage(0);

  if (cmd === "doctor") {
    await runDoctorCmd();
    return;
  }
  if (cmd === "init") {
    await cmdInit(argv.slice(1));
    return;
  }
  if (cmd === "test") {
    await cmdTest(argv.slice(1));
    return;
  }
  if (cmd === "matrix") {
    await cmdMatrix(argv.slice(1));
    return;
  }
  if (cmd === "discover") {
    await cmdDiscover(argv.slice(1));
    return;
  }
  if (cmd === "cancel") {
    await cmdCancel(argv.slice(1));
    return;
  }
  if (cmd === "pause") {
    await cmdPause(argv.slice(1));
    return;
  }
  if (cmd === "resume") {
    await cmdResume(argv.slice(1));
    return;
  }

  if (cmd === "run") {
    const action = argv[1];
    if (!action || !isActionId(action)) {
      console.error(action ? `error: unknown action "${action}"` : "error: run requires <action>");
      usage(2);
    }
    await runActionViaJob(action, argv.slice(2));
    return;
  }

  if (cmd === "interactive" || cmd === "i") {
    await runInteractive();
    return;
  }

  if (cmd === "serve") {
    await runServe(argv.slice(1));
    return;
  }

  if (cmd === "tui") {
    await runTui(argv.slice(1));
    return;
  }

  if (!isActionId(cmd)) usage(2);

  await runDirect(cmd, argv.slice(1));
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`error: ${message}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    console.error("\nHint: relay doctor && agent-device devices --platform android");
    process.exit(1);
  });
}
