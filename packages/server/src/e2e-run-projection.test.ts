import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importFinishedRun, type FinishedRun } from "@relay/e2e";
import { buildRunVerdict, captureReviewQueueForRun, readCompletedPersistedRun } from "@relay/core";
import { projectE2ERuns } from "./e2e-run-projection.js";

for (const producer of ["step", "attempt"] as const)
  for (const available of [false, true])
    for (const category of [
      "test",
      "infrastructure",
      "passed",
      "flaky",
      "interrupted",
      "skipped",
    ] as const) {
      test(`ordinary e2e Runs preserve ${category} verdicts and ${available ? "available" : "missing"} ${producer} captures`, async () => {
        const root = await mkdtemp(join(tmpdir(), "relay-e2e-projection-"));
        try {
          const source = join(root, "source");
          await mkdir(source);
          if (available)
            await writeFile(
              join(source, "missing.png"),
              Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
                "base64",
              ),
            );
          const failed = category === "test" || category === "infrastructure";
          const status = failed ? "failed" : category;
          const error = failed
            ? {
                category,
                code: "ASSERTION_FAILED",
                message: "Expected ready, observed error",
                retryable: false,
                details: { expected: "ready", observed: "error" },
              }
            : undefined;
          const attempt = {
            id: "attempt",
            index: 0,
            status: failed ? "failed" : "passed",
            startedAt: "2026-10-15T00:00:00Z",
            durationMs: 10,
            error,
            steps: [
              {
                id: "check",
                api: "expect.toHaveText",
                label: "Check status",
                status: failed ? "failed" : "passed",
                startedAt: "2026-10-15T00:00:00Z",
                durationMs: 10,
                error,
              },
            ],
            artifacts: [
              {
                id: "image",
                kind: "screenshot",
                mediaType: "image/png",
                path: "missing.png",
                redaction: "complete",
                producer:
                  producer === "step" ? { kind: "step", stepId: "check" } : { kind: "attempt" },
              },
            ],
          };
          // An interrupted setup may leave evidence without ever starting a step.
          const noSteps = category === "interrupted" && producer === "attempt";
          if (noSteps) attempt.steps = [];
          const report = {
            schemaVersion: "report-1",
            run: {
              id: "upstream",
              runner: { name: "e2e", version: "0.20.0" },
              status: failed ? "failed" : "passed",
              exitCode: failed ? 1 : 0,
              startedAt: "2026-10-15T00:00:00Z",
              finishedAt: "2026-10-15T00:00:01Z",
              results: [
                {
                  id: "result",
                  testId: "test",
                  selected: true,
                  titlePath: ["Settings"],
                  file: "test.e2e.ts",
                  targetId: "web",
                  platform: "web",
                  status,
                  attempts:
                    category === "flaky"
                      ? [
                          {
                            ...attempt,
                            id: "previous",
                            status: "failed",
                            error: { category: "test", message: "Old failed attempt" },
                            steps: [{ ...attempt.steps[0], status: "failed" }],
                          },
                          { ...attempt, index: 1 },
                        ]
                      : [attempt],
                },
              ],
              serialGroups: [],
            },
          } as unknown as FinishedRun["report"];
          const imported = await importFinishedRun(
            {
              report,
              status: report.run.status,
              exitCode: report.run.exitCode,
              artifactsRoot: source,
              projectRoot: root,
              reportPath: undefined,
              aiTracePath: undefined,
              traces: new Map(),
            } as FinishedRun,
            { directory: join(root, "import"), requireHumanReview: true },
            new AbortController().signal,
          );
          const runsRoot = join(root, "runs");
          const ids = await projectE2ERuns({
            report,
            imported,
            runsRoot,
            projectId: "local",
            ownerId: "human",
            projectName: "Fixture",
            sourceProjectId: "fixture",
          });
          const run = await readCompletedPersistedRun(join(runsRoot, ids[0]!));
          assert(run);
          assert.equal(
            run.evidence?.channels.screenshot.status,
            available ? "captured" : "partial",
          );
          const queue = captureReviewQueueForRun(run);
          assert.equal(queue.summary.missing, available ? 0 : 1);
          assert.equal(queue.summary.pending, available ? 1 : 0);
          assert.equal(run.frames.length, available ? (category === "flaky" ? 2 : 1) : 0);
          if (available) {
            assert.equal(run.frames[0]?.stepId, producer === "step" ? "check" : undefined);
          }
          const verdict = buildRunVerdict(run);
          assert.equal(
            verdict.status,
            category === "test"
              ? "failed"
              : category === "infrastructure" || category === "skipped"
                ? "blocked"
                : category === "interrupted"
                  ? "cancelled"
                  : "passed",
          );
          assert.equal(verdict.steps.length, noSteps ? 0 : 1);
          if (failed) {
            assert.equal(verdict.steps[0]?.expected, "ready");
            assert.equal(verdict.steps[0]?.saw, "error");
          }
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
