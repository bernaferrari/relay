import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FinishedRun } from "e2e";
import { copyArtifact, type ImportedArtifact } from "./artifacts.js";

export type CaptureObligation = {
  id: string;
  testId: string;
  targetId: string;
  stepLabel: string;
  agent?: string;
  repeat?: number;
};
export type ImportOptions = {
  directory: string;
  obligations?: readonly CaptureObligation[];
  requireHumanReview?: boolean;
  maxArtifactBytes?: number;
};
export async function atomicJson(path: string, value: unknown, signal?: AbortSignal) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value, null, 2), { signal, mode: 0o600 });
    signal?.throwIfAborted();
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}
export const runDirectory = (directory: string, runId: string) =>
  resolve(directory, createHash("sha256").update(runId).digest("hex"));

/** Imports evidence, never executes code or reinterprets the upstream verdict. */
export async function importFinishedRun(
  run: FinishedRun,
  options: ImportOptions,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (run.report.schemaVersion !== "report-1" || run.report.run.runner.version !== "0.20.0")
    throw new Error("Unsupported e2e report or runner version");
  if (run.status !== run.report.run.status || run.exitCode !== run.report.run.exitCode)
    throw new Error("Finished run disagrees with its canonical report");
  const directory = runDirectory(options.directory, run.report.run.id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const reportHash = createHash("sha256").update(JSON.stringify(run.report)).digest("hex");
  const reportPath = resolve(directory, "report.json");
  try {
    const previous = JSON.parse(await readFile(reportPath, "utf8"));
    if (createHash("sha256").update(JSON.stringify(previous)).digest("hex") !== reportHash)
      throw new Error("Conflicting report for an already imported run identity");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  // An atomic hard-link publishes a complete immutable report before evidence work.
  // Parallel deliveries cannot both claim the same run with different reports.
  const candidate = `${reportPath}.${randomUUID()}.candidate`;
  try {
    await writeFile(candidate, JSON.stringify(run.report, null, 2), { signal, mode: 0o600 });
    signal.throwIfAborted();
    try {
      await link(candidate, reportPath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const existing = JSON.parse(await readFile(reportPath, "utf8"));
      if (createHash("sha256").update(JSON.stringify(existing)).digest("hex") !== reportHash)
        throw new Error("Conflicting report for an already imported run identity");
    }
  } finally {
    await rm(candidate, { force: true });
  }
  let previousArtifacts: ImportedArtifact[] = [];
  try {
    const previous = JSON.parse(await readFile(resolve(directory, "receipt.json"), "utf8"));
    if (previous.reportHash === reportHash && Array.isArray(previous.artifacts))
      previousArtifacts = previous.artifacts;
  } catch {
    /* Missing or damaged receipts can be repaired from upstream evidence. */
  }
  const artifacts: ImportedArtifact[] = [];
  const owners = [
    ...run.report.run.results.map((owner) => ({ kind: "result", owner })),
    ...run.report.run.serialGroups.map((owner) => ({ kind: "serial-group", owner })),
    ...(run.report.run.carried?.results ?? []).map((owner) => ({ kind: "carried-result", owner })),
    ...(run.report.run.carried?.serialGroups ?? []).map((owner) => ({
      kind: "carried-serial-group",
      owner,
    })),
  ];
  for (const { kind, owner } of owners)
    for (const attempt of owner.attempts)
      for (const source of attempt.artifacts) {
        const cached = previousArtifacts.find(
          (item) =>
            item?.ownerKind === kind &&
            item.ownerId === owner.id &&
            item.attemptId === attempt.id &&
            item.source?.id === source.id &&
            item.state === "available" &&
            typeof item.path === "string" &&
            /^artifacts\/[a-f0-9]{64}$/.test(item.path) &&
            item.path === `artifacts/${item.sha256}`,
        );
        let copied = cached
          ? await copyArtifact(
              { ...source, path: cached.path, sha256: cached.sha256, size: cached.size },
              directory,
              directory,
              signal,
              options.maxArtifactBytes ?? 64 * 1024 * 1024,
            )
          : undefined;
        if (!copied || copied.state !== "available")
          copied = await copyArtifact(
            source,
            run.artifactsRoot,
            directory,
            signal,
            options.maxArtifactBytes ?? 64 * 1024 * 1024,
          );
        artifacts.push({
          ownerKind: kind,
          ownerId: owner.id,
          attemptId: attempt.id,
          attemptIndex: attempt.index,
          source,
          ...copied,
        });
      }
  const obligations = options.obligations?.map((obligation) => {
    const results = run.report.run.results.filter(
      (result) =>
        result.testId === obligation.testId &&
        result.targetId === obligation.targetId &&
        result.selected &&
        (obligation.agent === undefined || result.agent === obligation.agent) &&
        (obligation.repeat === undefined || result.repeat === obligation.repeat),
    );
    if (results.length !== 1)
      return { ...obligation, state: results.length ? "ambiguous" : "missing", artifactIds: [] };
    const result = results[0]!;
    const attempt = result.attempts.at(-1);
    // Serial-group coverage is not guessed from another member's shared artifacts.
    const steps =
      attempt?.steps.filter(
        (step) => step.api === "app.screenshot" && step.label === obligation.stepLabel,
      ) ?? [];
    const matches = artifacts.filter(
      (item) =>
        item.ownerKind === "result" &&
        item.ownerId === result.id &&
        item.attemptId === attempt?.id &&
        item.source.kind === "screenshot" &&
        item.source.producer.kind === "step" &&
        steps.some(
          (step) => item.source.producer.kind === "step" && step.id === item.source.producer.stepId,
        ),
    );
    return {
      ...obligation,
      state: matches.some((item) => item.state === "available") ? "available" : "missing",
      artifactIds: matches.map((item) => item.source.id),
    };
  });
  const evidenceComplete =
    artifacts.every((item) => item.state === "available") &&
    (obligations?.every((item) => item.state === "available") ?? true);
  const receipt = {
    schemaVersion: "relay-e2e-import-1",
    harness: "e2e",
    reportHash,
    upstream: {
      schemaVersion: run.report.schemaVersion,
      runner: run.report.run.runner,
      status: run.status,
      exitCode: run.exitCode,
      runId: run.report.run.id,
    },
    provenance: {
      projectRoot: run.projectRoot,
      reportPath: run.reportPath,
      artifactsRoot: run.artifactsRoot,
      traces: Object.fromEntries(run.traces),
      aiTracePath: run.aiTracePath,
    },
    artifacts,
    coverage: { declared: obligations !== undefined, expected: obligations?.length, obligations },
    acceptance: {
      evidenceComplete,
      humanReview: options.requireHumanReview ? "pending" : "not-required",
      state: !evidenceComplete
        ? "blocked"
        : run.status !== "passed"
          ? "execution-not-passed"
          : options.requireHumanReview
            ? "pending-review"
            : "evidence-ready",
    },
  };
  signal.throwIfAborted();
  if (run.lastRun)
    await atomicJson(resolve(directory, "previous-report.json"), run.lastRun, signal);
  await atomicJson(resolve(directory, "receipt.json"), receipt, signal);
  return { directory, receipt };
}
