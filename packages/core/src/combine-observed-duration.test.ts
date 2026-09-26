import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  combineCampaignBelongsToObservedPack,
  quoteObservedCombinePackDuration,
  quoteObservedPackDuration,
} from "./combine-observed-duration.js";
import { readPersistedRuns } from "./runs.js";

test("one completed pack is an observed sample, not a p95", () => {
  const quote = quoteObservedPackDuration({
    workItemCount: 7,
    samples: [{ campaignId: "seven-a", durationMs: 143_000 }],
  });
  assert.deepEqual(quote, {
    durationMs: 143_000,
    provenance: "observed-sample",
    sampleCount: 1,
    workItemCount: 7,
    campaignIds: ["seven-a"],
  });
});

test("three completed packs quote an observed p95", () => {
  const quote = quoteObservedPackDuration({
    workItemCount: 6,
    samples: [
      { campaignId: "six-a", durationMs: 96_000 },
      { campaignId: "six-b", durationMs: 97_000 },
      { campaignId: "six-c", durationMs: 101_000 },
    ],
  });
  assert.equal(quote?.provenance, "observed-p95");
  assert.equal(quote?.sampleCount, 3);
  assert.equal(quote?.workItemCount, 6);
  assert.equal(quote?.durationMs, 100_600);
});

test("missing samples stay unquoted instead of guessing", () => {
  assert.equal(quoteObservedPackDuration({ workItemCount: 7, samples: [] }), undefined);
});

test("eight-Test daily p95 ignores a two-lane 17s sample", () => {
  const quote = quoteObservedPackDuration({
    workItemCount: 8,
    samples: [
      { campaignId: "60fcdae7", durationMs: 203_384 },
      { campaignId: "19bdd834", durationMs: 201_102 },
      { campaignId: "cbc4711f", durationMs: 202_384 },
      { campaignId: "1445e569", durationMs: 195_736 },
      { campaignId: "a01ab9ca", durationMs: 198_919 },
    ],
  });
  assert.equal(quote?.provenance, "observed-p95");
  assert.equal(quote?.workItemCount, 8);
  assert.equal(quote?.durationMs, 203_184);
  assert.notEqual(quote?.durationMs, 17_254);
});

test("two-lane chrome jobs are not an eight-Test daily pack sample", () => {
  const daily = { appMapId: "grok-web", combineId: "grok-web-daily", workItemCount: 8 };
  assert.equal(
    combineCampaignBelongsToObservedPack(
      {
        appMapId: "grok-web",
        combineId: "grok-web-daily",
        cases: Array.from({ length: 8 }, (_, index) => ({ jobId: `daily-${index}` })),
      },
      daily,
    ),
    true,
  );
  assert.equal(
    combineCampaignBelongsToObservedPack(
      {
        appMapId: "grok-web",
        combineId: "grok-web-daily",
        cases: [{ jobId: "359564dc" }, { jobId: "182e73e4" }],
      },
      daily,
    ),
    false,
  );
});

test("pruned Plan runs do not make the observed quote scan the run store per job (agent-device-ni65)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-observed-duration-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousRuns = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_STATE_DIR = directory;
  process.env.RELAY_RUNS_DIR = join(directory, "runs");
  try {
    // Unrelated, unindexed runs. Each missing job used to fully parse all of them.
    const padding = Array.from({ length: 400 }, (_, index) => `log line ${index} `.repeat(8));
    const writeRun = async (folder: string, run: Record<string, unknown>) => {
      await mkdir(join(directory, "runs", folder), { recursive: true });
      await writeFile(
        join(directory, "runs", folder, "run.json"),
        JSON.stringify({ steps: [], artifacts: [], logs: padding, ...run }, null, 2),
      );
    };
    for (let index = 0; index < 150; index += 1) {
      await writeRun(`2026-01-01T00-00-${String(index).padStart(3, "0")}_other`, {
        id: `other-${index}`,
        action: "other",
        status: "ok",
      });
    }
    // One complete pack whose run folders do not carry the job id.
    await writeRun("kept-a", { id: "kept-a", status: "ok", startedAt: 1_000, finishedAt: 5_000 });
    await writeRun("kept-b", { id: "kept-b", status: "ok", startedAt: 5_000, finishedAt: 9_000 });

    const campaignsDirectory = join(directory, "combine-campaigns", "default");
    await mkdir(campaignsDirectory, { recursive: true });
    const campaign = (id: string, jobIds: string[]) =>
      writeFile(
        join(campaignsDirectory, `${id}.json`),
        JSON.stringify({
          schemaVersion: 1,
          id,
          projectId: "default",
          appMapId: "grok-web",
          combineId: "grok-web-daily",
          cases: jobIds.map((jobId) => ({ jobId })),
          execution: {},
        }),
      );
    await campaign("complete", ["kept-a", "kept-b"]);
    for (let index = 0; index < 80; index += 1) {
      await campaign(`pruned-${index}`, [`gone-${index}-a`, `gone-${index}-b`]);
    }

    const resolved = await readPersistedRuns(["kept-a", "gone-0-a"]);
    assert.equal(resolved.get("kept-a")?.id, "kept-a");
    assert.equal(resolved.get("gone-0-a"), null);

    const started = Date.now();
    const quote = await quoteObservedCombinePackDuration({
      projectId: "default",
      appMapId: "grok-web",
      combineId: "grok-web-daily",
      workItemCount: 2,
    });
    const elapsedMs = Date.now() - started;
    assert.deepEqual(quote, {
      durationMs: 8_000,
      provenance: "observed-sample",
      sampleCount: 1,
      workItemCount: 2,
      campaignIds: ["complete"],
    });
    assert.ok(elapsedMs < 1_500, `observed quote took ${elapsedMs}ms`);
  } finally {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(directory, { recursive: true, force: true });
  }
});
