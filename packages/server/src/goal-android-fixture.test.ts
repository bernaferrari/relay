import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import test from "node:test";
import { RelayClient } from "@relay/client";
import { resetControlDatabaseCache, type ModelDecisionProvider } from "@relay/core";
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
 * GOAL-22 live qualification: the same goal kernel that runs the controlled
 * browser app runs the deterministic Android proof-fixture journey on a real
 * emulator through the semantic interact path (no browser-device session).
 *
 * Preconditions (environment, not test logic): emulator-5556 booted with the
 * proof fixture and snapshot helper installed and the fixture's MainActivity
 * foreground. The test skips — never fails — when the window is absent, and
 * relaunches a clean activity first so the journey is deterministic.
 */

const SERIAL = "emulator-5554";
const organizationId = "local";
const projectId = "default";
const actorId = "human:goal-android-fixture";

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

/** Scripted decision provider walking the fixture's documented journey:
 * Settings → Language → Arabic → capture. It selects observed candidates by
 * label only; identifiers come from the runtime, never the script. */
function journeyProvider(): ModelDecisionProvider {
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
        model: "scripted:android-journey",
        requestId: `android-${phase}`,
        observationDigest: request.observationDigest,
        questionDigest: "q",
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        evidenceRefs: request.evidenceRefs ?? [],
      };
      const byLabel = (label: string) =>
        observation.candidates.find(
          (candidate) => candidate.label === label || candidate.text === label,
        );
      if (phase === 1) {
        const language = byLabel("Language");
        assert.ok(language, "expected the Language control in Settings");
        return {
          ...base,
          answers: {
            progress: choiceAnswer(progress.criteria, "continue"),
            next_action: choiceAnswer(nextAction.criteria, language.id),
          },
        };
      }
      if (phase === 2) {
        const arabic = byLabel("Arabic");
        assert.ok(arabic, "expected the Arabic control in the language list");
        return {
          ...base,
          answers: {
            progress: choiceAnswer(progress.criteria, "continue"),
            next_action: choiceAnswer(nextAction.criteria, arabic.id),
          },
        };
      }
      if (phase === 3) {
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

test(
  "goal kernel runs the Android proof journey on a live emulator",
  { timeout: 240_000 },
  async (t) => {
    const adb = (args: string[]) =>
      new Promise<string>((resolve, reject) => {
        execFile("adb", ["-s", SERIAL, ...args], { timeout: 30_000 }, (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        });
      });
    let installed: string;
    try {
      // Bounded output: the full window dump can exceed execFile's buffer.
      installed = await adb(["shell", "pm", "list", "packages", "dev.relay.prooffixture"]);
    } catch {
      t.skip(`emulator ${SERIAL} is not reachable`);
      return;
    }
    if (!installed.includes("dev.relay.prooffixture")) {
      t.skip(`proof fixture is not installed on ${SERIAL}`);
      return;
    }

    // Deterministic journey start: clean relaunch, then poll the window
    // focus instead of guessing a fixed settle delay (real emulator).
    await adb(["shell", "am", "start", "-S", "-n", "dev.relay.prooffixture/.MainActivity"]);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const focus = await adb(["shell", "dumpsys window windows | grep -m1 mCurrentFocus"]).catch(
        () => "",
      );
      if (focus.includes("dev.relay.prooffixture")) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const root = await mkdtemp(join(tmpdir(), "relay-goal-android-"));
    const previousState = process.env.RELAY_STATE_DIR;
    const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
    process.env.RELAY_STATE_DIR = root;
    process.env.RELAY_WORKSPACE_ROOT = root;
    resetControlDatabaseCache();
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
      const port = createRelayOperationPort(client);
      const result: GoalSessionResult = await createGoalSessionRunner({
        operations: port,
        store: memoryStore(),
        decisionProvider: journeyProvider(),
        id: () => "goal-android-journey",
      }).start({
        goal: "Choose Arabic in Settings and capture the RTL checkpoint",
        targetId: SERIAL,
        maxSteps: 6,
      });

      console.log(
        "JOURNEY:",
        JSON.stringify(result.stopReason),
        JSON.stringify(result.actions.map((a) => [a.id, a.candidateId, a.status, a.error])),
      );
      assert.equal(result.status, "completed", JSON.stringify(result.stopReason));
      assert.equal(result.actions.length, 3);
      // The kernel dispatched through the semantic interact path, not a
      // browser-device session.
      for (const action of result.actions) {
        assert.ok(
          action.interaction.kind === "identifier" ||
            action.interaction.kind === "label" ||
            action.interaction.kind === "capture",
          `unexpected interaction kind ${action.interaction.kind}`,
        );
      }
      assert.equal(result.actions.filter((a) => a.status === "acknowledged").length, 3);
      // The RTL checkpoint is proven by the app's own rendered chrome: the
      // Arabic heading and primary action controls exist in the observation.
      const candidates = result.lastObservation?.candidates ?? [];
      const checkpoint = candidates.find(
        (candidate) => candidate.target.identifier?.endsWith("/arabic_heading") === true,
      );
      assert.ok(checkpoint, "expected the Arabic settings checkpoint control");
      const primary = candidates.find(
        (candidate) => candidate.target.identifier?.endsWith("/primary_action") === true,
      );
      assert.ok(primary, "expected the Arabic primary action control");
      // Identity: this ran on the exact emulator serial we asked for.
      assert.equal(result.target.targetId, SERIAL);
      assert.equal(result.target.platform, "android");
      // The explicit capture produced review-linked evidence.
      const capture = result.actions.find((action) => action.interaction.kind === "capture");
      assert.ok(capture, "expected an explicit capture action");
      assert.ok((capture?.evidenceRefs ?? []).length > 0);
      // Completion stays a proposal; findings (if any) stay review-required.
      assert.match(result.stopReason?.message ?? "", /no stronger deterministic verifier/u);
      assert.ok(result.findings.every((finding) => finding.requiresReview === true));

      // Reset the fixture journey for the next run.
      await adb(["shell", "am", "start", "-S", "-n", "dev.relay.prooffixture/.MainActivity"]);
    } finally {
      await server?.close();
      resetControlDatabaseCache();
      if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
      else process.env.RELAY_STATE_DIR = previousState;
      if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
      else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
      await rm(root, { recursive: true, force: true });
    }
  },
);
