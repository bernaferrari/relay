import { e2eRunEvidence } from "./e2e-run-evidence.js";
import { createHash } from "node:crypto";
import { mkdir, copyFile, readFile, link } from "node:fs/promises";
import { join } from "node:path";
import type { FinishedRun } from "@relay/e2e";
import type { importFinishedRun } from "@relay/e2e";
import {
  persistPersistedRun,
  readCompletedPersistedRun,
  withRunWriteLock,
  type PersistedRun,
} from "@relay/core";

export type ImportedE2ERun = Awaited<ReturnType<typeof importFinishedRun>>;
const time = (value?: string) => (value ? Date.parse(value) : 0);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** One retained upstream result becomes one ordinary Relay Run, not a second review store. */
export async function projectE2ERuns(input: {
  report: FinishedRun["report"];
  imported: ImportedE2ERun;
  runsRoot: string;
  projectId: string;
  ownerId: string;
  projectName: string;
  sourceProjectId: string;
}) {
  const { report, imported } = input;
  const runIds: string[] = [];
  const owners = [
    ...report.run.results
      .filter((result) => result.selected && !result.serialGroupId)
      .map((owner) => ({ kind: "result", owner })),
    ...report.run.serialGroups.map((owner) => ({ kind: "serial-group", owner })),
  ];
  for (const { kind, owner } of owners) {
    const id = `e2e-${digest([input.projectId, input.sourceProjectId, report.run.id, imported.receipt.requirementsHash, kind, owner.id]).slice(0, 32)}`;
    const dir = join(input.runsRoot, id);
    await mkdir(join(dir, "frames"), { recursive: true });
    await mkdir(join(dir, "provenance"), { recursive: true });
    await withRunWriteLock(dir, async () => {
      const previous = await readCompletedPersistedRun(dir);
      const frames: PersistedRun["frames"] = [];
      const steps: PersistedRun["steps"] = [];
      const artifacts: PersistedRun["artifacts"] = [
        {
          kind: "e2e-execution",
          capturedAt: time(report.run.finishedAt),
          data: {
            report: { path: "provenance/upstream-report.json" },
            harness: "e2e",
            sourceProjectId: input.sourceProjectId,
            runnerVersion: report.run.runner.version,
            upstreamRunId: report.run.id,
            resultId: owner.id,
            reportHash: imported.receipt.reportHash,
            requirementsHash: imported.receipt.requirementsHash,
            ...("file" in owner
              ? { sourceFile: owner.file, ...("testId" in owner ? { testId: owner.testId } : {}) }
              : {}),
            targetId: owner.targetId,
            upstreamStatus: owner.status,
            finalAttempt: (owner.attempts.at(-1)?.index ?? -1) + 1,
          },
        },
      ];
      const finalAttempt = owner.attempts.at(-1);
      const finalSteps = finalAttempt
        ? "steps" in finalAttempt
          ? finalAttempt.steps
          : finalAttempt.members.flatMap((member) => member.steps)
        : [];
      const failure =
        finalAttempt?.error ??
        (finalAttempt && "members" in finalAttempt
          ? finalAttempt.members.find((member) => member.error)?.error
          : undefined) ??
        finalSteps.find((step) => step.error)?.error;

      for (const attempt of owner.attempts) {
        const attemptSteps =
          "steps" in attempt ? attempt.steps : attempt.members.flatMap((member) => member.steps);
        const framesByStep = new Map<string, PersistedRun["frames"]>();
        const sources = imported.receipt.artifacts.filter(
          (a) =>
            a.ownerKind === kind &&
            a.ownerId === owner.id &&
            a.attemptId === attempt.id &&
            a.source.kind === "screenshot",
        );
        for (const source of sources) {
          const producer = source.source.producer;
          const step =
            producer.kind === "step"
              ? attemptSteps.find((step) => step.id === producer.stepId)
              : undefined;
          const caption = step?.label ?? "Attempt screenshot";
          const capturedAt = time(source.source.startedAt ?? step?.startedAt ?? attempt.startedAt);
          if (
            source.state !== "available" ||
            !source.path ||
            source.source.mediaType !== "image/png"
          ) {
            if (attempt.id === finalAttempt?.id && !imported.receipt.coverage.declared)
              artifacts.push({
                kind: "capture-review",
                capturedAt,
                data: {
                  caption,
                  checkpointId: source.source.id,
                  ...(step ? { stepId: step.id } : {}),
                  invocation: owner.id,
                  attempt: attempt.index + 1,
                  configuration: { app: input.projectName, browser: owner.targetId },
                  status: "missing",
                  reason: source.reason ?? source.state,
                },
              });
            continue;
          }
          const path = `frames/${digest([owner.id, attempt.id, source.source.id])}.png`;
          await copyFile(join(imported.directory, source.path), join(dir, path));
          const bytes = await readFile(join(dir, path));
          const frame = {
            path,
            caption,
            mime: "image/png",
            capturedAt,
            bytes: bytes.length,
            ...(step ? { stepId: step.id } : {}),
            ...(bytes.length > 24 &&
            bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
              : {}),
          };
          frames.push(frame);
          if (step) {
            const stepFrames = framesByStep.get(step.id) ?? [];
            stepFrames.push(frame);
            framesByStep.set(step.id, stepFrames);
          }
          if (attempt.id === finalAttempt?.id && !imported.receipt.coverage.declared)
            artifacts.push({
              kind: "capture-review",
              capturedAt: frame.capturedAt,
              data: {
                caption,
                mime: "image/png",
                framePath: path,
                imageSha256: source.sha256,
                checkpointId: source.source.id,
                ...(step ? { stepId: step.id } : {}),
                invocation: owner.id,
                attempt: attempt.index + 1,
                configuration: { app: input.projectName, browser: owner.targetId },
              },
            });
        }
        for (const step of attemptSteps) {
          const stepFrames = framesByStep.get(step.id) ?? [];
          steps.push({
            id: step.id,
            index: steps.length,
            attempt: attempt.index + 1,
            title: `${step.api} · ${step.label}`,
            kind: step.api === "app.screenshot" ? "Capture" : "Verify",
            tone: step.status === "passed" ? "pass" : step.status === "failed" ? "fail" : "dim",
            glyphs: step.api === "app.screenshot" ? ["shot"] : [],
            status:
              step.status === "passed" ? "ok" : step.status === "failed" ? "error" : undefined,
            startedAt: time(step.startedAt),
            finishedAt: time(step.startedAt) + (step.durationMs ?? 0),
            durationMs: step.durationMs,
            frames: stepFrames,
            log: JSON.stringify({
              status: step.status,
              api: step.api,
              label: step.label,
              ...(step.error ? { error: step.error } : {}),
              source: step.source,
            }),
          });
        }
      }
      for (const slot of imported.receipt.coverage.obligations ?? []) {
        if (
          !("testId" in owner) ||
          !("resultId" in slot) ||
          slot.resultId !== owner.id ||
          slot.testId !== owner.testId ||
          slot.targetId !== owner.targetId ||
          (slot.agent !== undefined && slot.agent !== owner.agent) ||
          (slot.repeat !== undefined && slot.repeat !== owner.repeat)
        )
          continue;
        const candidates = imported.receipt.artifacts.filter(
          (a) =>
            a.ownerId === owner.id &&
            a.attemptId === finalAttempt?.id &&
            slot.artifactIds.includes(a.source.id) &&
            a.state === "available" &&
            a.source.mediaType === "image/png",
        );
        const source = slot.state === "available" ? candidates[0] : undefined;
        const frame = source
          ? frames.find(
              (f) =>
                f.path === `frames/${digest([owner.id, source.attemptId, source.source.id])}.png`,
            )
          : undefined;
        artifacts.push({
          kind: "capture-review",
          capturedAt: time(report.run.finishedAt),
          data: {
            caption: slot.stepLabel,
            checkpointId: slot.id,
            requirementId: imported.receipt.requirementsHash,
            invocation: owner.id,
            attempt: (finalAttempt?.index ?? 0) + 1,
            configuration: { app: input.projectName, browser: owner.targetId },
            ...(frame
              ? { framePath: frame.path, imageSha256: source?.sha256, stepId: frame.stepId }
              : { status: "missing" }),
          },
        });
      }
      // Hard-link the original report for provenance without duplicating large documents on disk.
      await link(
        join(imported.directory, "report.json"),
        join(dir, "provenance/upstream-report.json"),
      ).catch(async (error) => {
        if (error.code !== "EEXIST")
          await copyFile(
            join(imported.directory, "report.json"),
            join(dir, "provenance/upstream-report.json"),
          );
      });
      const status = owner.status;
      const run: PersistedRun = {
        schemaVersion: 5,
        id,
        dir,
        projectId: input.projectId,
        ownerId: input.ownerId,
        action: `e2e:${owner.id}`,
        title: `e2e · ${owner.titlePath.join(" › ")} · ${owner.targetId}`,
        serial: owner.targetId,
        deviceName: owner.targetId,
        platform: owner.platform === "web" ? "browser" : owner.platform,
        status:
          status === "passed" || status === "flaky"
            ? "succeeded"
            : status === "interrupted"
              ? "cancelled"
              : status === "skipped"
                ? "blocked"
                : "failed",
        outcome:
          status === "passed" || status === "flaky"
            ? "passed"
            : status === "interrupted"
              ? "cancelled"
              : status === "skipped"
                ? "harness-failure"
                : failure?.category === "test"
                  ? "product-failure"
                  : failure &&
                      ["configuration", "infrastructure", "internal"].includes(failure.category)
                    ? "harness-failure"
                    : "uncertain",
        ...(failure ? { error: failure.message } : {}),
        attempts: owner.attempts.length,
        queuedAt: time(report.run.startedAt),
        startedAt: time(report.run.startedAt),
        finishedAt: time(report.run.finishedAt),
        durationMs: owner.attempts.reduce((sum, a) => sum + (a.durationMs ?? 0), 0),
        writtenAt: Date.now(),
        inputDigest: imported.receipt.reportHash,
        resolvedInputs: {},
        logs: [],
        steps,
        frames,
        frameCount: frames.length,
        artifacts,
        referenceReviewMode: "human",
        ...(previous?.captureReviews ? { captureReviews: previous.captureReviews } : {}),
        ...(previous?.captureReviewReceipts
          ? { captureReviewReceipts: previous.captureReviewReceipts }
          : {}),
      };
      run.evidence = e2eRunEvidence(run);
      await persistPersistedRun(input.runsRoot, run, run, "e2e-import");
    });
    runIds.push(id);
  }
  return runIds;
}
