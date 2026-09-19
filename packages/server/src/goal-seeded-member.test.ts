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
  ModelDecisionRecord,
  ModelDecisionRequest,
} from "@relay/protocol";
import { startServer } from "./index.js";

const CHROME =
  process.env.RELAY_TEST_CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const organizationId = "local";
const projectId = "default";
const actorId = "human:goal-seeded-member";

function memoryStore(
  initial: GoalSessionRecord[] = [],
): GoalSessionStore & { values: Map<string, GoalSessionRecord> } {
  const values = new Map(initial.map((record) => [record.id, structuredClone(record)]));
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

function observationOf(state: ModelDecisionRequest["state"]): CompactGoalObservation {
  return state as CompactGoalObservation;
}

/** A scripted provider that walks the real app: open Settings, capture, done.
 * It selects candidates by their observed labels — never invented selectors. */
function walkthroughProvider(): ModelDecisionProvider {
  let phase = 0;
  return {
    id: "openrouter",
    async decide(request): Promise<ModelDecisionRecord> {
      const observation = observationOf(request.state);
      const progress = request.questions.progress;
      const nextAction = request.questions.next_action;
      if (!progress || progress.type !== "choice" || !nextAction || nextAction.type !== "choice") {
        throw new Error("missing questions");
      }
      phase += 1;
      if (phase === 1) {
        const settings = observation.candidates.find(
          (candidate) => candidate.label === "Settings",
        );
        assert.ok(settings, "expected a Settings link on the workspace home");
        return {
          schemaVersion: 1,
          status: "ok",
          provider: "openrouter",
          model: "fixture",
          requestId: `request-${phase}`,
          observationDigest: request.observationDigest,
          questionDigest: "q",
          answers: {
            progress: choiceAnswer(progress.criteria, "continue"),
            next_action: choiceAnswer(nextAction.criteria, settings.id),
          },
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
          evidenceRefs: request.evidenceRefs ?? [],
        };
      }
      if (phase === 2) {
        return {
          schemaVersion: 1,
          status: "ok",
          provider: "openrouter",
          model: "fixture",
          requestId: `request-${phase}`,
          observationDigest: request.observationDigest,
          questionDigest: "q",
          answers: {
            progress: choiceAnswer(progress.criteria, "continue"),
            next_action: choiceAnswer(nextAction.criteria, "sys-capture"),
          },
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
          evidenceRefs: request.evidenceRefs ?? [],
        };
      }
      return {
        schemaVersion: 1,
        status: "ok",
        provider: "openrouter",
        model: "fixture",
        requestId: `request-${phase}`,
        observationDigest: request.observationDigest,
        questionDigest: "q",
        answers: {
          progress: choiceAnswer(progress.criteria, "complete"),
          next_action: choiceAnswer(nextAction.criteria, "none"),
        },
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        evidenceRefs: request.evidenceRefs ?? [],
      };
    },
  };
}

async function issueFixture(role: "admin" | "member", startUrl: string, targetId: string) {
  const issued = await fetch(new URL("/session", startUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
    redirect: "manual",
  });
  const token = /relay_session=([^;]+)/u.exec(issued.headers.get("set-cookie") ?? "")?.[1];
  if (!token) throw new Error(`fixture app did not issue a ${role} session`);
  return saveBrowserAuthenticationFixture({
    projectId,
    targetId,
    name: `goal ${role} session`,
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
  "a goal session runs the controlled app as the exact requested account",
  { timeout: 240_000 },
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
    const root = await mkdtemp(join(tmpdir(), "relay-goal-member-"));
    const previousState = process.env.RELAY_STATE_DIR;
    const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
    const previousChrome = process.env.RELAY_BROWSER_EXECUTABLE;
    process.env.RELAY_STATE_DIR = root;
    process.env.RELAY_WORKSPACE_ROOT = root;
    process.env.RELAY_BROWSER_EXECUTABLE = CHROME;
    resetControlDatabaseCache();
    const fixture = await listenSeededMemberApp({ defect: true });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
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
        name: "Seeded Member app (goal)",
        startUrl: fixture.url,
        headless: true,
        profileRetention: "ephemeral",
        environment: { ...SEEDED_MEMBER_BROWSER_ENVIRONMENT },
      });
      const memberFx = await issueFixture("member", fixture.url, SEEDED_MEMBER_TARGET_ID);
      const adminFx = await issueFixture("admin", fixture.url, SEEDED_MEMBER_TARGET_ID);
      const port = createRelayOperationPort(client);

      const runGoal = async (reference: string) =>
        createGoalSessionRunner({
          operations: port,
          store: memoryStore(),
          decisionProvider: walkthroughProvider(),
          id: () => `goal-${reference.replace(/[^A-Za-z0-9]/gu, "").slice(-12)}`,
        }).start({
          goal: "Open workspace settings and capture the seats as the requested account",
          targetId: SEEDED_MEMBER_TARGET_ID,
          authenticationFixtureReference: reference,
        });

      // Exact Member identity: the app itself reports the session role.
      const member = await runGoal(memberFx.reference);
      assert.equal(member.status, "completed");
      assert.equal(member.stopReason?.code, "goal-achieved");
      assert.equal(member.target.appliedAuthenticationFixtureId, memberFx.reference);
      console.log("FINAL CANDIDATES:", JSON.stringify(member.lastObservation?.candidates.map((c) => [c.target.identifier, c.label, c.text])));
      // Identity is proven by the app's own server-rendered, role-dependent
      // chrome — not by stored labels. With the defect on, the Member settings
      // page hides both admin-only and permission-gated controls.
      const memberManageTeam = member.lastObservation?.candidates.find(
        (candidate) => candidate.target.identifier === "manage-team",
      );
      assert.equal(memberManageTeam, undefined);
      const memberManageOrg = member.lastObservation?.candidates.find(
        (candidate) => candidate.target.identifier === "manage-org",
      );
      assert.equal(memberManageOrg, undefined);
      const memberSave = member.lastObservation?.candidates.find(
        (candidate) => candidate.target.identifier === "save-settings",
      );
      assert.ok(memberSave, "expected the member settings page chrome");
      // The explicit capture produced review-linked evidence.
      const captureAction = member.actions.find(
        (action) => action.interaction.kind === "capture",
      );
      assert.ok(captureAction, "expected an explicit capture action");
      assert.ok((captureAction.evidenceRefs ?? []).length > 0);

      // Wrong-account probe: requesting Admin on the same app must show the
      // Admin session — proof the fixture is actually applied, not labeled.
      const admin = await runGoal(adminFx.reference);
      assert.equal(admin.status, "completed");
      assert.equal(admin.target.appliedAuthenticationFixtureId, adminFx.reference);
      // The wrong-account probe sees the Admin-only organization control the
      // Member session can never render — the fixture was actually applied.
      const adminManageOrg = admin.lastObservation?.candidates.find(
        (candidate) => candidate.target.identifier === "manage-org",
      );
      assert.ok(adminManageOrg, "expected admin-only organization controls");
      const adminManageTeam = admin.lastObservation?.candidates.find(
        (candidate) => candidate.target.identifier === "manage-team",
      );
      assert.ok(adminManageTeam, "expected admin team permission controls");
    } finally {
      await closeBrowserTarget(SEEDED_MEMBER_TARGET_ID).catch(() => undefined);
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
