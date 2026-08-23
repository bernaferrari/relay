import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("canonical r167 compiler proof stays at least 20% smaller without protected evidence loss", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("./fixtures/relay-40-r167-compiler-benchmark.json", import.meta.url),
      "utf8",
    ),
  ) as {
    authoredSteps: number;
    before: { executableOperations: number; operationCounts: Record<string, number> };
    after: { executableOperations: number; operationCounts: Record<string, number> };
    protectedEvidence: {
      mutationOperationsBefore: number;
      mutationOperationsAfter: number;
      fullSurfaceCapturesBefore: number;
      fullSurfaceCapturesAfter: number;
      intentionalTerminalFramesAfter: number;
    };
  };
  const count = (counts: Record<string, number>) =>
    Object.values(counts).reduce((total, value) => total + value, 0);
  const reduction = 1 - fixture.after.executableOperations / fixture.before.executableOperations;

  assert.equal(fixture.authoredSteps, 39);
  assert.equal(count(fixture.before.operationCounts), fixture.before.executableOperations);
  assert.equal(count(fixture.after.operationCounts), fixture.after.executableOperations);
  assert.ok(reduction >= 0.2, `expected >=20% reduction, received ${reduction * 100}%`);
  assert.ok(Math.abs(reduction - 83 / 308) < Number.EPSILON);
  assert.equal(
    fixture.protectedEvidence.mutationOperationsAfter,
    fixture.protectedEvidence.mutationOperationsBefore,
  );
  assert.equal(
    fixture.protectedEvidence.fullSurfaceCapturesAfter,
    fixture.protectedEvidence.fullSurfaceCapturesBefore,
  );
  assert.equal(
    fixture.after.operationCounts.screenshot,
    fixture.protectedEvidence.intentionalTerminalFramesAfter,
  );
  assert.equal(fixture.after.operationCounts.tap, fixture.before.operationCounts.tap);
  assert.equal(fixture.after.operationCounts.key, fixture.before.operationCounts.key);
  assert.equal(fixture.after.operationCounts.reveal, fixture.before.operationCounts.reveal);
  assert.equal(
    fixture.after.operationCounts["capture-surface"],
    fixture.before.operationCounts["capture-surface"],
  );
});
