import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FinishedRun } from "e2e";
import { copyArtifact, type ImportedArtifact } from "./artifacts.js";

import { freezeImportSpec, type ImportOptions } from "./import-spec.js";
import { resolveCaptureObligations } from "./capture-obligations.js";
export type { CaptureObligation, ImportOptions } from "./import-spec.js";
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
  const spec = await freezeImportSpec(directory, run.report.run.id, reportHash, options, signal);
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
  const incomingSource = {
    projectRoot: run.projectRoot,
    reportPath: run.reportPath,
    artifactsRoot: run.artifactsRoot,
    traces: [...run.traces],
    aiTracePath: run.aiTracePath,
  };
  const sourcePath = resolve(directory, "import-source.json");
  const sourceCandidate = `${sourcePath}.${randomUUID()}.candidate`;
  let provenance: typeof incomingSource;
  try {
    await writeFile(sourceCandidate, JSON.stringify(incomingSource), { signal, mode: 0o600 });
    await link(sourceCandidate, sourcePath).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    provenance = JSON.parse(await readFile(sourcePath, "utf8"));
  } finally {
    await rm(sourceCandidate, { force: true });
  }
  // A partial retry is only a prefix; it must never replace the completed
  // receipt's cache of already retained artifacts.
  const previousArtifacts: ImportedArtifact[] = [];
  for (const name of ["receipt.json", "import-progress.json"]) {
    try {
      const previous = JSON.parse(await readFile(resolve(directory, name), "utf8"));
      if (previous.reportHash === reportHash && Array.isArray(previous.artifacts))
        previousArtifacts.push(...previous.artifacts);
    } catch {
      /* Recover each valid receipt independently of missing/damaged progress. */
    }
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
              spec.requirements.maxArtifactBytes,
            )
          : undefined;
        if (!copied || copied.state !== "available")
          copied = await copyArtifact(
            source,
            run.artifactsRoot,
            directory,
            signal,
            spec.requirements.maxArtifactBytes,
          );
        artifacts.push({
          ownerKind: kind,
          ownerId: owner.id,
          attemptId: attempt.id,
          attemptIndex: attempt.index,
          source,
          ...copied,
        });
        await atomicJson(
          resolve(directory, "import-progress.json"),
          { reportHash, artifacts },
          signal,
        );
      }
  const obligations = resolveCaptureObligations(run, artifacts, spec.requirements.obligations);
  const requiredArtifacts = artifacts.filter((item) => {
    if (!spec.requirements.requiredArtifactKinds.includes(item.source.kind)) return false;
    const owner = owners.find(
      ({ kind, owner }) => kind === item.ownerKind && owner.id === item.ownerId,
    );
    return (
      owner &&
      !owner.kind.startsWith("carried-") &&
      owner.owner.attempts.at(-1)?.id === item.attemptId
    );
  });
  const evidenceComplete =
    requiredArtifacts.every((item) => item.state === "available") &&
    (obligations?.every((item) => item.state === "available") ?? true);
  const receipt = {
    schemaVersion: "relay-e2e-import-1",
    harness: "e2e",
    reportHash,
    requirementsHash: spec.requirementsHash,
    requirements: spec.requirements,
    upstream: {
      schemaVersion: run.report.schemaVersion,
      runner: run.report.run.runner,
      status: run.status,
      exitCode: run.exitCode,
      runId: run.report.run.id,
    },
    provenance: { ...provenance, traces: Object.fromEntries(provenance.traces) },
    artifacts,
    coverage: { declared: obligations !== undefined, expected: obligations?.length, obligations },
    acceptance: {
      evidenceComplete,
      humanReview: spec.requirements.requireHumanReview ? "pending" : "not-required",
      state: !evidenceComplete
        ? "blocked"
        : run.status !== "passed"
          ? "execution-not-passed"
          : spec.requirements.requireHumanReview
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
