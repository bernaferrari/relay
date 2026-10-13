import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  atomicJson,
  importRequirements,
  importFinishedRun,
  recoverImportedRun,
  runE2EProject,
  discoverE2EProject,
  pinnedE2EProject,
} from "@relay/e2e";
import type { ImportOptions } from "@relay/e2e";
import {
  findWorkspaceRoot,
  runsRoot,
  readPersistedRun,
  captureReviewQueueForRun,
  KeyedSerialQueue,
} from "@relay/core";
import type { E2EProject, E2EExecution } from "@relay/protocol";
import { projectE2ERuns } from "./e2e-run-projection.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const inside = (root: string, path: string) => {
  const part = relative(root, path);
  return part && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`);
};
type ExecutionRecord = E2EExecution & {
  output: string;
  evidence: string;
  requirements: Omit<ImportOptions, "directory">;
  configurationPath: string;
  scope: { projectId: string; ownerId: string };
};

/** Owns project consent and evidence delivery. All app actions remain upstream's. */
export function createE2EProjectService(
  root = join(process.env.RELAY_STATE_DIR || join(findWorkspaceRoot(), ".relay"), "e2e-projects"),
) {
  const admissions = new KeyedSerialQueue();
  const active = new Map<string, AbortController>();
  const live = new Map<string, ExecutionRecord>();
  const safeId = (id: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)) throw new Error("Invalid e2e identity");
    return id;
  };
  const projectPath = (id: string) => join(root, "projects", `${safeId(id)}.json`);
  const executionPath = (id: string) => join(root, "executions", safeId(id), "execution.json");
  async function project(id: string): Promise<E2EProject> {
    return JSON.parse(await readFile(projectPath(id), "utf8"));
  }
  async function record(id: string): Promise<ExecutionRecord> {
    return JSON.parse(await readFile(executionPath(id), "utf8"));
  }
  async function save(value: ExecutionRecord) {
    await mkdir(join(root, "executions", value.id), { recursive: true });
    await atomicJson(executionPath(value.id), value);
  }
  async function execution(id: string): Promise<E2EExecution> {
    const value = live.get(id) ?? (await record(id));
    const { output, evidence, requirements, configurationPath, scope, ...view } = value;
    let pending = 0,
      accepted = 0,
      issues = 0;
    const results: NonNullable<E2EExecution["results"]> = [];
    for (const runId of value.runIds) {
      const run = await readPersistedRun(runId);
      if (!run) continue;
      results.push({ runId, title: run.title ?? "e2e result", status: run.status });
      const q = captureReviewQueueForRun(run).summary;
      pending += q.pending;
      accepted += q.accepted;
      issues += q.issue;
    }
    if (["running", "importing"].includes(view.status) && !active.has(id))
      view.status = "interrupted";
    return { ...view, results, pendingReview: pending, accepted, issues };
  }
  async function config(path: string, chosen?: string) {
    for (const candidate of chosen
      ? [chosen]
      : ["e2e.config.ts", "e2e.config.mjs", "e2e.config.js"]) {
      const file = await realpath(resolve(path, candidate)).catch(() => undefined);
      if (file && inside(path, file)) return relative(path, file);
    }
    throw new Error("Choose an e2e configuration inside this project folder");
  }
  async function open(path: string, trust: string, chosen?: string) {
    if (trust !== "trusted-project") throw new Error("Explicit project trust is required");
    const resolved = await pinnedE2EProject(path);
    const configFile = await config(resolved.root, chosen);
    const tests = await discoverE2EProject(resolved.root, configFile, AbortSignal.timeout(30_000));
    const id = `e2e-project-${digest(resolved.root).slice(0, 24)}`;
    const prior = await project(id).catch(() => undefined);
    const value: E2EProject = {
      id,
      path: resolved.root,
      name: basename(resolved.root),
      configFile,
      harness: "e2e",
      version: "0.20.0",
      tests,
      openedAt: prior?.openedAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    await mkdir(join(root, "projects"), { recursive: true });
    await atomicJson(projectPath(id), value);
    return value;
  }
  async function records() {
    const values: ExecutionRecord[] = [];
    for (const id of await readdir(join(root, "executions")).catch(() => [])) {
      const value = await record(id).catch(() => undefined);
      if (value) values.push(value);
    }
    return values;
  }
  async function list() {
    const projects: E2EProject[] = [];
    for (const file of await readdir(join(root, "projects")).catch(() => []))
      if (file.endsWith(".json")) projects.push(await project(file.slice(0, -5)));
    const executions: E2EExecution[] = [];
    for (const value of (await records()).sort((a, b) => b.startedAt - a.startedAt).slice(0, 100)) {
      executions.push(await execution(value.id));
    }
    return { projects, executions };
  }
  async function source(id: string, file: string) {
    const p = await project(id);
    if (!p.tests.some((test) => test.file === file))
      throw new Error("Source is not in this project’s discovered Tests");
    const path = await realpath(resolve(p.path, file));
    if (!inside(p.path, path)) throw new Error("Source escapes the trusted project");
    if ((await stat(path)).size > 256 * 1024) throw new Error("Source is too large to display");
    return { file, text: await readFile(path, "utf8") };
  }
  async function importEvidence(value: ExecutionRecord) {
    const p = await project(value.projectId);
    value.status = "importing";
    await save(value);
    try {
      let retainedOnly = false;
      const reportText = await readFile(join(value.output, "report.json"), "utf8").catch(
        async (error) => {
          if (error.code !== "ENOENT") throw error;
          const candidates = (await readdir(value.evidence)).filter((name) =>
            /^[a-f0-9]{64}$/.test(name),
          );
          if (candidates.length !== 1)
            throw new Error("No unambiguous retained upstream report is available");
          retainedOnly = true;
          return readFile(join(value.evidence, candidates[0]!, "report.json"), "utf8");
        },
      );
      const report = JSON.parse(reportText);
      const imported = retainedOnly
        ? await recoverImportedRun(value.evidence, report.run.id, new AbortController().signal)
        : await importFinishedRun(
            {
              report,
              status: report.run.status,
              exitCode: report.run.exitCode,
              projectRoot: p.path,
              reportPath: join(value.output, "report.json"),
              // Pinned 0.20.0 output layout; final reporter provenance retains this root.
              artifactsRoot: join(value.output, "results"),
              traces: new Map(),
              aiTracePath: undefined,
            },
            { directory: value.evidence, ...value.requirements },
            new AbortController().signal,
          );
      value.upstreamStatus = report.run.status;
      value.finishedAt ??= Date.now();
      value.runIds = await projectE2ERuns({
        report,
        imported,
        runsRoot: runsRoot(),
        projectId: value.scope.projectId,
        ownerId: value.scope.ownerId,
        projectName: p.name,
        sourceProjectId: p.id,
      });
      value.requiredCaptures = imported.receipt.coverage.expected;
      value.availableCaptures =
        imported.receipt.coverage.obligations?.filter((x) => x.state === "available").length ??
        imported.receipt.artifacts.filter(
          (x) => x.source.kind === "screenshot" && x.state === "available",
        ).length;
      value.status = imported.receipt.acceptance.evidenceComplete
        ? "complete"
        : "import-incomplete";
      const missing =
        imported.receipt.coverage.obligations?.filter((slot) => slot.state !== "available") ?? [];
      value.error =
        value.status === "import-incomplete"
          ? missing.length
            ? `Required captures unavailable: ${missing
                .slice(0, 3)
                .map((slot) => `${slot.stepLabel} (${slot.targetId}, ${slot.state})`)
                .join(
                  "; ",
                )}${missing.length > 3 ? `; ${missing.length - 3} more` : ""}. Check the capture plan and retained evidence.`
            : "Required evidence is unavailable. Restore the retained artifacts, then retry import."
          : undefined;
    } catch (error) {
      value.status = "import-incomplete";
      value.error =
        error instanceof Error && "code" in error && error.code === "ENOENT"
          ? "The upstream report or artifacts are unavailable. Check Execution output, then restore the evidence before retrying import."
          : error instanceof Error
            ? error.message
            : "Evidence import failed";
    }
    await save(value);
    return execution(value.id);
  }
  async function run(
    id: string,
    testId: string | undefined,
    scope: { projectId: string; ownerId: string },
  ) {
    const p = await project(id);
    if (active.size)
      throw new Error("An e2e execution is active; let it finish before starting another");
    const unresolved = (await records()).find(
      (execution) =>
        ["running", "importing", "interrupted"].includes(execution.status) && !execution.finishedAt,
    );
    if (unresolved)
      throw new Error(
        "An earlier execution lost its controller. Retry its evidence import after the upstream process finishes before starting another.",
      );
    const chosen = testId ? p.tests.find((test) => test.id === testId) : undefined;
    if (testId && (!chosen || chosen.disposition !== "run"))
      throw new Error("Choose an executable Test from this project");
    const executionId = randomUUID();
    const directory = join(root, "executions", executionId);
    await mkdir(directory, { recursive: true });
    let requirements: Omit<ImportOptions, "directory"> = { requireHumanReview: true };
    const manifest = await readFile(join(p.path, "relay.evidence.json"), "utf8").catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (manifest) {
      if (chosen) throw new Error("Run the full project to satisfy its declared capture plan");
      const parsed = JSON.parse(manifest);
      if (
        Object.keys(parsed).some(
          (key) => !["obligations", "requiredArtifactKinds", "maxArtifactBytes"].includes(key),
        )
      )
        throw new Error("Unknown evidence manifest field");
      requirements = {
        ...importRequirements({ ...parsed, directory: root, requireHumanReview: true }),
        ...(parsed.maxArtifactBytes === undefined
          ? {}
          : { maxArtifactBytes: parsed.maxArtifactBytes }),
      };
    }
    const configurationPath = join(p.path, `.relay-e2e-${executionId}.mjs`);
    let reporter: string;
    try {
      reporter = createRequire(import.meta.url).resolve("@relay/e2e");
    } catch {
      reporter = join(dirname(fileURLToPath(import.meta.url)), "relay-e2e-reporter.mjs");
    }
    await stat(reporter);
    const evidence = join(directory, "import");
    await writeFile(
      configurationPath,
      `import config from ${JSON.stringify(pathToFileURL(resolve(p.path, p.configFile)).href)};\nimport {relayReporter} from ${JSON.stringify(pathToFileURL(reporter).href)};\nif(!Array.isArray(config.targets) || config.targets.some(target=>target.engine?.platform!=='web')) throw new Error('Relay project execution currently qualifies web engines only. Mobile ownership qualification is pending.');\nexport default {...config,reporters:[...(config.reporters??['list']),relayReporter(${JSON.stringify({ directory: evidence, ...requirements })})]};\n`,
      { flag: "wx", mode: 0o600 },
    );
    const value: ExecutionRecord = {
      id: executionId,
      projectId: id,
      status: "running",
      startedAt: Date.now(),
      runIds: [],
      logs: "",
      output: join(p.path, ".relay", "e2e", executionId, "upstream"),
      evidence,
      requirements,
      configurationPath,
      scope,
    };
    await save(value);
    live.set(executionId, value);
    const controller = new AbortController();
    active.set(executionId, controller);
    const args = ["--config", configurationPath, "--output", value.output];
    if (chosen)
      args.push(
        chosen.file,
        "--grep",
        `^${chosen.titlePath.join(" ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "--target",
        chosen.target,
        "--agent",
        chosen.agent,
      );
    void (async () => {
      try {
        const result = await runE2EProject({
          projectRoot: p.path,
          trust: "trusted-project",
          args,
          signal: controller.signal,
          onOutput: (_stream, text) => {
            value.logs = (value.logs + text).slice(-32 * 1024);
          },
        });
        value.exitCode = result.exitCode;
        value.finishedAt = Date.now();
        await importEvidence(value);
      } catch (error) {
        value.status = "interrupted";
        value.error = error instanceof Error ? error.message : "Execution interrupted";
        await save(value);
      } finally {
        active.delete(executionId);
        live.delete(executionId);
        await rm(configurationPath, { force: true });
      }
    })();
    return execution(executionId);
  }
  return {
    list,
    open,
    execution,
    source,
    refresh: async (id: string) => {
      const p = await project(id);
      return open(p.path, "trusted-project", p.configFile);
    },
    run: (id: string, testId: string | undefined, scope: { projectId: string; ownerId: string }) =>
      admissions.run("execution", () => run(id, testId, scope)),
    cancel: async (id: string) => {
      const controller = active.get(id);
      if (!controller)
        throw new Error("This execution is not controlled by the current Relay process");
      controller.abort();
      return execution(id);
    },
    retryImport: async (id: string, scope: { projectId: string; ownerId: string }) => {
      if (active.has(id)) throw new Error("The execution is still active");
      const value = await record(id);
      if (value.scope.projectId !== scope.projectId)
        throw new Error("This execution belongs to another workspace or owner");
      const controller = new AbortController();
      active.set(id, controller);
      live.set(id, value);
      try {
        return await importEvidence(value);
      } finally {
        active.delete(id);
        live.delete(id);
      }
    },
  };
}
