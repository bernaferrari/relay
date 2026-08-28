import assert from "node:assert/strict";
import test from "node:test";
import { GOLDEN_LOOP_MAX_EVENTS, GOLDEN_LOOP_RETENTION_MS } from "@relay/protocol";
import { createGoldenLoopTelemetrySink } from "./golden-loop-telemetry";

function storageFixture() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  };
}

test("local sink pseudonymizes identity, survives restart, and never persists input keys", async () => {
  const fixture = storageFixture();
  let now = 100;
  const first = createGoldenLoopTelemetrySink({ storage: fixture.storage, now: () => now++ });
  await first.emit({
    projectKey: "private-project-id",
    journeyKey: "private-workflow-id",
    type: "boundary",
    boundary: "connect",
    outcome: "completed",
  });
  const serialized = [...fixture.values.values()].join("\n");
  assert.doesNotMatch(serialized, /private-project-id|private-workflow-id/u);

  const restarted = createGoldenLoopTelemetrySink({ storage: fixture.storage, now: () => now++ });
  await restarted.emit({
    projectKey: "private-project-id",
    journeyKey: "private-workflow-id",
    type: "boundary",
    boundary: "record",
    outcome: "completed",
  });
  const stored = restarted.read();
  assert.equal(stored.events.length, 2);
  assert.equal(stored.events[0]?.projectScopeId, stored.events[1]?.projectScopeId);
  assert.equal(stored.events[0]?.journeyId, stored.events[1]?.journeyId);
  assert.deepEqual(
    stored.events.map((event) => event.sequence),
    [1, 2],
  );
});

test("local retention remains bounded and deterministic", async () => {
  const fixture = storageFixture();
  let now = 1;
  const sink = createGoldenLoopTelemetrySink({ storage: fixture.storage, now: () => now++ });
  for (let index = 0; index < GOLDEN_LOOP_MAX_EVENTS + 5; index += 1) {
    await sink.emit({
      projectKey: "project",
      journeyKey: `journey-${index}`,
      type: "duplicate-input-count",
      count: 0,
    });
  }
  const stored = sink.read();
  assert.equal(stored.events.length, GOLDEN_LOOP_MAX_EVENTS);
  assert.equal(stored.events[0]?.sequence, 6);
  assert.equal(stored.events.at(-1)?.sequence, GOLDEN_LOOP_MAX_EVENTS + 5);
});

test("read and report prune expired events without requiring another emission", async () => {
  const fixture = storageFixture();
  let now = 100;
  const sink = createGoldenLoopTelemetrySink({ storage: fixture.storage, now: () => now });
  await sink.emit({
    projectKey: "project",
    journeyKey: "journey",
    type: "boundary",
    boundary: "connect",
    outcome: "completed",
  });
  now += GOLDEN_LOOP_RETENTION_MS + 1;

  assert.equal(sink.read().events.length, 0);
  assert.equal(sink.report().eventCount, 0);
  assert.equal([...fixture.values.values()].join("\n").includes('"sequence":1'), false);
});

test("measurement resolves harmlessly when local storage is unavailable", async () => {
  const sink = createGoldenLoopTelemetrySink({
    storage: {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
    },
    now: () => 100,
  });

  await assert.doesNotReject(() =>
    sink.emit({
      projectKey: "project",
      journeyKey: "journey",
      type: "boundary",
      boundary: "record",
      outcome: "started",
    }),
  );
});
