import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RelayClient } from "@relay/client";
import {
  closeBrowserHostPool,
  closeBrowserTarget,
  listenSeededMemberApp,
  resetControlDatabaseCache,
  saveBrowserAuthenticationFixture,
  saveBrowserTarget,
  SEEDED_MEMBER_BROWSER_ENVIRONMENT,
  SEEDED_MEMBER_TARGET_ID,
  type ModelDecisionProvider,
} from "@relay/core";
import {
  createGoalSessionRunner,
  createRelayOperationPort,
  type GoalSessionStore,
} from "@relay/workflows";
import type {
  CompactGoalObservation,
  GoalSessionRecord,
  GoalSessionResult,
  ModelDecisionRecord,
} from "@relay/protocol";
import { startServer } from "./index.js";

/**
 * GOAL-25 benchmark harness. Runs the controlled seeded-Member app and
 * measures the goal workflow's roles against ground truth that never comes
 * from the decision provider: the app's own seeded defect flag.
 *
 * Arms (all on the same app build and account fixture):
 *  - goal-defective: goal loop with the defect ON.
 *  - goal-repaired:  goal loop after the repair (defect OFF).
 *  - replay-model-free: fresh reproduction of the recorded path with every
 *    model credential removed from the environment.
 *
 * Honesty invariants asserted, not assumed: findings stay review-required;
 * "completion" is the model's proposal only; the defect's observability is
 * read from the app-rendered role chrome in the retained observations.
 */

const CHROME =
  process.env.RELAY_TEST_CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const organizationId = "local";
const projectId = "default";
const actorId = "human:goal-benchmark";

type ArmResult = {
  arm: string;
  status: GoalSessionResult["status"];
  actions: number;
  captures: number;
  durationMs: number;
  defectObserved: boolean | null;
  providerModel: string;
};

function memoryStore(): GoalSessionStore & { values: Map<string, GoalSessionRecord> } {
  const values = new Map<string, GoalSessionRecord>();
  return {
    values,
    async load(id) {
      const record = values.get(id);
      return record ? structuredClone(record) : null;
    },
    async save(record) {
      values.set(record.id, structuredClone(record));
    },
  };
}

function choiceAnswer(criteria: Record<string, string | null>, selected: string) {
  return {
    type: "choice" as const,
    choice: selected,
    probabilities: Object.fromEntries(
      Object.keys(criteria).map((key) => [key, key === selected ? 1 : 0]),
    ),
    confidence: 1,
  };
}

/** Scripted decision provider standing in for the configured model role.
 * The benchmark's ground truth is the seeded defect flag, never this output. */
function walkthroughProvider(label: string): ModelDecisionProvider {
  let phase = 0;
  return {
    id: "openrouter",
    async decide(request): Promise<ModelDecisionRecord> {
      const observation = request.state as CompactGoalObservation;
      const progress = request.questions.progress;
      const nextAction = request.questions.next_action;
      if (!progress || progress.type !== "choice" || !nextAction || nextAction.type !== "choice") {
        throw new Error("missing questions");
      }
      phase += 1;
      const base = {
        schemaVersion: 1 as const,
        status: "ok" as const,
        provider: "openrouter",
        model: `scripted:${label}`,
        requestId: `${label}-${phase}`,
        observationDigest: request.observationDigest,
        questionDigest: "q",
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        evidenceRefs: request.evidenceRefs ?? [],
      };
      if (phase === 1) {
        const settings = observation.candidates.find((candidate) => candidate.label === "Settings");
        assert.ok(settings, "expected the Settings entry on the workspace home");
        return {
          ...base,
          answers: {
            progress: choiceAnswer(progress.criteria, "continue"),
            next_action: choiceAnswer(nextAction.criteria, settings.id),
          },
        };
      }
      if (phase === 2) {
        return {
          ...base,
          answers: {
            progress: choiceAnswer(progress.criteria, "continue"),
            next_action: choiceAnswer(nextAction.criteria, "sys-capture"),
          },
        };
      }
      return {
        ...base,
        answers: {
          progress: choiceAnswer(progress.criteria, "complete"),
          next_action: choiceAnswer(nextAction.criteria, "none"),
        },
      };
    },
  };
}

function defectObserved(result: GoalSessionResult): boolean | null {
  const candidates = result.lastObservation?.candidates ?? [];
  const onSettings = candidates.some(
    (candidate) => candidate.target.identifier === "open-settings",
  );
  if (onSettings) return null; // never reached settings: no observation either way
  // On the settings page the seeded defect hides Manage team from Member.
  const manageTeam = candidates.some((candidate) => candidate.target.identifier === "manage-team");
  return !manageTeam;
}

async function issueMemberFixture(startUrl: string, targetId: string) {
  const issued = await fetch(new URL("/session", startUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "member" }),
    redirect: "manual",
  });
  const token = /relay_session=([^;]+)/u.exec(issued.headers.get("set-cookie") ?? "")?.[1];
  if (!token) throw new Error("fixture app did not issue a member session");
  return saveBrowserAuthenticationFixture({
    projectId,
    targetId,
    name: "benchmark member session",
    createdBy: actorId,
    storageState: {
      cookies: [
        { name: "relay_session", value: token, url: startUrl, httpOnly: true, sameSite: "Lax" },
      ],
      origins: [],
    },
  });
}

test(
  "goal benchmark: defect ground truth, model-free replay, honest labels",
  { timeout: 360_000 },
  async (t) => {
    try {
      await access(CHROME);
    } catch (error) {
      if (process.env.GOLDEN_ACCEPTANCE_MODE === "required" || process.env.RELAY_TEST_CHROME_PATH) {
        throw error;
      }
      t.skip(`Google Chrome is not installed: ${error instanceof Error ? error.message : error}`);
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "relay-goal-bench-"));
    const previousState = process.env.RELAY_STATE_DIR;
    const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
    const previousChrome = process.env.RELAY_BROWSER_EXECUTABLE;
    process.env.RELAY_STATE_DIR = root;
    process.env.RELAY_WORKSPACE_ROOT = root;
    process.env.RELAY_BROWSER_EXECUTABLE = CHROME;
    resetControlDatabaseCache();
    const fixture = await listenSeededMemberApp({ defect: true });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    const arms: ArmResult[] = [];
    try {
      server = await startServer({ host: "127.0.0.1", port: 0 });
      const client = new RelayClient({
        url: `http://127.0.0.1:${server.port}`,
        auth: { type: "none" },
        organizationId,
        projectId,
        actorId,
        actorKind: "human",
      });
      await saveBrowserTarget({
        id: SEEDED_MEMBER_TARGET_ID,
        name: "Seeded Member app (benchmark)",
        startUrl: fixture.url,
        headless: true,
        profileRetention: "ephemeral",
        environment: { ...SEEDED_MEMBER_BROWSER_ENVIRONMENT },
      });
      const port = createRelayOperationPort(client);

      // Each arm gets its own ephemeral managed target so every run starts
      // from the app home exactly like a first-use task (no residual page).
      const runGoalArm = async (arm: string, provider: ModelDecisionProvider) => {
        const targetId = `bench-${arm}`;
        await saveBrowserTarget({
          id: targetId,
          name: `Seeded Member app (${arm})`,
          startUrl: fixture.url,
          headless: true,
          profileRetention: "ephemeral",
          environment: { ...SEEDED_MEMBER_BROWSER_ENVIRONMENT },
        });
        const memberFx = await issueMemberFixture(fixture.url, targetId);
        const startedAt = Date.now();
        const store = memoryStore();
        const result = await createGoalSessionRunner({
          operations: port,
          store,
          decisionProvider: provider,
          id: () => `bench-${arm}`,
        }).start({
          goal: "Open workspace settings and capture the current screen",
          targetId,
          authenticationFixtureReference: memberFx.reference,
          maxSteps: 6,
        });
        arms.push({
          arm,
          status: result.status,
          actions: result.actions.length,
          captures: result.actions.filter((action) => action.interaction.kind === "capture").length,
          durationMs: Date.now() - startedAt,
          defectObserved: defectObserved(result),
          providerModel: provider.id,
        });
        return { result, store, targetId };
      };

      // Arm 1 — goal loop against the defective build.
      const defectiveRun = await runGoalArm("goal-defective", walkthroughProvider("defective"));
      const defective = defectiveRun.result;
      assert.equal(defective.status, "completed", JSON.stringify(defective.stopReason));
      // The model "proposed" completion; the machine-readable record must say so.
      assert.match(defective.stopReason?.message ?? "", /no stronger deterministic verifier/u);
      // The defect is observable in the retained evidence and nothing labeled
      // it verified success.
      assert.equal(defectObserved(defective), true);
      assert.ok(defective.findings.every((finding) => finding.requiresReview === true));

      // Arm 2 — the repair (same app, defect off), same check.
      fixture.app.setDefect(false);
      const repaired = (await runGoalArm("goal-repaired", walkthroughProvider("repaired"))).result;
      assert.equal(repaired.status, "completed");
      assert.equal(defectObserved(repaired), false);

      // Arm 3 — fresh reproduction with every model credential absent.
      // Account fixtures bind to the browser they were issued for, so the
      // deterministic reproduction target gets its own member fixture before
      // replay: same account identity, fresh isolated browser.
      const reproductionTargetId = `goal-repro-${defective.sessionId.slice(0, 110)}`;
      await saveBrowserTarget({
        id: reproductionTargetId,
        name: "Seeded Member app (replay)",
        startUrl: fixture.url,
        headless: true,
        profileRetention: "ephemeral",
        environment: { ...SEEDED_MEMBER_BROWSER_ENVIRONMENT },
      });
      const replayFixture = await issueMemberFixture(fixture.url, reproductionTargetId);
      // Rebind the retained record to the replay-target fixture: account
      // fixtures bind to the browser they were issued for, and reproduction
      // runs on its own fresh browser with the same account identity.
      const bound = await defectiveRun.store.load(defective.sessionId);
      assert.ok(bound, "retained defective record missing");
      await defectiveRun.store.save({
        ...bound,
        target: { ...bound.target, authenticationFixtureReference: replayFixture.reference },
      });
      const previousKey = process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      try {
        const replayStarted = Date.now();
        const replayed = await createGoalSessionRunner({
          operations: port,
          store: defectiveRun.store,
          decisionProvider: walkthroughProvider("replay-guard"),
          id: () => "bench-replay-src",
        }).reproduce(defective.sessionId);
        assert.equal(
          replayed.reproduction?.target.authenticationFixtureReference,
          replayFixture.reference,
        );
        arms.push({
          arm: "replay-model-free",
          status: replayed.status,
          actions: replayed.reproduction?.actions.length ?? 0,
          captures: 0,
          durationMs: Date.now() - replayStarted,
          defectObserved: null,
          providerModel: "none (credentials removed)",
        });
        assert.equal(replayed.reproduction?.status, "reproduced");
      } finally {
        if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey;
      }

      // Report the table for the recorded benchmark document.
      const table = arms
        .map(
          (arm) =>
            `${arm.arm}|${arm.status}|${arm.actions}|${arm.captures}|${arm.durationMs}|${
              arm.defectObserved === null
                ? "not reached"
                : arm.defectObserved
                  ? "defect visible"
                  : "defect absent"
            }|${arm.providerModel}`,
        )
        .join("\n");
      console.log(`GOAL-BENCH\narm|status|actions|captures|durationMs|defect|provider\n${table}`);
    } finally {
      await closeBrowserTarget("bench-goal-defective").catch(() => undefined);
      await closeBrowserTarget("bench-goal-repaired").catch(() => undefined);
      await closeBrowserHostPool().catch(() => undefined);
      await server?.close();
      await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
      resetControlDatabaseCache();
      if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
      else process.env.RELAY_STATE_DIR = previousState;
      if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
      else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
      if (previousChrome === undefined) delete process.env.RELAY_BROWSER_EXECUTABLE;
      else process.env.RELAY_BROWSER_EXECUTABLE = previousChrome;
      await rm(root, { recursive: true, force: true });
    }
  },
);
