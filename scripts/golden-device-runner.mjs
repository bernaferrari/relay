import {
  errorRecord,
  fail,
  fixtureFingerprint,
  GoldenAcceptanceError,
  isPointOnlyTarget,
  isRecord,
  isSemanticTarget,
  parseGoldenFixtureConfig,
  REQUIRED_GOLDEN_SCENARIOS,
  selectConfiguredFixtures,
  validateGoldenScenarioRecipe,
} from "./golden-device-contract.mjs";

const TERMINAL_JOB_STATUSES = new Set(["ok", "error", "healed", "cancelled"]);

function requiredJob(response, label) {
  const job = isRecord(response) ? response.job : undefined;
  if (!isRecord(job) || typeof job.id !== "string" || !job.id) {
    fail(`${label} did not return a job id`, "GOLDEN_JOB_RESPONSE_INVALID");
  }
  return job;
}

function assertStrictJobOk(job, label) {
  if (job.status !== "ok") {
    fail(
      `${label} finished ${String(job.status)}; strict acceptance requires first-attempt ok. Inspect restricted acceptance evidence for run details.`,
      "GOLDEN_JOB_FAILED",
    );
  }
}

function fixtureTargetError(job, fixture, label) {
  if (job.serial !== fixture.serial || job.platform !== fixture.platform) {
    return new GoldenAcceptanceError(
      `${label} returned a job for a different configured fixture target.`,
      "GOLDEN_JOB_TARGET_MISMATCH",
    );
  }
}

function assertJobTargetsFixture(job, fixture, label) {
  const error = fixtureTargetError(job, fixture, label);
  if (error) throw error;
}

async function waitForJob(api, jobId, options) {
  const timeoutMs = options.jobTimeoutMs;
  const startedAt = options.now();
  let job;
  while (options.now() - startedAt <= timeoutMs) {
    const response = await api.request({
      operationId: "job.get",
      path: `/jobs/${encodeURIComponent(jobId)}`,
    });
    job = requiredJob(response, `Job ${jobId}`);
    // A terminal status is published before the immutable run manifest has
    // committed. Replay must never race that commit and turn a genuine proof
    // run into a misleading 404, so keep polling until durable evidence is
    // explicitly available as well.
    if (TERMINAL_JOB_STATUSES.has(job.status) && job.persisted === true) return job;
    await options.sleep(options.pollIntervalMs);
  }
  fail(`Job ${jobId} did not finish within ${timeoutMs}ms`, "GOLDEN_JOB_TIMEOUT");
}

function artifactsOf(job) {
  return Array.isArray(job.artifacts) ? job.artifacts.filter(isRecord) : [];
}

function hasTargetResolution(job, acceptedStrategies) {
  return artifactsOf(job).some(
    (artifact) =>
      artifact.kind === "target-resolution" &&
      isRecord(artifact.data) &&
      acceptedStrategies.has(String(artifact.data.strategy ?? artifact.data.method ?? "")),
  );
}

function hasPointFallback(job) {
  const artifacts = artifactsOf(job);
  const fallbackIndex = artifacts.findIndex(
    (artifact) =>
      artifact.kind === "locator-fallback" &&
      isRecord(artifact.data) &&
      isSemanticTarget(artifact.data.original) &&
      isPointOnlyTarget(artifact.data.replacement),
  );
  if (fallbackIndex < 0) return false;
  const fallback = artifacts[fallbackIndex];
  const original = fallback?.data?.original;
  return artifacts
    .slice(0, fallbackIndex)
    .some(
      (artifact) =>
        artifact.kind === "target-resolution-attempt" &&
        isRecord(artifact.data) &&
        artifact.data.status === "failed" &&
        isSemanticTarget(artifact.data.target) &&
        JSON.stringify(artifact.data.target) === JSON.stringify(original),
    );
}

function assertScenarioRuntimeEvidence(scenario, job, fixture) {
  if (scenario === "delayedSemanticFallback" && !hasPointFallback(job)) {
    fail(
      `${fixture.platform} delayed-semantic-fallback did not record a failed semantic attempt followed by a point fallback; a normal semantic pass does not prove the delayed-tree path.`,
      "GOLDEN_SCENARIO_UNPROVEN",
    );
  }
  if (
    scenario === "semanticInput" &&
    !hasTargetResolution(
      job,
      new Set([
        "identifier",
        "ref",
        "label",
        "text",
        "relation",
        "snapshot-label",
        "snapshot-region",
      ]),
    )
  ) {
    fail(
      `${fixture.platform} semantic-input did not record a semantic target resolution.`,
      "GOLDEN_SCENARIO_UNPROVEN",
    );
  }
  if (
    scenario === "pointInput" &&
    !hasTargetResolution(job, new Set(["point", "element-relative-point"]))
  ) {
    fail(
      `${fixture.platform} point-input did not record a point target resolution.`,
      "GOLDEN_SCENARIO_UNPROVEN",
    );
  }
}

async function captureFixtureEvidence(api, writer, fixture, phase) {
  const encoded = encodeURIComponent(fixture.serial);
  const directory = `fixtures/${fixture.platform}/${phase}`;
  const captureSnapshot = () =>
    api.request({
      operationId: "target.snapshot.capture",
      path: `/snapshot?serial=${encoded}&visual=true`,
    });
  const captureScreenshot = () =>
    api.request({
      operationId: "target.screenshot.capture",
      path: `/screenshot?serial=${encoded}&ephemeral=1`,
    });
  if (fixture.platform === "ios") {
    // XCTest AX and screenshot use different channels. Keep this coherent
    // pixels → AX → pixels bracket sequential rather than racing the runner.
    const before = await captureScreenshot();
    await writer.screenshot(`${directory}/before.png`, before);
    const snapshot = await captureSnapshot();
    if (!isRecord(snapshot) || !Array.isArray(snapshot.nodes)) {
      fail("Golden iOS snapshot response was malformed", "GOLDEN_SNAPSHOT_INVALID");
    }
    await writer.json(`${directory}/tree.json`, snapshot);
    const after = await captureScreenshot();
    await writer.screenshot(`${directory}/after.png`, after);
    return { snapshot, screenshot: after };
  }
  const [snapshot, screenshot] = await Promise.all([captureSnapshot(), captureScreenshot()]);
  if (!isRecord(snapshot) || !Array.isArray(snapshot.nodes)) {
    fail("Golden Android snapshot response was malformed", "GOLDEN_SNAPSHOT_INVALID");
  }
  await writer.json(`${directory}/tree.json`, snapshot);
  await writer.screenshot(`${directory}/screen.png`, screenshot);
  return { snapshot, screenshot };
}

function imageDimensions(screenshot, label) {
  const width = Number(screenshot?.width);
  const height = Number(screenshot?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    fail(`${label} did not include usable screenshot dimensions`, "GOLDEN_ROTATION_UNPROVEN");
  }
  return { width, height };
}

async function runRotationScenario(api, writer, fixture) {
  const runStep = async (orientation, phase) => {
    const response = await api.request({
      operationId: "step.run",
      method: "POST",
      path: "/step/run",
      body: { serial: fixture.serial, step: { kind: "rotate", orientation } },
    });
    await writer.json(`fixtures/${fixture.platform}/rotation-${phase}.json`, response);
    if (!isRecord(response) || response.ok !== true) {
      fail(
        `${fixture.platform} rotation ${phase} did not complete successfully.`,
        "GOLDEN_ROTATION_FAILED",
      );
    }
  };
  let landscapeError;
  try {
    // This is the rotation input's entrance proof. The landscape capture below
    // is its exit proof and, in turn, the portrait restoration's entrance.
    await captureFixtureEvidence(api, writer, fixture, "rotation-entrance");
    await runStep(fixture.rotation.orientation, "landscape");
    const landscape = await captureFixtureEvidence(api, writer, fixture, "rotation-landscape");
    const landscapeDimensions = imageDimensions(landscape.screenshot, "Landscape rotation capture");
    if (landscapeDimensions.width <= landscapeDimensions.height) {
      fail(
        `${fixture.platform} rotation did not produce landscape pixels; do not accept an unverified orientation change.`,
        "GOLDEN_ROTATION_UNPROVEN",
      );
    }
  } catch (error) {
    landscapeError = error;
    await writer
      .json(`fixtures/${fixture.platform}/rotation-landscape-error.json`, errorRecord(error))
      .catch(() => undefined);
  }

  // A failed rotation acknowledgement does not prove that the physical device
  // stayed portrait. Always make one bounded restoration attempt before the
  // fixture is released, and preserve both failure records if the recovery is
  // also unsuccessful. The original landscape failure remains the verdict.
  let restoreError;
  try {
    await runStep(fixture.rotation.restoreOrientation, "restore");
    const portrait = await captureFixtureEvidence(api, writer, fixture, "rotation-restored");
    const portraitDimensions = imageDimensions(portrait.screenshot, "Portrait restoration capture");
    if (portraitDimensions.height <= portraitDimensions.width) {
      fail(
        `${fixture.platform} rotation did not restore portrait pixels; fixture must be returned to canonical orientation.`,
        "GOLDEN_ROTATION_UNPROVEN",
      );
    }
  } catch (error) {
    restoreError = error;
    await writer
      .json(`fixtures/${fixture.platform}/rotation-restore-error.json`, errorRecord(error))
      .catch(() => undefined);
  }
  if (landscapeError) throw landscapeError;
  if (restoreError) throw restoreError;
}

async function runRecipe(api, writer, fixture, scenario, options) {
  const recipe = fixture.scenarios[scenario];
  const started = await api.request({
    operationId: "job.start",
    method: "POST",
    path: "/jobs",
    body: { recipe, serial: fixture.serial, platform: fixture.platform, targetKind: "device" },
  });
  const initial = requiredJob(started, `${fixture.platform} ${scenario}`);
  await writer.json(`fixtures/${fixture.platform}/jobs/${scenario}-started.json`, initial);
  // A route can acknowledge one target then publish a mutated terminal job.
  // Keep the first mismatch, but drain its durable completion before accepting
  // the fixture back for final evidence capture.
  const initialTargetError = fixtureTargetError(
    initial,
    fixture,
    `${fixture.platform} ${scenario}`,
  );
  const job = await waitForJob(api, initial.id, options);
  await writer.json(`fixtures/${fixture.platform}/jobs/${scenario}-finished.json`, job);
  if (initialTargetError) throw initialTargetError;
  assertJobTargetsFixture(job, fixture, `${fixture.platform} ${scenario}`);
  assertStrictJobOk(job, `${fixture.platform} ${scenario}`);
  assertScenarioRuntimeEvidence(scenario, job, fixture);
  return job;
}

async function runProofReplay(api, writer, fixture, options) {
  const source = await runRecipe(api, writer, fixture, "proofReplay", options);
  const replay = await api.request({
    operationId: "run.replay",
    method: "POST",
    path: `/runs/${encodeURIComponent(source.id)}/replay`,
    body: {},
  });
  const initial = requiredJob(replay, `${fixture.platform} proof replay`);
  await writer.json(`fixtures/${fixture.platform}/jobs/proof-replay-started.json`, initial);
  const initialTargetError = fixtureTargetError(
    initial,
    fixture,
    `${fixture.platform} proof replay`,
  );
  const job = await waitForJob(api, initial.id, options);
  await writer.json(`fixtures/${fixture.platform}/jobs/proof-replay-finished.json`, job);
  if (initialTargetError) throw initialTargetError;
  assertJobTargetsFixture(job, fixture, `${fixture.platform} proof replay`);
  assertStrictJobOk(job, `${fixture.platform} proof replay`);
  return job;
}

async function preflightFixture(api, writer, fixture) {
  const recover = await api.request({
    operationId: "target.recover",
    method: "POST",
    path: "/device/recover",
    body: { serial: fixture.serial, reason: "connect" },
  });
  await writer.json(`fixtures/${fixture.platform}/recovery.json`, recover);
  if (
    !isRecord(recover) ||
    !isRecord(recover.recovery) ||
    recover.recovery.serial !== fixture.serial ||
    recover.recovery.ready !== true
  ) {
    fail(`${fixture.platform} recovery did not report a ready target.`, "GOLDEN_RECOVERY_FAILED");
  }
  const launch = await api.request({
    operationId: "target.app.launch",
    method: "POST",
    path: "/device/app/launch",
    body: { serial: fixture.serial, app: fixture.app, relaunch: false },
  });
  await writer.json(`fixtures/${fixture.platform}/launch.json`, launch);
  if (
    !isRecord(launch) ||
    !isRecord(launch.launched) ||
    launch.launched.serial !== fixture.serial ||
    launch.launched.app !== fixture.app ||
    launch.launched.platform !== fixture.platform
  ) {
    fail(
      `${fixture.platform} launch did not acknowledge the configured app and fixture.`,
      "GOLDEN_LAUNCH_FAILED",
    );
  }
  await captureFixtureEvidence(api, writer, fixture, "preflight");
}

async function validateFixtureRecipes(api, writer, fixture, options) {
  for (const scenario of REQUIRED_GOLDEN_SCENARIOS) {
    const recipeId = fixture.scenarios[scenario];
    const response = await api.request({
      operationId: "recipe.get",
      path: `/recipes/${encodeURIComponent(recipeId)}`,
    });
    const recipe = isRecord(response) ? response.recipe : undefined;
    validateGoldenScenarioRecipe(recipe, scenario, options.minimumOverlapMs);
    if (recipe.source !== "custom") {
      fail(
        `Golden ${scenario} recipe ${recipe.id} must be a reviewed checked-in .relay.yaml recipe, not a packaged flow.`,
        "GOLDEN_RECIPE_CONTRACT_INVALID",
      );
    }
    await writer.json(`fixtures/${fixture.platform}/recipes/${scenario}.json`, {
      id: recipe.id,
      title: recipe.title,
      source: recipe.source,
      updatedAt: recipe.updatedAt,
      recordingFormatVersion: recipe.recordingFormatVersion,
      quarantined: Boolean(recipe.quarantined),
      stepKinds: recipe.steps.map((step) => step?.kind),
    });
  }
}

async function runFixtureSuite(api, writer, fixture, options) {
  await preflightFixture(api, writer, fixture);
  await runProofReplay(api, writer, fixture, options);
  await captureFixtureEvidence(api, writer, fixture, "after-proof-replay");
  await runRotationScenario(api, writer, fixture);
  for (const scenario of [
    "delayedSemanticFallback",
    "semanticInput",
    "pointInput",
    // iOS trustworthiness lanes: runner killed mid-session, wedged DDI
    // recovery, and app → Settings handoff. Each recipe already proves its
    // own entrance/exit; recovery acknowledgement evidence is captured by
    // preflightFixture and the per-scenario captures below.
    "runnerKillMidSession",
    "ddiUnmountRecover",
    "appHandoffToSettings",
  ]) {
    await runRecipe(api, writer, fixture, scenario, options);
    await captureFixtureEvidence(api, writer, fixture, `after-${scenario}`);
  }
}

function assertParallelScheduling(jobs, fixtures, minimumOverlapMs) {
  if (jobs.length !== fixtures.length) {
    fail("Parallel scheduler did not return both fixture jobs", "GOLDEN_SCHEDULING_UNPROVEN");
  }
  const workerIds = new Set();
  const starts = [];
  const finishes = [];
  jobs.forEach((job, index) => {
    const fixture = fixtures[index];
    if (job.serial !== fixture.serial || job.platform !== fixture.platform) {
      fail(
        "Parallel scheduler assigned a golden job to a different target.",
        "GOLDEN_SCHEDULING_UNPROVEN",
      );
    }
    if (typeof job.workerId !== "string" || !job.workerId) {
      fail("Parallel scheduler did not expose a target worker lane.", "GOLDEN_SCHEDULING_UNPROVEN");
    }
    workerIds.add(job.workerId);
    if (!Number.isFinite(job.startedAt) || !Number.isFinite(job.finishedAt)) {
      fail("Parallel scheduler job lacks start/finish timestamps.", "GOLDEN_SCHEDULING_UNPROVEN");
    }
    starts.push(job.startedAt);
    finishes.push(job.finishedAt);
  });
  if (workerIds.size !== fixtures.length) {
    fail(
      "Parallel scheduler used one worker lane for both hardware fixtures.",
      "GOLDEN_SCHEDULING_UNPROVEN",
    );
  }
  const overlapMs = Math.min(...finishes) - Math.max(...starts);
  if (overlapMs < minimumOverlapMs) {
    fail(
      `Parallel fixture jobs overlapped ${Math.max(0, overlapMs)}ms; expected at least ${minimumOverlapMs}ms.`,
      "GOLDEN_SCHEDULING_UNPROVEN",
    );
  }
  return overlapMs;
}

async function runParallelScheduling(api, writer, fixtures, options) {
  const starts = await Promise.allSettled(
    fixtures.map((fixture) =>
      api.request({
        operationId: "job.start",
        method: "POST",
        path: "/jobs",
        body: {
          recipe: fixture.scenarios.parallelScheduling,
          serial: fixture.serial,
          platform: fixture.platform,
          targetKind: "device",
        },
      }),
    ),
  );
  const initial = [];
  const failures = [];
  const startEvidence = [];
  starts.forEach((result, index) => {
    const fixture = fixtures[index];
    if (result.status === "rejected") {
      failures.push(result.reason);
      startEvidence.push(
        writer.json(
          `fixtures/${fixture.platform}/jobs/parallel-scheduling-start-error.json`,
          errorRecord(result.reason),
        ),
      );
      return;
    }
    try {
      const job = requiredJob(result.value, `${fixture.platform} parallel scheduling`);
      initial.push({ fixture, job });
      const targetError = fixtureTargetError(
        job,
        fixture,
        `${fixture.platform} parallel scheduling`,
      );
      if (targetError) failures.push(targetError);
      startEvidence.push(
        writer.json(`fixtures/${fixture.platform}/jobs/parallel-scheduling-started.json`, job),
      );
    } catch (error) {
      failures.push(error);
      startEvidence.push(
        writer.json(
          `fixtures/${fixture.platform}/jobs/parallel-scheduling-start-error.json`,
          errorRecord(error),
        ),
      );
    }
  });
  const startEvidenceResults = await Promise.allSettled(startEvidence);
  startEvidenceResults.forEach((result) => {
    if (result.status === "rejected") failures.push(result.reason);
  });

  // Do not fail-fast after a partial admission. Every fulfilled start may have
  // begun physical input, so drain its durable terminal result and its evidence
  // before the caller is allowed to take a final fixture capture.
  const settledJobs = await Promise.allSettled(
    initial.map(({ job }) => waitForJob(api, job.id, options)),
  );
  const jobs = [];
  const finishedEvidence = [];
  settledJobs.forEach((result, index) => {
    const { fixture } = initial[index];
    if (result.status === "rejected") {
      failures.push(result.reason);
      finishedEvidence.push(
        writer.json(
          `fixtures/${fixture.platform}/jobs/parallel-scheduling-finish-error.json`,
          errorRecord(result.reason),
        ),
      );
      return;
    }
    jobs.push(result.value);
    finishedEvidence.push(
      writer.json(
        `fixtures/${fixture.platform}/jobs/parallel-scheduling-finished.json`,
        result.value,
      ),
    );
  });
  const finishedEvidenceResults = await Promise.allSettled(finishedEvidence);
  finishedEvidenceResults.forEach((result) => {
    if (result.status === "rejected") failures.push(result.reason);
  });
  if (failures.length) throw failures[0];

  jobs.forEach((job, index) => {
    const fixture = fixtures[index];
    if (!fixture) throw new Error("Parallel scheduler lost its fixture mapping");
    assertJobTargetsFixture(job, fixture, `${fixture.platform} parallel scheduling`);
  });
  jobs.forEach((job, index) =>
    assertStrictJobOk(job, `${fixtures[index].platform} parallel scheduling`),
  );
  const overlapMs = assertParallelScheduling(jobs, fixtures, options.minimumOverlapMs);
  const captures = await Promise.allSettled(
    fixtures.map((fixture) =>
      captureFixtureEvidence(api, writer, fixture, "after-parallel-scheduling"),
    ),
  );
  const captureFailure = captures.find((result) => result.status === "rejected");
  if (captureFailure?.status === "rejected") throw captureFailure.reason;
  return { jobs, overlapMs };
}

function publicConfig(config) {
  return {
    schemaVersion: config.schemaVersion,
    fixtures: Object.fromEntries(
      Object.entries(config.fixtures).map(([platform, fixture]) => [
        platform,
        {
          platform,
          serialFingerprint: fixtureFingerprint(fixture.serial),
          app: fixture.app,
          ...(fixture.expectedName ? { expectedName: fixture.expectedName } : {}),
          ...(fixture.expectedOsVersion ? { expectedOsVersion: fixture.expectedOsVersion } : {}),
          rotation: fixture.rotation,
          scenarios: fixture.scenarios,
        },
      ]),
    ),
    scheduling: config.scheduling,
  };
}

/**
 * Execute the strict two-device hardware lane. It never selects a fallback
 * device, turns a healed run into a pass, or treats missing AX as proof.
 */
export async function runGoldenFixtureAcceptance(input) {
  const config = parseGoldenFixtureConfig(input.config);
  const writer = input.artifacts;
  const api = input.api;
  const now = input.now ?? Date.now;
  const sleep =
    input.sleep ?? ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)));
  const options = {
    now,
    sleep,
    jobTimeoutMs: input.jobTimeoutMs ?? 180_000,
    pollIntervalMs: input.pollIntervalMs ?? 500,
    minimumOverlapMs: config.scheduling.minimumOverlapMs,
  };
  if (!writer || typeof writer.init !== "function") {
    fail("Golden acceptance requires an artifact writer", "GOLDEN_ARTIFACT_WRITER_MISSING");
  }
  if (!api || typeof api.request !== "function") {
    fail("Golden acceptance requires a Relay API client", "GOLDEN_API_MISSING");
  }
  await writer.init();
  const startedAt = now();
  const summary = {
    schemaVersion: 1,
    kind: "relay-golden-device-acceptance",
    startedAt,
    status: "running",
    config: publicConfig(config),
  };
  let selected = [];
  let error;
  let fixtureEvidenceAuthorized = false;
  try {
    await writer.json("fixture-contract.json", publicConfig(config));
    try {
      const doctor = await api.request({ operationId: "system.doctor.get", path: "/doctor" });
      await writer.json("doctor.json", doctor);
    } catch (doctorError) {
      // Recovery and every scenario still run the definitive native checks.
      // Preserve the doctor failure as evidence but do not downgrade it to a pass.
      await writer.json("doctor-error.json", errorRecord(doctorError));
    }
    const inventory = await api.request({ operationId: "target.devices.list", path: "/devices" });
    await writer.json("devices.json", inventory);
    selected = selectConfiguredFixtures(inventory?.devices, config);
    summary.fixtures = selected.map(({ fixture, device }) => ({
      platform: fixture.platform,
      serialFingerprint: fixtureFingerprint(fixture.serial),
      name: device.name,
      osVersion: device.osVersion,
    }));
    // This is a cross-fixture barrier, rather than a per-suite preflight: a
    // malformed iOS recipe must not let Android recover or launch merely
    // because it happened to finish reading first. Let both validations settle
    // so their reviewed-recipe evidence is complete, then refuse all fixture
    // control if either contract is weakened or missing.
    const recipeValidations = await Promise.allSettled(
      selected.map(({ fixture }) => validateFixtureRecipes(api, writer, fixture, options)),
    );
    const recipeValidationFailures = recipeValidations.flatMap((result, index) =>
      result.status === "rejected"
        ? [
            {
              platform: selected[index]?.fixture.platform ?? "unknown",
              ...errorRecord(result.reason),
            },
          ]
        : [],
    );
    if (recipeValidationFailures.length) {
      summary.recipeValidationFailures = recipeValidationFailures;
      const firstFailure = recipeValidations.find((result) => result.status === "rejected");
      if (firstFailure?.status === "rejected") throw firstFailure.reason;
      fail("A recipe contract failed without a failure record", "GOLDEN_RECIPE_CONTRACT_INVALID");
    }
    fixtureEvidenceAuthorized = true;
    // Let both fixture suites settle before final evidence is captured. A
    // fail-fast Promise.all would race final screenshots against the other
    // device still restoring orientation or releasing its native session.
    const fixtureSuites = await Promise.allSettled(
      selected.map(({ fixture }) => runFixtureSuite(api, writer, fixture, options)),
    );
    const fixtureFailures = fixtureSuites.flatMap((result, index) =>
      result.status === "rejected"
        ? [
            {
              platform: selected[index]?.fixture.platform ?? "unknown",
              ...errorRecord(result.reason),
            },
          ]
        : [],
    );
    if (fixtureFailures.length) {
      summary.fixtureSuiteFailures = fixtureFailures;
      const firstFailure = fixtureSuites.find((result) => result.status === "rejected");
      if (firstFailure?.status === "rejected") throw firstFailure.reason;
      fail("A fixture suite failed without a failure record", "GOLDEN_FIXTURE_SUITE_FAILED");
    }
    const parallel = await runParallelScheduling(
      api,
      writer,
      selected.map(({ fixture }) => fixture),
      options,
    );
    summary.parallelScheduling = {
      overlapMs: parallel.overlapMs,
      workerIds: parallel.jobs.map((job) => job.workerId),
    };
    summary.status = "passed";
  } catch (caught) {
    error = caught;
    summary.status = "failed";
    summary.error = errorRecord(caught);
  }
  // Final evidence is deliberately attempted on every selected physical fixture
  // after the global recipe barrier, including a failed recovery or scenario.
  // A bad/missing recipe is the one exception: it must not even claim an AX
  // session after being rejected. A failed final capture also fails an otherwise
  // green lane.
  const finalCaptureErrors = [];
  if (fixtureEvidenceAuthorized) {
    for (const { fixture } of selected) {
      try {
        await captureFixtureEvidence(api, writer, fixture, "final");
      } catch (captureError) {
        finalCaptureErrors.push({ platform: fixture.platform, ...errorRecord(captureError) });
      }
    }
  }
  if (finalCaptureErrors.length) {
    summary.finalCaptureErrors = finalCaptureErrors;
    if (!error) {
      error = new GoldenAcceptanceError(
        "Final fixture evidence capture failed; acceptance cannot claim a complete evidence bundle.",
        "GOLDEN_FINAL_EVIDENCE_FAILED",
      );
      summary.status = "failed";
      summary.error = errorRecord(error);
    }
  }
  summary.finishedAt = now();
  summary.durationMs = Math.max(0, summary.finishedAt - startedAt);
  await writer.manifest(summary);
  if (error) throw error;
  return summary;
}
