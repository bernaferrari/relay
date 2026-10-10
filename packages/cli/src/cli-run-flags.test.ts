import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPlanCliFlags,
  applyLaneFlag,
  flattenCombineStartTarget,
  evidencePackCliFlags,
  parseBudgetMs,
  parseRunOutDir,
  assertRecoverHasTarget,
  recoverInputFromLane,
  startedPlanBatchId,
} from "./cli-run-flags.js";

test("plan run flattens test-run target JSON onto combine start fields", () => {
  assert.deepEqual(
    flattenCombineStartTarget({
      appMapId: "grok-android",
      combineId: "grok-android-daily",
      target: { kind: "device", platform: "android", targetId: "RQCY104BG8X" },
    }),
    {
      appMapId: "grok-android",
      combineId: "grok-android-daily",
      serial: "RQCY104BG8X",
      targetKind: "device",
      platform: "android",
    },
  );
});

test("parses budget units used by the three-minute findings loop", () => {
  assert.equal(parseBudgetMs("3m"), 180_000);
  assert.equal(parseBudgetMs("180s"), 180_000);
  assert.throws(() => parseBudgetMs("3"), /--budget must look like/);
});

test("budget and findings flags stay on Plan commands", () => {
  const tokens = {
    values: new Map([["--budget", "3m"]]),
    switches: new Set(["--findings"]),
  };
  assert.doesNotThrow(() => assertPlanCliFlags("job.combine.start", tokens));
  assert.throws(() => assertPlanCliFlags("job.get", tokens), /--budget is only valid/);
});

test("Jev triage is explicit and stays attached to saved findings", () => {
  const tokens = {
    values: new Map([["--triage", "jev"]]),
    switches: new Set(["--findings"]),
  };
  assert.doesNotThrow(() => assertPlanCliFlags("job.combine.start", tokens));
  assert.doesNotThrow(() => assertPlanCliFlags("job.combine.analysis", tokens));
  assert.throws(
    () => assertPlanCliFlags("job.combine.start", { values: tokens.values, switches: new Set() }),
    /requires --findings/u,
  );
  assert.throws(
    () =>
      assertPlanCliFlags("job.combine.start", {
        values: new Map([["--triage", "anything-else"]]),
        switches: new Set(["--findings"]),
      }),
    /accepts only/u,
  );
});

test("export and todo flags stay on Plan and combine export", () => {
  const tokens = {
    values: new Map([
      ["--export", "/tmp/pack"],
      ["--todo", "todo.json"],
    ]),
    switches: new Set<string>(),
  };
  assert.doesNotThrow(() => assertPlanCliFlags("job.combine.start", tokens));
  assert.doesNotThrow(() => assertPlanCliFlags("job.combine.export", tokens));
  assert.throws(
    () => assertPlanCliFlags("job.get", tokens),
    /--export is only valid on plan run or plan export/,
  );
});

test("plan --export without wait is a usage error", () => {
  assert.throws(
    () =>
      evidencePackCliFlags(
        { values: new Map([["--export", "/tmp/pack"]]), switches: new Set() },
        "job.combine.start",
        false,
      ),
    /require waiting for the Plan to finish/,
  );
});

test("reads campaign id from a Combine start result", () => {
  assert.equal(
    startedPlanBatchId({ campaign: { id: "camp-1" }, batch: { id: "batch-1" } }),
    "camp-1",
  );
  assert.equal(startedPlanBatchId({ batch: { id: "batch-1" } }), "batch-1");
});

test("--out is only a run-verb directory", () => {
  const tokens = { values: new Map([["--out", "/tmp/relay-out"]]), switches: new Set<string>() };
  assert.equal(parseRunOutDir(tokens, true), "/tmp/relay-out");
  assert.throws(() => parseRunOutDir(tokens, false), /only valid on run verbs/);
  assert.equal(parseRunOutDir({ values: new Map(), switches: new Set() }, true), undefined);
});

test("--lane is only valid on run and interact verbs", () => {
  const tokens = { values: new Map([["--lane", "grok-daily"]]), switches: new Set<string>() };
  assert.deepEqual(applyLaneFlag("app-map.test.run", { appMapId: "grok-web" }, tokens), {
    appMapId: "grok-web",
    laneId: "grok-daily",
  });
  assert.deepEqual(applyLaneFlag("job.combine.start", { combineId: "daily" }, tokens), {
    combineId: "daily",
    laneId: "grok-daily",
  });
  assert.deepEqual(applyLaneFlag("target.interact", { kind: "label" }, tokens), {
    kind: "label",
    laneId: "grok-daily",
  });
  assert.deepEqual(applyLaneFlag("target.snapshot.capture", { full: true }, tokens), {
    full: true,
    laneId: "grok-daily",
  });
  assert.throws(() => applyLaneFlag("app-map.get", {}, tokens), /only valid on test run/);
  assert.throws(
    () =>
      applyLaneFlag(
        "app-map.test.run",
        {},
        {
          values: new Map([
            ["--lane", "grok-daily"],
            ["--revision", "current"],
          ]),
          switches: new Set(),
        },
      ),
    /omit --target and --revision/,
  );
  assert.throws(
    () =>
      applyLaneFlag(
        "app-map.test.run",
        {},
        {
          values: new Map([["--lane", "  "]]),
          switches: new Set(),
        },
      ),
    /--lane requires a Lane identifier/,
  );
});

test("device recover --lane becomes the Lane target serial", () => {
  assert.deepEqual(
    recoverInputFromLane({ laneId: "grok-daily" }, [
      { id: "grok-daily", target: { kind: "browser", browserTargetId: "browser-1" } },
    ]),
    { serial: "browser-1" },
  );
  assert.throws(
    () => recoverInputFromLane({ serial: "ipad", laneId: "grok-daily" }, []),
    /not both/u,
  );
});

test("device recover without a serial or Lane is refused", () => {
  assert.throws(() => assertRecoverHasTarget({}), /serial or --lane/u);
  assertRecoverHasTarget({ serial: "ipad" });
  assertRecoverHasTarget({ laneId: "grok-daily" });
});
