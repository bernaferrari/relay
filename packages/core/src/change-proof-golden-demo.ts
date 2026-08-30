import {
  type ChangeSignals,
  type ChangeProofDecision,
  type ChangeVerification,
  changeTestedSha,
  type VerificationPlanTargetCase,
  BROWSER_PROOF_REQUIRED_CHANNELS,
  browserProofEvidenceArtifact,
} from "@relay/protocol";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  changeProofCaseResultFromPersistedRun,
  executeLiveChangeProof,
  type ChangeProofRunCase,
} from "./change-proof-live-run.js";
import { materializeChangeVerificationIntegrity } from "./change-proof-integrity.js";
import { agentRepairPacketForDecision } from "./change-proof-decision.js";
import { compileVerificationPlan, verificationCellId } from "./change-impact.js";
import { canonicalSha256 } from "./canonical-json.js";
import { compileExecutionRisk } from "./execution-risk-compiler.js";
import { exportTracePack } from "./trace-pack.js";
import type { PersistedRun } from "./runs.js";

/**
 * A deterministic, device-free demonstration of the Change Proof loop.
 *
 * This is intentionally a fixture, not an alternate execution product. The
 * fake target adapter returns the same persisted Run shape that a real App
 * Map execution writes. All outcomes are then projected through the normal
 * TracePack, decision, and repair-packet boundaries.
 */

export const CHANGE_PROOF_GOLDEN_DEMO = {
  organizationId: "acme",
  projectId: "settings-demo",
  repository: "acme/settings",
  baseSha: "1".repeat(40),
  failedHeadSha: "2".repeat(40),
  repairedHeadSha: "3".repeat(40),
  appMapId: "settings",
  testId: "settings-language-arabic",
  appMapRevision: 17,
  policy: { id: "relay.verify-change", version: 2 },
} as const;

const FAILED_WEB_DIGEST = `sha256:${"a".repeat(64)}` as const;
const FAILED_ANDROID_DIGEST = `sha256:${"b".repeat(64)}` as const;
const REPAIRED_WEB_DIGEST = `sha256:${"c".repeat(64)}` as const;
const REPAIRED_ANDROID_DIGEST = `sha256:${"d".repeat(64)}` as const;
const GOLDEN_EXECUTION_RISK = compileExecutionRisk({
  kind: "recipe-graph",
  rootRecipeId: "golden-proof-root",
  recipes: { "golden-proof-root": { id: "golden-proof-root", steps: [] } },
});
const GOLDEN_EXECUTION_RISK_DIGEST = canonicalSha256(GOLDEN_EXECUTION_RISK);

let goldenBrowserEvidenceDir: string | undefined;

/** The golden demo is device-free, but browser Runs still need a real
 * artifact-closed evidence envelope. Keep its tiny deterministic fixture
 * files outside the repository and never present them as physical-target
 * measurements. */
function browserEvidenceDirectory(): string {
  if (goldenBrowserEvidenceDir) return goldenBrowserEvidenceDir;
  // Node's test runner executes test files in parallel processes. Keep each
  // fixture writer on its own path so one process cannot truncate evidence
  // while another process is closing the same TracePack.
  goldenBrowserEvidenceDir = join(tmpdir(), `relay-change-proof-golden-browser-${process.pid}`);
  mkdirSync(join(goldenBrowserEvidenceDir, "frames"), { recursive: true });
  mkdirSync(join(goldenBrowserEvidenceDir, "artifacts"), { recursive: true });
  // Valid 1x1 PNG bytes keep the synthetic screenshot artifact parseable
  // without depending on a browser or image library.
  writeFileSync(
    join(goldenBrowserEvidenceDir, "frames", "001.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  for (const path of [
    "aria-001.json",
    "console-001.json",
    "page-errors-001.json",
    "network-001.json",
    "popups-001.json",
  ]) {
    writeFileSync(join(goldenBrowserEvidenceDir, "artifacts", path), "{}\n");
  }
  writeFileSync(join(goldenBrowserEvidenceDir, "artifacts", "trace-001.zip"), "fixture-trace\n");
  return goldenBrowserEvidenceDir;
}

const goldenSignals: ChangeSignals = {
  files: ["src/settings/LanguagePanel.tsx"],
  symbols: ["SettingsLanguagePanel"],
  routes: ["/settings/language"],
  resources: ["settings.language.title"],
  localizationKeys: ["settings.language.title"],
  apiContracts: [],
};

const goldenAssociations = [
  {
    id: "settings-language-reviewed-source",
    appMapId: CHANGE_PROOF_GOLDEN_DEMO.appMapId,
    testId: CHANGE_PROOF_GOLDEN_DEMO.testId,
    signals: goldenSignals,
    confidence: "definite" as const,
    reason: "Settings language resources and layout are covered by this journey.",
    review: {
      status: "reviewed" as const,
      revision: 1,
      reviewedBy: "human:reviewer",
      reviewedAt: 100,
    },
  },
] as const;

function digest(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}` as `sha256:${string}`;
}

function runInputDigest(runId: string, headSha: string): string {
  return createHash("sha256").update(`${runId}\0${headSha}`).digest("hex");
}

function browserTargetCase(
  id: string,
  viewport: { width: number; height: number },
  mobile: boolean,
): VerificationPlanTargetCase {
  return {
    id,
    executionTarget: {
      schemaVersion: 1,
      kind: "local-browser",
      provider: { key: "relay.local.browser", scope: "local" },
      targetId: "settings-web",
      platform: "browser",
      identity: { kind: "browser-target", value: "settings-web" },
    },
    targetProfile: {
      id: `settings-web:${id}`,
      targetId: "settings-web",
      source: "browser",
      platform: "browser",
      name: mobile ? "Settings web · compact Chromium" : "Settings web · desktop Chromium",
      model: "Chromium fixture",
      viewport,
      browserCaseProfile: {
        schemaVersion: 1,
        engine: "chromium",
        viewport,
        screen: viewport,
        deviceScaleFactor: mobile ? 2 : 1,
        mobile,
        touch: mobile,
        locale: "ar",
        timezoneId: "UTC",
        colorScheme: "dark",
        reducedMotion: "no-preference",
        permissions: [],
        offline: false,
        environmentRevision: "golden-settings-v1",
      },
      capabilities: ["snapshot", "screenshot", "tap"],
      observedAt: 100,
    },
    dimensions: { locale: "ar", viewport: mobile ? "compact" : "desktop" },
    required: true,
  };
}

function androidTargetCase(): VerificationPlanTargetCase {
  return {
    id: "android-pixel-9-ar",
    executionTarget: {
      schemaVersion: 1,
      kind: "local-device",
      provider: { key: "relay.local.agent-device", scope: "local" },
      targetId: "android-settings-fixture",
      platform: "android",
      identity: { kind: "device-serial", value: "android-settings-fixture" },
    },
    targetProfile: {
      id: "android-settings-fixture",
      targetId: "android-settings-fixture",
      source: "device",
      platform: "android",
      name: "Android settings fixture",
      model: "Pixel 9 fixture",
      osVersion: "16",
      capabilities: ["snapshot", "screenshot", "tap"],
      observedAt: 100,
    },
    dimensions: { locale: "ar" },
    required: true,
  };
}

export function goldenDemoTargetCases(): VerificationPlanTargetCase[] {
  return [
    androidTargetCase(),
    browserTargetCase("web-chromium-compact-ar", { width: 390, height: 844 }, true),
    browserTargetCase("web-chromium-desktop-ar", { width: 1280, height: 800 }, false),
  ];
}

export function goldenDemoBuilds(headSha: string): ChangeVerification["builds"] {
  const repaired = headSha === CHANGE_PROOF_GOLDEN_DEMO.repairedHeadSha;
  return [
    {
      id: "android-debug-fixture",
      platform: "android",
      artifactDigest: repaired ? REPAIRED_ANDROID_DIGEST : FAILED_ANDROID_DIGEST,
      sourceSha: headSha,
      configuration: "fixture.debug",
      environmentRevision: "golden-settings-v1",
    },
    {
      id: "web-preview-fixture",
      platform: "web",
      artifactDigest: repaired ? REPAIRED_WEB_DIGEST : FAILED_WEB_DIGEST,
      sourceSha: headSha,
      configuration: "fixture.preview",
      environmentRevision: "golden-settings-v1",
    },
  ];
}

/** Compile the same reviewed source-to-journey mapping used by a real proof. */
export function goldenDemoVerificationPlan(
  headSha: string,
  baseSha: string = CHANGE_PROOF_GOLDEN_DEMO.baseSha,
) {
  return compileVerificationPlan({
    change: {
      repository: CHANGE_PROOF_GOLDEN_DEMO.repository,
      baseSha,
      headSha,
      pullRequest: 184,
      agentClaim: {
        summary: "Implemented Arabic Settings language support and responsive RTL layout.",
        acceptanceCriteria: [
          "Settings render in Arabic on Android and web.",
          "Compact RTL layout has no overlap.",
        ],
      },
    },
    changed: goldenSignals,
    associations: goldenAssociations,
    builds: goldenDemoBuilds(headSha),
    targetCases: goldenDemoTargetCases(),
    policy: CHANGE_PROOF_GOLDEN_DEMO.policy,
  });
}

/** Materialize the ready, human-approved Proof boundary for the fixture. */
export function goldenDemoReadyProof(
  headSha: string,
  id: string,
  approvedAt: number,
  baseSha: string = CHANGE_PROOF_GOLDEN_DEMO.baseSha,
): ChangeVerification {
  const plan = goldenDemoVerificationPlan(headSha, baseSha);
  const cells = plan.selection.cells?.map((cell) => ({
    ...cell,
    id: verificationCellId({
      appMapId: cell.journey.appMapId,
      testId: cell.journey.testId,
      appMapRevision: CHANGE_PROOF_GOLDEN_DEMO.appMapRevision,
      targetCaseId: cell.targetCaseId,
      buildId: cell.buildId,
    }),
    journey: {
      ...cell.journey,
      appMapRevision: CHANGE_PROOF_GOLDEN_DEMO.appMapRevision,
    },
    executionRisk: GOLDEN_EXECUTION_RISK,
    executionRiskDigest: GOLDEN_EXECUTION_RISK_DIGEST,
  }));
  const pilotCellId = cells?.find(
    (_, index) => plan.selection.cells?.[index]?.id === plan.selection.pilotCellId,
  )?.id;
  return materializeChangeVerificationIntegrity({
    schemaVersion: 2,
    id,
    organizationId: CHANGE_PROOF_GOLDEN_DEMO.organizationId,
    projectId: CHANGE_PROOF_GOLDEN_DEMO.projectId,
    version: 2,
    state: "ready",
    change: plan.change,
    builds: plan.builds,
    selection: {
      ...plan.selection,
      affectedJourneys: plan.selection.affectedJourneys.map((journey) => ({
        ...journey,
        appMapRevision: CHANGE_PROOF_GOLDEN_DEMO.appMapRevision,
      })),
      cells,
      ...(pilotCellId ? { pilotCellId } : {}),
    },
    planApproval: {
      decisionId: `${id}:approval`,
      approvedBy: "human:reviewer",
      approvedAt,
      reason: "The exact Android, compact web, and desktop web matrix is reviewed.",
    },
    policy: plan.policy,
    runIds: [],
    evidenceDigests: [],
    coverageGaps: [],
    residualRisk: [],
    smallestNextVerification: { kind: "run-pilot", reason: "Run the representative pilot case." },
    requestedBy: "agent:coder",
    updatedBy: "human:reviewer",
    lastMutation: {
      schemaVersion: 1,
      requestId: `${id}:approval-request`,
      requestDigest: digest("e"),
      action: "approve-plan",
      actorId: "human:reviewer",
      proofId: id,
      previousVersion: 1,
      version: 2,
      at: approvedAt,
    },
    createdAt: 100,
    updatedAt: approvedAt,
  });
}

function planArtifact(item: ChangeProofRunCase): PersistedRun["artifacts"][number] {
  const rootRecipeId = `${item.appMapId}:${item.testId}:root`;
  return {
    kind: "app-map-test-plan",
    capturedAt: 1_000,
    data: {
      schemaVersion: 1,
      appMapId: item.appMapId,
      appMapRevision: item.appMapRevision,
      test: {
        id: item.testId,
        name: "Settings → Language → Arabic",
        kind: "scenario",
        intentSchemaVersion: 1,
      },
      rootRecipeId,
      recipes: {
        [rootRecipeId]: {
          id: rootRecipeId,
          title: "Settings → Language → Arabic",
          parameters: [],
          steps: [],
        },
      },
      stepProvenance: [],
      performance: {
        executableOperations: 1,
        moduleCalls: 0,
        operationCounts: { tap: 1 },
        screenshotCount: 1,
        destinationProofCount: 1,
      },
      startup: { mode: "cold" },
    },
  };
}

function buildForCase(
  proof: ChangeVerification,
  item: ChangeProofRunCase,
): ChangeVerification["builds"][number] {
  const target = proof.selection.targetCases.find(({ id }) => id === item.targetCaseId)!;
  const platform =
    target.executionTarget.platform === "browser" ? "web" : target.executionTarget.platform;
  return proof.builds.find(({ platform: candidate }) => candidate === platform)!;
}

function browserProofEvidenceForRun(input: {
  runId: string;
  target: VerificationPlanTargetCase;
  build: ChangeVerification["builds"][number];
}) {
  const environment = input.target.targetProfile.browserCaseProfile!;
  const channel = (artifactRef: string) => ({
    status: "captured" as const,
    entries: 1,
    bytes: 1,
    dropped: 0,
    redactions: 0,
    artifactRefs: [artifactRef],
  });
  return browserProofEvidenceArtifact(
    {
      schemaVersion: 1,
      runId: input.runId,
      target: {
        targetId: input.target.executionTarget.targetId,
        targetProfileId: input.target.targetProfile.id,
      },
      build: {
        sourceSha: input.build.sourceSha,
        artifactDigest: input.build.artifactDigest,
      },
      browser: { engine: environment.engine, version: "chromium-fixture-v1" },
      environment,
      channels: {
        screenshot: channel("frames/001.png"),
        accessibility: channel("artifacts/aria-001.json"),
        "console-errors": channel("artifacts/console-001.json"),
        "page-errors": channel("artifacts/page-errors-001.json"),
        network: channel("artifacts/network-001.json"),
        trace: channel("artifacts/trace-001.zip"),
        "popup-topology": channel("artifacts/popups-001.json"),
      },
      consoleErrors: { messages: [], truncated: false },
      pageErrors: { messages: [], truncated: false },
      networkSummary: {
        requests: 1,
        failedRequests: 0,
        pendingRequests: 0,
        statusCodes: { "200": 1 },
      },
      traceReference: {
        path: "artifacts/trace-001.zip",
        digest: `sha256:${"e".repeat(64)}`,
        format: "playwright-trace",
      },
      popupTopology: {
        pages: [
          {
            id: "page-1",
            kind: "page",
            title: "Settings",
            url: "https://settings.fixture.test/settings",
            active: true,
            closed: false,
          },
        ],
        activePageId: "page-1",
      },
      completeness: {
        status: "complete",
        required: [...BROWSER_PROOF_REQUIRED_CHANNELS],
        captured: [...BROWSER_PROOF_REQUIRED_CHANNELS],
        missing: [],
      },
    },
    1_000,
  );
}

/** Build one persisted Run using the exact target/build identity in the Proof. */
export function goldenDemoPersistedRun(input: {
  proof: ChangeVerification;
  item: ChangeProofRunCase;
  outcome: "passed" | "rejected";
}): PersistedRun {
  const target = input.proof.selection.targetCases.find(
    ({ id }) => id === input.item.targetCaseId,
  )!;
  const build = buildForCase(input.proof, input.item);
  const runId = `${input.proof.id}:${input.item.targetCaseId}`;
  const failed = input.outcome === "rejected";
  const capturedAt = 1_000 + input.item.targetCaseId.length;
  const artifacts: PersistedRun["artifacts"] = [planArtifact(input.item)];
  if (!failed) {
    artifacts.push({
      kind: "campaign-transition-proof",
      capturedAt: capturedAt + 1,
      data: { checkId: "settings-arabic", status: "verified" },
    });
  }
  artifacts.push({
    kind: "campaign-check-result",
    capturedAt: capturedAt + 2,
    data: {
      id: failed ? "rtl-overlap" : "settings-arabic",
      title: "Settings are displayed in Arabic",
      status: failed ? "failed" : "passed",
      ...(failed
        ? {
            error: "Primary action overlaps the Arabic description by 22 px.",
            expected: "Primary action does not overlap translated content.",
            observed: "Primary action overlaps the description by 22 px.",
          }
        : {}),
    },
  });

  const browser = target.executionTarget.platform === "browser";
  if (browser) {
    artifacts.push(
      browserProofEvidenceForRun({
        runId,
        target,
        build,
      }),
    );
  }

  return {
    schemaVersion: 5,
    id: runId,
    projectId: input.proof.projectId,
    ownerId: "agent:coder",
    action: `app-map:${input.item.appMapId}:${input.item.testId}`,
    serial: target.executionTarget.targetId,
    platform: target.executionTarget.platform,
    executionTarget: structuredClone(target.executionTarget),
    ...(browser
      ? {
          browserCaseProfile: structuredClone(target.targetProfile.browserCaseProfile),
        }
      : {}),
    targetProfile: structuredClone(target.targetProfile) as NonNullable<
      PersistedRun["targetProfile"]
    >,
    status: failed ? "error" : "ok",
    outcome: failed ? "product-failure" : "passed",
    attempts: 1,
    queuedAt: 1_000,
    startedAt: 1_001,
    finishedAt: capturedAt + 2,
    error: failed ? "Primary action overlaps the Arabic description by 22 px." : undefined,
    logs: failed ? ["visual-check: rtl-overlap=22px"] : ["settings-arabic: passed"],
    steps: [],
    frames: [],
    dir: browser ? browserEvidenceDirectory() : "",
    writtenAt: capturedAt + 2,
    artifacts,
    inputDigest: runInputDigest(runId, changeTestedSha(input.proof.change)),
    resolvedInputs: structuredClone(target.dimensions),
    evidence: {
      schemaVersion: 1,
      runId,
      target: {
        kind: target.executionTarget.platform === "browser" ? "browser" : "device",
        platform: target.executionTarget.platform,
      },
      startedAt: 1_001,
      finishedAt: capturedAt + 2,
      ...(browser
        ? {
            collectionPolicy: {
              schemaVersion: 1 as const,
              sensitive: {
                "browser-trace": {
                  grantedAt: 900,
                  grantedBy: "human:golden-demo-reviewer",
                  reason: "Reviewed browser trace retained for the public golden Proof fixture",
                },
              },
            },
          }
        : {}),
      channels: {},
      events: [],
    } as never,
    executionProvenance: {
      schemaVersion: 1,
      actorId: "agent:coder",
      actorKind: "agent",
      organizationId: input.proof.organizationId,
      projectId: input.proof.projectId,
      operationId: "app-map.test.run",
      requestId: runId,
      issuedAt: 1_000,
    },
    sourceRevision: {
      vcs: "git",
      sha: changeTestedSha(input.proof.change),
      artifactDigest: build.artifactDigest,
    },
  };
}

export type ChangeProofGoldenDemoResult = Readonly<{
  oldProof: ChangeVerification;
  oldDecision: ChangeProofDecision;
  oldCaseResults: readonly Awaited<ReturnType<typeof changeProofCaseResultFromPersistedRun>>[];
  oldTracePacks: readonly Awaited<ReturnType<typeof exportTracePack>>[];
  repairPacket: NonNullable<ReturnType<typeof agentRepairPacketForDecision>>;
  repairedProof: ChangeVerification;
  repairedDecision: ChangeProofDecision;
  repairedCaseResults: readonly Awaited<ReturnType<typeof changeProofCaseResultFromPersistedRun>>[];
  repairedTracePacks: readonly Awaited<ReturnType<typeof exportTracePack>>[];
  initialExecutedCaseIds: string[];
  repairedExecutedCaseIds: string[];
  /** Cross-head reuse is intentionally empty: exact-head policy requires fresh
   * Runs for the repaired artifact, even when a case did not fail before. */
  reusedCaseIds: readonly string[];
}>;

/**
 * Run the complete fixture loop. The old head stops at the compact-web
 * regression; the repaired head executes the same three required target cases
 * with a new build identity. This makes selective scope explicit without
 * pretending an old-head Run can prove a new head.
 */
export async function runChangeProofGoldenDemo(): Promise<ChangeProofGoldenDemoResult> {
  const oldProof = goldenDemoReadyProof(
    CHANGE_PROOF_GOLDEN_DEMO.failedHeadSha,
    "proof-settings-failed",
    200,
  );
  const oldRuns: PersistedRun[] = [];
  const initialExecutedCaseIds: string[] = [];
  const oldExecution = await executeLiveChangeProof({
    proof: oldProof,
    authority: "confirmed",
    runCase: async (item) => {
      initialExecutedCaseIds.push(item.targetCaseId);
      const outcome = item.targetCaseId === "web-chromium-compact-ar" ? "rejected" : "passed";
      const run = goldenDemoPersistedRun({ proof: oldProof, item, outcome });
      oldRuns.push(run);
      return run;
    },
  });
  const oldCaseResults = oldExecution.results;
  const repairPacket = agentRepairPacketForDecision({
    proof: oldProof,
    caseResults: oldCaseResults,
  });
  if (!repairPacket) throw new Error("Golden demo expected a bounded repair packet");

  const repairedProof = goldenDemoReadyProof(
    CHANGE_PROOF_GOLDEN_DEMO.repairedHeadSha,
    "proof-settings-repaired",
    500,
    CHANGE_PROOF_GOLDEN_DEMO.failedHeadSha,
  );
  const repairedRuns: PersistedRun[] = [];
  const repairedExecutedCaseIds: string[] = [];
  const repairedExecution = await executeLiveChangeProof({
    proof: repairedProof,
    authority: "confirmed",
    runCase: async (item) => {
      repairedExecutedCaseIds.push(item.targetCaseId);
      const run = goldenDemoPersistedRun({ proof: repairedProof, item, outcome: "passed" });
      repairedRuns.push(run);
      return run;
    },
  });
  return {
    oldProof,
    oldDecision: oldExecution.decision,
    oldCaseResults,
    oldTracePacks: await Promise.all(oldRuns.map((run) => exportTracePack(run))),
    repairPacket,
    repairedProof,
    repairedDecision: repairedExecution.decision,
    repairedCaseResults: repairedExecution.results,
    repairedTracePacks: await Promise.all(repairedRuns.map((run) => exportTracePack(run))),
    initialExecutedCaseIds,
    repairedExecutedCaseIds,
    reusedCaseIds: [],
  };
}
