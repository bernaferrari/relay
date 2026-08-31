#!/usr/bin/env node
/**
 * Prerequisite-gated live Change Proof demonstration.
 *
 * This harness may drive an ephemeral managed Chromium target, but it never
 * treats a missing Android target, fixture APK, or TracePack as passing. The
 * Android side remains delegated to Relay's reviewed App Map/Test; this file
 * does not invent a package, serial, source head, or persisted Run.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultCommand,
  inspectAndroidPrerequisites,
  inspectExactProofInputs,
  inspectManagedBrowserTargets,
  inspectTracePack,
} from "./change-proof-golden-live-prerequisites.mjs";
export {
  defaultCommand,
  inspectAndroidPrerequisites,
  inspectExactProofInputs,
  inspectManagedBrowserTargets,
  inspectTracePack,
} from "./change-proof-golden-live-prerequisites.mjs";
import { cliResultEnvelope, defaultCliRunner, unwrapCliResult } from "./dogfood-proof-loop.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_RELAY_URL = "http://127.0.0.1:8787";
const DEFAULT_ARTIFACT_DIR = join(ROOT, "proof-out", "change-proof-golden-live");
const MAX_FRAME_BYTES = 18 * 1024 * 1024;
const MAX_REPORT_BYTES = 512 * 1024;

export const CHANGE_PROOF_GOLDEN_LIVE = Object.freeze({
  schemaVersion: 1,
  journey: Object.freeze({
    appMapId: "settings",
    testId: "settings-language-arabic",
    label: "Settings → Language → Arabic",
  }),
  browser: Object.freeze({
    engine: "chromium",
    viewport: Object.freeze({ width: 390, height: 844 }),
    locale: "ar",
    timezoneId: "UTC",
    environmentRevision: "change-proof-golden-live-v1",
  }),
  seededFailure: "Primary action overlaps the Arabic description by 22 px.",
});

export const CHANGE_PROOF_GOLDEN_LIVE_EXIT_CODES = Object.freeze({
  proved: 0,
  regression: 9,
  insufficientEvidence: 8,
  usage: 2,
});

export class GoldenLiveError extends Error {
  constructor(message, code = "GOLDEN_LIVE_INVALID") {
    super(message);
    this.name = "GoldenLiveError";
    this.code = code;
  }
}

function bounded(value, max = 480) {
  return String(value ?? "").slice(0, max);
}

function blocker(id, reason, detail) {
  return Object.freeze({ id, reason, ...(detail ? { detail: bounded(detail) } : {}) });
}

function usage() {
  return (
    `Usage: node scripts/change-proof-golden-live.mjs [--run-web] [--artifact-dir <dir>]\n\n` +
    `Android proof requires RELAY_GOLDEN_ANDROID_SERIAL, RELAY_GOLDEN_ANDROID_APP_PATH, ` +
    `RELAY_GOLDEN_ANDROID_APP_ID, RELAY_GOLDEN_ANDROID_APP_MAP_ID, ` +
    `RELAY_GOLDEN_ANDROID_TEST_ID, and old/new exact heads plus TracePacks.`
  );
}

export function parseGoldenLiveArgs(argv) {
  let runWeb = false;
  let artifactDir = DEFAULT_ARTIFACT_DIR;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--run-web") {
      runWeb = true;
      continue;
    }
    if (flag === "--artifact-dir") {
      const value = argv[index + 1]?.trim();
      if (!value) throw new GoldenLiveError(`${flag} requires a directory\n${usage()}`);
      artifactDir = resolve(value);
      index += 1;
      continue;
    }
    throw new GoldenLiveError(`Unknown argument ${String(flag)}\n${usage()}`);
  }
  return { runWeb, artifactDir };
}

function browserEnvironment() {
  return {
    schemaVersion: 1,
    engine: CHANGE_PROOF_GOLDEN_LIVE.browser.engine,
    viewport: CHANGE_PROOF_GOLDEN_LIVE.browser.viewport,
    screen: CHANGE_PROOF_GOLDEN_LIVE.browser.viewport,
    deviceScaleFactor: 1,
    mobile: false,
    touch: false,
    locale: CHANGE_PROOF_GOLDEN_LIVE.browser.locale,
    timezoneId: CHANGE_PROOF_GOLDEN_LIVE.browser.timezoneId,
    colorScheme: "light",
    reducedMotion: "no-preference",
    permissions: [],
    offline: false,
    environmentRevision: CHANGE_PROOF_GOLDEN_LIVE.browser.environmentRevision,
  };
}

function fixtureMarkup(head) {
  const repaired = head === "repaired";
  const title = repaired ? "Arabic — RTL fixed" : "Arabic — RTL regression";
  const overlap = repaired
    ? ""
    : `<p id="regression" role="alert">${CHANGE_PROOF_GOLDEN_LIVE.seededFailure}</p>`;
  return `<!doctype html><html lang="ar"><head><meta charset="utf-8"><title>Settings</title><style>
body{font:20px system-ui;margin:0;padding:32px;background:#fff;color:#111}button{display:block;font:inherit;margin:24px 0;padding:12px 18px}main{max-width:340px}#regression{color:#a00} .done{direction:rtl}
</style></head><body><main id="app"><h1 id="heading">Settings</h1><button id="language" data-testid="settings-language">Language</button></main><script>
const app=document.querySelector('#app');
document.querySelector('#language').addEventListener('click',()=>{app.innerHTML='<h1 id="heading">Language</h1><button id="arabic" data-testid="language-arabic">Arabic</button>';document.title='Language'});
document.addEventListener('click',event=>{if(event.target.id!=='arabic')return;app.className='done';app.innerHTML='<h1 id="heading">${title}</h1><p id="description">Arabic description</p><button id="primary" data-testid="primary-action">Continue</button>${overlap}';document.title='${title}'});
</script></body></html>`;
}

export async function startGoldenFixtureServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const head = url.searchParams.get("head");
    if (url.pathname !== "/settings" || (head !== "old" && head !== "repaired")) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
      return;
    }
    const body = fixtureMarkup(head);
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(body),
    });
    response.end(body);
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address !== "object")
    throw new GoldenLiveError("Fixture server has no bound port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolvePromise, rejectPromise) =>
        server.close((error) => (error ? rejectPromise(error) : resolvePromise())),
      ),
  };
}

async function invokeRelayOperation(cli, relayUrl, actor, operationId, input) {
  const result = await cli(
    ["operation", "invoke", operationId, "--input", JSON.stringify(input), "--json"],
    { env: { ...process.env, RELAY_URL: relayUrl, RELAY_ACTOR_ID: actor } },
  );
  if (result.code !== 0) {
    const detail = result.stderr?.trim().split("\n").at(-1) ?? "";
    throw new GoldenLiveError(
      `${operationId} exited ${result.code}${detail ? `: ${bounded(detail)}` : ""}`,
      "GOLDEN_LIVE_RELAY_OPERATION_FAILED",
    );
  }
  const terminal = cliResultEnvelope(result.stdout);
  if (!terminal)
    throw new GoldenLiveError(
      `${operationId} returned no result envelope`,
      "GOLDEN_LIVE_RELAY_RESPONSE_INVALID",
    );
  try {
    return unwrapCliResult(terminal);
  } catch (error) {
    throw new GoldenLiveError(
      error?.message ?? String(error),
      "GOLDEN_LIVE_RELAY_RESPONSE_INVALID",
    );
  }
}

function recordFromFrame(frameResponse) {
  const frame = frameResponse?.frame;
  if (!frame || typeof frame !== "object")
    throw new GoldenLiveError("Browser frame response has no frame");
  if (typeof frame.base64 !== "string" || frame.base64.length > 24 * 1024 * 1024)
    throw new GoldenLiveError("Browser frame has no bounded JPEG payload");
  const bytes = Buffer.from(frame.base64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_FRAME_BYTES || frame.bytes !== bytes.length)
    throw new GoldenLiveError("Browser frame JPEG length is invalid");
  const { base64: _base64, ...metadata } = frame;
  return {
    frame: metadata,
    bytes,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

function candidateForLabel(overlay, label) {
  const candidate = overlay?.candidates?.find(
    (item) => item.label === label || item.value === label,
  );
  if (!candidate?.rect)
    throw new GoldenLiveError(`Browser overlay did not expose one exact ${label} target`);
  return candidate;
}

async function writeFrameEvidence(root, phase, ordinal, frameRecord) {
  const frameDir = join(root, phase, "frames");
  await mkdir(frameDir, { recursive: true });
  const stem = `${String(ordinal).padStart(3, "0")}`;
  const imagePath = join(frameDir, `${stem}.jpg`);
  const metadataPath = join(frameDir, `${stem}.json`);
  await writeFile(imagePath, frameRecord.bytes);
  await writeFile(
    metadataPath,
    JSON.stringify({ ...frameRecord.frame, digest: frameRecord.digest }, null, 2),
  );
  return {
    image: imagePath,
    metadata: metadataPath,
    digest: frameRecord.digest,
    bytes: frameRecord.bytes.length,
  };
}

/** Drive exactly Settings → Language → Arabic through managed Browser Device. */
export async function runManagedBrowserJourney({
  invoke,
  targetId,
  fixtureBaseUrl,
  head,
  artifactDir,
}) {
  const url = `${fixtureBaseUrl}/settings?head=${encodeURIComponent(head)}`;
  const opened = await invoke("target.browser-device.open", {
    targetId,
    environment: browserEnvironment(),
  });
  const evidence = { phase: head, session: opened?.session ?? null, frames: [] };
  let current = await invoke("target.browser-device.frame", { targetId });
  const first = recordFromFrame(current);
  evidence.frames.push(await writeFrameEvidence(artifactDir, head, 1, first));
  let frame = current.frame;
  const click = async (label, ordinal) => {
    const inspected = await invoke("target.browser-device.inspect", {
      targetId,
      sessionId: frame.sessionId,
      pageId: frame.pageId,
      expectedSequence: frame.sequence,
    });
    const candidate = candidateForLabel(inspected?.overlay, label);
    await invoke("target.browser-device.control", {
      targetId,
      input: {
        sessionId: frame.sessionId,
        pageId: frame.pageId,
        expectedSequence: frame.sequence,
        kind: "click",
        x: candidate.rect.x + candidate.rect.width / 2,
        y: candidate.rect.y + candidate.rect.height / 2,
      },
    });
    current = await invoke("target.browser-device.frame", {
      targetId,
      afterSequence: frame.sequence,
    });
    const next = recordFromFrame(current);
    evidence.frames.push(await writeFrameEvidence(artifactDir, head, ordinal, next));
    frame = current.frame;
  };
  if (typeof frame.pageUrl === "string" && !frame.pageUrl.startsWith(fixtureBaseUrl)) {
    await invoke("target.browser-device.control", {
      targetId,
      input: {
        sessionId: frame.sessionId,
        pageId: frame.pageId,
        expectedSequence: frame.sequence,
        kind: "navigate",
        url,
      },
    });
    current = await invoke("target.browser-device.frame", {
      targetId,
      afterSequence: frame.sequence,
    });
    const navigated = recordFromFrame(current);
    evidence.frames.push(
      await writeFrameEvidence(artifactDir, head, evidence.frames.length + 1, navigated),
    );
    frame = current.frame;
  }
  await click("Language", evidence.frames.length + 1);
  await click("Arabic", evidence.frames.length + 1);
  const page = current?.session?.pages?.find((item) => item.id === frame.pageId);
  const title = typeof page?.title === "string" ? page.title : "";
  const regressionDetected = title === "Arabic — RTL regression";
  const expectedTitle = head === "old" ? "Arabic — RTL regression" : "Arabic — RTL fixed";
  if (title !== expectedTitle)
    throw new GoldenLiveError(
      `Browser fixture ended at unexpected title ${JSON.stringify(title)}; expected ${JSON.stringify(expectedTitle)}`,
    );
  evidence.final = {
    pageUrl: frame.pageUrl,
    sequence: frame.sequence,
    visualFingerprint: frame.visualFingerprint,
    title,
    regressionDetected,
    blocked: regressionDetected,
  };
  return evidence;
}

async function relayHealth(relayUrl, fetchImpl) {
  try {
    const response = await fetchImpl(new URL("/health", relayUrl), {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return { status: "unreachable", error: `HTTP ${response.status}` };
    const body = await response.json();
    if (body?.ok !== true || body?.product !== "relay")
      return { status: "invalid", error: "health response is not Relay" };
    return { status: "ready", version: typeof body.version === "string" ? body.version : null };
  } catch (error) {
    return { status: "unreachable", error: bounded(error?.message ?? error) };
  }
}

/**
 * Run live web evidence when requested, then gate the result on explicit
 * Android and exact-head/TracePack prerequisites. No Android execution is
 * performed here, so this harness can never claim a cross-platform Proof.
 */
export async function runChangeProofGoldenLive({
  env = process.env,
  runWeb = false,
  artifactDir = DEFAULT_ARTIFACT_DIR,
  relayUrl = env.RELAY_URL?.trim() || DEFAULT_RELAY_URL,
  actor = env.RELAY_ACTOR_ID?.trim() || "system:change-proof-golden-live",
  fetchImpl = fetch,
  cli = defaultCliRunner,
  command = defaultCommand,
  invoke: injectedInvoke,
  startFixture = startGoldenFixtureServer,
} = {}) {
  await mkdir(artifactDir, { recursive: true });
  const android = await inspectAndroidPrerequisites({ env, command });
  const exact = await inspectExactProofInputs({ env, artifactDir });
  const browserTargets = await inspectManagedBrowserTargets({ env });
  const health = await relayHealth(relayUrl, fetchImpl);
  const blockers = [...android.blockers, ...exact.blockers];
  if (runWeb && health.status !== "ready")
    blockers.push(
      blocker(
        "browser.relay.unavailable",
        "Managed Chromium requires a healthy Relay server",
        health.error,
      ),
    );
  const invoke =
    injectedInvoke ??
    ((operationId, input) => invokeRelayOperation(cli, relayUrl, actor, operationId, input));
  const web = {
    status: runWeb ? "not-run" : "not-requested",
    targetRegistry: browserTargets,
    old: null,
    repaired: null,
    blockers: [],
  };
  const ephemeralTargets = [];
  const androidExecution = blocker(
    "android.execution.not-run",
    "Android App Map/Test execution was not run by this harness; no physical result is claimed",
  );
  blockers.push(androidExecution);
  let fixture;
  if (runWeb && health.status === "ready") {
    let journeyCompleted = false;
    try {
      fixture = await startFixture();
      for (const phase of ["old", "repaired"]) {
        const targetId = `change-proof-golden-${phase}-${process.pid}`;
        await invoke("target.create", {
          id: targetId,
          name: `Change Proof golden ${phase}`,
          startUrl: `${fixture.baseUrl}/settings?head=${phase}`,
          headless: true,
          viewport: CHANGE_PROOF_GOLDEN_LIVE.browser.viewport,
          environment: browserEnvironment(),
          profileRetention: "ephemeral",
        });
        ephemeralTargets.push(targetId);
        web[phase] = await runManagedBrowserJourney({
          invoke,
          targetId,
          fixtureBaseUrl: fixture.baseUrl,
          head: phase,
          artifactDir,
        });
      }
      if (!web.old.final?.regressionDetected)
        web.blockers.push(
          blocker(
            "browser.seeded-regression.not-detected",
            "Old-head Chromium fixture did not expose the seeded RTL regression",
          ),
        );
      if (web.repaired.final?.regressionDetected)
        web.blockers.push(
          blocker(
            "browser.repaired-head.regressed",
            "Repaired-head Chromium fixture still exposes the RTL regression",
          ),
        );
      journeyCompleted = true;
    } catch (error) {
      const detail =
        error instanceof GoldenLiveError ? error.message : bounded(error?.message ?? error);
      web.blockers.push(
        blocker("browser.journey.unavailable", "Managed Chromium journey did not complete", detail),
      );
    } finally {
      for (const targetId of ephemeralTargets.reverse()) {
        try {
          await invoke("target.delete", { targetId });
        } catch (error) {
          const cleanup = blocker(
            "browser.target.cleanup.failed",
            `Could not delete ephemeral target ${targetId}`,
            error?.message ?? error,
          );
          web.blockers.push(cleanup);
        }
      }
      if (fixture) {
        try {
          await fixture.close();
        } catch (error) {
          const cleanup = blocker(
            "browser.fixture.cleanup.failed",
            "Could not close local fixture server",
            error?.message ?? error,
          );
          web.blockers.push(cleanup);
        }
      }
    }
    blockers.push(...web.blockers);
    web.status = journeyCompleted
      ? web.blockers.length === 0
        ? "passed"
        : "failed"
      : "unsupported";
  }
  const seededRegression = {
    expected: CHANGE_PROOF_GOLDEN_LIVE.seededFailure,
    detected: web.old?.final?.regressionDetected === true,
    blocked: web.old?.final?.blocked === true,
  };
  const repairPacket = seededRegression.detected
    ? {
        status: "bounded",
        source: "live-browser-fixture",
        journey: CHANGE_PROOF_GOLDEN_LIVE.journey,
        failedHead: exact.oldSha,
        targetCaseId: "web-chromium-compact-ar",
        summary: CHANGE_PROOF_GOLDEN_LIVE.seededFailure,
        evidence: (web.old?.frames ?? [])
          .slice(-2)
          .map(({ metadata, image, digest, bytes }) => ({ metadata, image, digest, bytes })),
        maxBytes: MAX_FRAME_BYTES,
      }
    : null;
  const status =
    seededRegression.detected &&
    web.status === "passed" &&
    web.repaired?.final?.regressionDetected === false
      ? "insufficient-evidence"
      : blockers.some(({ id }) => id.includes("regression"))
        ? "rejected"
        : "insufficient-evidence";
  const report = {
    schemaVersion: CHANGE_PROOF_GOLDEN_LIVE.schemaVersion,
    kind: "change-proof-golden-live",
    status,
    journey: CHANGE_PROOF_GOLDEN_LIVE.journey,
    relay: health,
    android,
    androidExecution,
    exactProofInputs: exact,
    web,
    seededRegression,
    repairPacket,
    finalProof: {
      status: "not-claimed",
      reason: "Cross-platform exact-head evidence is incomplete",
      blockers,
    },
    unsupported: blockers,
    limitations: [
      "No physical Android result is claimed unless an explicit authorized serial, fixture APK, package, App Map/Test, and exact TracePacks are supplied.",
      "The live web fixture proves browser interaction and seeded regression detection only; it does not create a persisted Proof or TracePack by itself.",
      "No latency, comprehension, or GitHub publication measurement is inferred from this harness.",
    ],
  };
  if (Buffer.byteLength(JSON.stringify(report)) > MAX_REPORT_BYTES)
    throw new GoldenLiveError(`Golden live report exceeds ${MAX_REPORT_BYTES} bytes`);
  await writeFile(join(artifactDir, "report.json"), JSON.stringify(report, null, 2));
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const report = await runChangeProofGoldenLive(parseGoldenLiveArgs(argv));
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report.status === "rejected"
      ? CHANGE_PROOF_GOLDEN_LIVE_EXIT_CODES.regression
      : CHANGE_PROOF_GOLDEN_LIVE_EXIT_CODES.insufficientEvidence;
  } catch (error) {
    process.stderr.write(`change-proof-golden-live: ${error?.message ?? String(error)}\n`);
    return error instanceof GoldenLiveError && error.code === "GOLDEN_LIVE_INVALID"
      ? CHANGE_PROOF_GOLDEN_LIVE_EXIT_CODES.usage
      : CHANGE_PROOF_GOLDEN_LIVE_EXIT_CODES.insufficientEvidence;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await main();
