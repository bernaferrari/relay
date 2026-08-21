#!/usr/bin/env node
/**
 * Optional local probe by default; strict only when a concrete Android+iOS
 * fixture contract is supplied. The quarantined GitHub workflow always sets
 * GOLDEN_ACCEPTANCE_MODE=required and never falls back to a random device.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGoldenApi,
  GoldenAcceptanceError,
  GoldenArtifactWriter,
  loadGoldenFixtureConfig,
  runGoldenFixtureAcceptance,
} from "./golden-device-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const relayUrl = (process.env.RELAY_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const mode =
  process.env.GOLDEN_ACCEPTANCE_MODE?.trim() ||
  (process.env.GOLDEN_REQUIRE_DEVICE === "1" ? "required" : "optional");
const artifactDirectory = resolve(
  process.env.GOLDEN_ARTIFACT_DIR?.trim() || `${ROOT}/artifacts/golden-device`,
);

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 15 * 60_000) {
    throw new GoldenAcceptanceError(
      `${name} must be an integer between 1 and ${15 * 60_000}`,
      "GOLDEN_RUNTIME_CONFIG_INVALID",
    );
  }
  return parsed;
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function main() {
  if (mode !== "optional" && mode !== "required") {
    throw new GoldenAcceptanceError(
      "GOLDEN_ACCEPTANCE_MODE must be optional or required",
      "GOLDEN_RUNTIME_CONFIG_INVALID",
    );
  }
  const config = await loadGoldenFixtureConfig(process.env);
  if (!config) {
    if (mode === "optional") {
      log("SKIP  no GOLDEN_FIXTURE_CONFIG configured; no hardware was selected or claimed");
      log("golden: optional local probe skipped");
      return;
    }
    throw new GoldenAcceptanceError(
      "Strict golden acceptance requires GOLDEN_FIXTURE_CONFIG with exact Android and iOS fixtures.",
      "GOLDEN_FIXTURE_CONFIG_MISSING",
    );
  }
  const requestTimeoutMs = positiveInteger(
    process.env.GOLDEN_FETCH_TIMEOUT_MS,
    15_000,
    "GOLDEN_FETCH_TIMEOUT_MS",
  );
  const jobTimeoutMs = positiveInteger(
    process.env.GOLDEN_JOB_TIMEOUT_MS,
    180_000,
    "GOLDEN_JOB_TIMEOUT_MS",
  );
  const pollIntervalMs = positiveInteger(
    process.env.GOLDEN_JOB_POLL_INTERVAL_MS,
    500,
    "GOLDEN_JOB_POLL_INTERVAL_MS",
  );
  log(`golden: strict Android+iOS fixture acceptance against ${relayUrl}`);
  log(`golden: writing evidence to ${artifactDirectory}`);
  const summary = await runGoldenFixtureAcceptance({
    config,
    api: createGoldenApi({
      baseUrl: relayUrl,
      actorId: process.env.RELAY_ACTOR_ID ?? "system:golden-device",
      actorKind: "system",
      timeoutMs: requestTimeoutMs,
    }),
    artifacts: new GoldenArtifactWriter(artifactDirectory),
    jobTimeoutMs,
    pollIntervalMs,
  });
  log(
    `PASS  strict golden acceptance (${summary.durationMs}ms; parallel overlap ${summary.parallelScheduling?.overlapMs ?? 0}ms)`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof GoldenAcceptanceError ? ` [${error.code}]` : "";
  log(`FAIL  ${message}${code}`);
  process.exitCode = 1;
});
