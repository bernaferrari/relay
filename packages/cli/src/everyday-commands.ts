/**
 * The everyday verbs: `relay new`, `relay ci`, `relay apps`, `relay tests`,
 * `relay runs`, `relay devices`, and `relay --version`. They take names, read
 * relay.json defaults, and print tables for people and envelopes for machines.
 */
import { tokenize, type ParsedTokens } from "./cli-argv.js";
import { runCiCommand } from "./ci-command.js";
import { parseCli } from "./config.js";
import { classifyError, ExitCode, UsageError } from "./errors.js";
import { age, formatListResult, table } from "./everyday-format.js";
import {
  appName,
  chooseApp,
  listApps,
  readProjectConfig,
  scenarioTests,
  shellWord,
  type EverydayInvoke,
  type ProjectConfig,
} from "./everyday-names.js";
import { renderEverydayHelp } from "./everyday-help.js";
import { invokeOperation, type ClientFactory } from "./invoke.js";
import type { LocalServerResult } from "./local-server.js";
import { cliPackageVersion } from "./outcome-runner.js";
import { CliOutput, type OutputStreams } from "./output.js";
import { protocolOperationInput } from "./protocol-input.js";
import { testReadiness } from "./test-discovery.js";
import { callerCwd } from "./caller-cwd.js";
import { applyTestFiles, isPath, type AppliedTestFile } from "./test-files.js";

export type EverydayDependencies = {
  streams: OutputStreams;
  env: Record<string, string | undefined>;
  createClient: ClientFactory;
  ensureServer: (serverUrl: string) => Promise<LocalServerResult>;
  pollIntervalMs: number;
  registerSignalHandlers: boolean;
};

type Verb = "version" | "apps" | "tests" | "runs" | "devices" | "new" | "ci" | "apply" | "show";

/** Positionals after the verb word, e.g. `new <goal>` → [<goal>]. */
function everydayVerb(tokens: ParsedTokens): { verb: Verb; args: string[] } | undefined {
  const [first] = tokens.positionals;
  if (!first) return tokens.switches.has("--version") ? { verb: "version", args: [] } : undefined;
  if (first === "version") return { verb: "version", args: tokens.positionals.slice(1) };
  if (["apps", "tests", "runs", "devices", "new", "ci", "apply", "show"].includes(first)) {
    return { verb: first as Verb, args: tokens.positionals.slice(1) };
  }
  return undefined;
}

const connectionFlags = [
  "--server",
  "--organization",
  "--project",
  "--credential-source",
  "--actor",
  "--timeout",
] as const;
const verbFlags: Record<Verb, readonly string[]> = {
  version: [],
  apps: [],
  tests: ["--app"],
  runs: ["--app"],
  devices: [],
  new: ["--url", "--app", "--name", "--file"],
  ci: ["--app", "--test", "--device", "--output", "--junit"],
  apply: [],
  show: ["--app"],
};

function assertFlags(verb: Verb, tokens: ParsedTokens): void {
  const allowed = new Set<string>([...connectionFlags, ...verbFlags[verb]]);
  for (const flag of tokens.values.keys()) {
    if (!allowed.has(flag)) throw new UsageError(`${flag} is not an option of relay ${verb}`);
  }
  const switches = new Set(["--json", "--ndjson", "--quiet", "--version", "--wait"]);
  for (const flag of tokens.switches) {
    if (!switches.has(flag)) throw new UsageError(`${flag} is not an option of relay ${verb}`);
  }
}

/** Checks an everyday command line (verb and flags) without running it;
 * undefined means the line is not an everyday command. */
export function parseEverydayCommand(
  argv: readonly string[],
): { verb: Verb; args: string[] } | undefined {
  const tokens = tokenize(argv);
  const selected = everydayVerb(tokens);
  if (selected) assertFlags(selected.verb, tokens);
  return selected;
}

function globalConfig(
  argv: readonly string[],
  tokens: ParsedTokens,
  env: Record<string, string | undefined>,
) {
  const passthrough: string[] = [];
  for (const flag of connectionFlags) {
    const value = tokens.values.get(flag);
    if (value !== undefined) passthrough.push(flag, value);
  }
  for (const flag of ["--json", "--ndjson", "--quiet"])
    if (argv.includes(flag)) passthrough.push(flag);
  return parseCli(["system", "health", ...passthrough], env).config;
}

function onlyArgument(verb: Verb, args: readonly string[], name: string): string | undefined {
  if (args.length > 1) {
    throw new UsageError(`relay ${verb} takes at most one ${name}; quote names with spaces`);
  }
  return args[0];
}

/** Builds the test.create-from-goal request. A future `--file <test.yaml>`
 * branch would return a `test.apply-yaml` request from here instead. */
export function newTestRequest(
  args: readonly string[],
  tokens: ParsedTokens,
  config: ProjectConfig,
): { operationId: "test.create-from-goal"; input: Record<string, unknown> } {
  const goal = args.join(" ").trim();
  if (!goal) {
    throw new UsageError(
      'Expected: relay new "<what should work>" [--url <website>] [--app <name>]',
    );
  }
  const url = tokens.values.get("--url") ?? config.url;
  const app = tokens.values.get("--app") ?? config.app;
  const name = tokens.values.get("--name");
  return {
    operationId: "test.create-from-goal",
    input: { goal, ...(url ? { url } : {}), ...(app ? { app } : {}), ...(name ? { name } : {}) },
  };
}

function formatApplied(applied: readonly AppliedTestFile[]): string {
  return [
    table(
      ["FILE", "TEST", "APP", "", "KEPT RECORDED"],
      applied.map((item) => [
        item.file,
        item.name,
        item.appId,
        item.created ? "created" : "updated",
        item.keptRecorded,
      ]),
    ),
    "",
    applied.length === 1
      ? `Run it:   relay run ${shellWord(applied[0]!.name)} --app ${shellWord(applied[0]!.appId)}`
      : `Run them: relay ci <folder>`,
  ].join("\n");
}

function formatNewTest(result: Record<string, unknown>): string {
  const steps = Array.isArray(result.steps)
    ? (result.steps as { kind?: string; text?: string }[])
    : [];
  const name = String(result.name ?? result.testId);
  const appId = String(result.appId);
  return [
    `Saved “${name}” in ${appId}${result.createdApp ? " (new app)" : ""}`,
    "",
    ...steps.map(
      (step, index) => `  ${index + 1}. ${(step.kind ?? "action").padEnd(6)}  ${step.text ?? ""}`,
    ),
    "",
    `Run it:   relay run ${shellWord(name)} --app ${shellWord(appId)}`,
    `Edit it:  open the Test in the Relay app, or record it to make it exact.`,
  ].join("\n");
}

export async function runEverydayCommand(
  argv: readonly string[],
  deps: EverydayDependencies,
): Promise<number | undefined> {
  let tokens: ParsedTokens;
  try {
    tokens = tokenize(argv);
  } catch {
    return undefined; // the main parser reports option errors consistently
  }
  const selected = everydayVerb(tokens);
  if (!selected) return undefined;
  const { verb, args } = selected;
  const json = argv.includes("--json") || argv.includes("--ndjson");
  let output = new CliOutput(json ? "json" : "human", argv.includes("--quiet"), deps.streams);
  const operationId = `local.${verb}`;
  if (tokens.switches.has("--help") || tokens.switches.has("-h")) {
    deps.streams.stdout.write(renderEverydayHelp(verb));
    return ExitCode.success;
  }
  const abort = new AbortController();
  const cancel = () => abort.abort();
  if (deps.registerSignalHandlers) {
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
  }
  try {
    assertFlags(verb, tokens);
    const config = globalConfig(argv, tokens, deps.env);
    output = new CliOutput(config.output, config.quiet, deps.streams);
    if (verb === "version") {
      if (args.length) throw new UsageError("Expected: relay --version");
      const version = cliPackageVersion();
      if (json) output.result(operationId, { cliVersion: version });
      else deps.streams.stdout.write(`relay ${version}\n`);
      return ExitCode.success;
    }
    if (config.ensureLocalServer) await deps.ensureServer(config.connection.url);
    const client = deps.createClient(config);
    const invoke: EverydayInvoke = (id, input) =>
      invokeOperation(client, id, protocolOperationInput(id, input), abort.signal);
    const project = readProjectConfig(deps.env);
    if (verb === "apps") {
      if (args.length) throw new UsageError("Expected: relay apps");
      const apps = (await listApps(invoke)).map((map) => ({
        id: map.id,
        name: appName(map),
        testCount: scenarioTests(map).length,
        updatedAt: map.updatedAt,
      }));
      output.result(operationId, { appMaps: apps }, true, formatListResult({ appMaps: apps }));
      return ExitCode.success;
    }
    if (verb === "tests") {
      const wanted = onlyArgument(verb, args, "app") ?? tokens.values.get("--app");
      const app = await chooseApp(invoke, wanted, project);
      const tests = scenarioTests(app)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((test) => {
          const readiness = testReadiness(app, test);
          return {
            id: test.id,
            name: test.name,
            status: readiness.label,
            ready: readiness.ready,
            ...(readiness.reason ? { reason: readiness.reason } : {}),
            steps: test.steps.length,
            updatedAt: test.updatedAt,
          };
        });
      const text = tests.length
        ? [
            table(
              ["NAME", "STATUS", "STEPS", "UPDATED", "ID"],
              tests.map((test) => [
                test.name,
                test.status,
                test.steps,
                age(test.updatedAt),
                test.id,
              ]),
            ),
            "",
            `Run one: relay run "<name>" --app ${shellWord(app.id)}    Run all ready: relay ci ${shellWord(app.id)}`,
          ].join("\n")
        : `No Tests in ${appName(app)} yet. Create one with: relay new "<what should work>" --app ${shellWord(app.id)}`;
      output.result(operationId, { app: { id: app.id, name: appName(app) }, tests }, true, text);
      return ExitCode.success;
    }
    if (verb === "runs") {
      const wanted = onlyArgument(verb, args, "app") ?? tokens.values.get("--app");
      const app = wanted ? await chooseApp(invoke, wanted, project) : undefined;
      const result = await invoke("run.list", { limit: 20, ...(app ? { appMapId: app.id } : {}) });
      output.result(operationId, result, true, formatListResult(result));
      return ExitCode.success;
    }
    if (verb === "devices") {
      if (args.length) throw new UsageError("Expected: relay devices");
      const result = await invoke("target.devices.list", {});
      output.result(operationId, result, true, formatListResult(result));
      return ExitCode.success;
    }
    const cwd = callerCwd(deps.env);
    if (verb === "apply" || (verb === "new" && tokens.values.get("--file"))) {
      const path =
        verb === "apply" ? onlyArgument(verb, args, "file or folder") : tokens.values.get("--file");
      if (!path) throw new UsageError("Expected: relay apply <test.yaml | folder>");
      output.heartbeat("Saving test files…");
      const applied = await applyTestFiles(invoke, cwd, path);
      output.result(operationId, { applied }, true, formatApplied(applied));
      return ExitCode.success;
    }
    if (verb === "show") {
      const test = onlyArgument(verb, args, "test");
      if (!test) throw new UsageError('Expected: relay show "<test name>" [--app <name>]');
      const app = tokens.values.get("--app") ?? project.app;
      const result = (await invoke("test.yaml.get", { testId: test, ...(app ? { app } : {}) })) as {
        yaml: string;
      };
      output.result(operationId, result, true, result.yaml.trimEnd());
      return ExitCode.success;
    }
    if (verb === "new") {
      const request = newTestRequest(args, tokens, project);
      output.heartbeat("Writing the Test…");
      const result = (await invoke(request.operationId, request.input)) as Record<string, unknown>;
      output.result(operationId, result, true, formatNewTest(result));
      return ExitCode.success;
    }
    let tests = (tokens.values.get("--test") ?? "").split("\u0000").filter(Boolean);
    let app = onlyArgument(verb, args, "app") ?? tokens.values.get("--app");
    // `relay ci relay/tests`: save the files, then run exactly those Tests.
    if (app && (await isPath(cwd, app))) {
      output.heartbeat("Saving test files…");
      const applied = await applyTestFiles(invoke, cwd, app);
      const apps = [...new Set(applied.map((item) => item.appId))];
      if (apps.length > 1)
        throw new UsageError(
          `The test files belong to ${apps.length} apps (${apps.join(", ")}); run relay ci once per app folder.`,
        );
      app = apps[0];
      tests = applied.map((item) => item.testId);
    }
    const device = tokens.values.get("--device");
    const outputPath = tokens.values.get("--output");
    const junit = tokens.values.get("--junit");
    const ci = await runCiCommand({
      options: {
        tests,
        ...(app ? { app } : {}),
        ...(device ? { device } : {}),
        ...(outputPath ? { output: outputPath } : {}),
        ...(junit ? { junit } : {}),
      },
      client,
      invoke,
      actorId: config.connection.actorId,
      env: deps.env,
      output,
      human: config.output === "human",
      signal: abort.signal,
      pollIntervalMs: deps.pollIntervalMs,
    });
    output.result(operationId, ci.report, ci.exitCode === ExitCode.success, ci.text);
    return ci.exitCode;
  } catch (error) {
    const classified = classifyError(error);
    output.error(classified, operationId);
    return classified.exitCode;
  } finally {
    if (deps.registerSignalHandlers) {
      process.off("SIGINT", cancel);
      process.off("SIGTERM", cancel);
    }
  }
}
