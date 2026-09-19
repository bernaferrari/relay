import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
 * GOAL-23 live qualification (simulator lane): the same goal kernel that runs
 * the controlled browser app and the Android proof fixture runs a Settings
 * journey on a real iOS Simulator through the semantic interact path.
 *
 * Preconditions (environment, not test logic): the simulator named by
 * RELAY_IOS_SIM_UDID (default: the local iPhone 16 Pro) is booted. The test
 * skips — never fails — when the simulator is not booted, and relaunches a
 * clean Settings first so the journey is deterministic.
 */

const SETTINGS_BUNDLE = "com.apple.Preferences";
const UDID = process.env.RELAY_IOS_SIM_UDID ?? "D2625C92-964D-4326-8C83-0A4B9B06431D";
const organizationId = "local";
const projectId = "default";
const repoRoot = () => dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const actorId = "human:goal-ios-fixture";

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

/** Scripted decision provider walking the Settings journey:
 * General → About → capture. It selects observed candidates by label only;
 * identifiers come from the runtime, never the script. */
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
        model: "scripted:ios-journey",
        requestId: `ios-${phase}`,
        observationDigest: request.observationDigest,
        questionDigest: "q",
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        evidenceRefs: request.evidenceRefs ?? [],
      };
      // iOS chrome repeats row labels (navigation title + row). Prefer the
      // candidate that carries its own selector — the actionable row, not a
      // decorative title.
      const byLabel = (label: string) => {
        const matches = observation.candidates.filter(
          (candidate) => candidate.label === label || candidate.text === label,
        );
        const withSelector = matches.filter(
          (candidate) =>
            candidate.target.identifier || candidate.target.ref || candidate.target.point,
        );
        // iOS chrome (navigation titles) precedes content rows in tree
        // order; the actionable row is the last selector-bearing match.
        const pool = withSelector.length ? withSelector : matches;
        return pool[pool.length - 1];
      };
      if (phase === 1) {
        const general = byLabel("General");
        assert.ok(general, "expected the General control in Settings");
        return {
          ...base,
          answers: {
            progress: choiceAnswer(progress.criteria, "continue"),
            next_action: choiceAnswer(nextAction.criteria, general.id),
          },
        };
      }
      if (phase === 2) {
        const about = byLabel("About");
        assert.ok(about, "expected the About control in General");
        return {
          ...base,
          answers: {
            progress: choiceAnswer(progress.criteria, "continue"),
            next_action: choiceAnswer(nextAction.criteria, about.id),
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
  "goal kernel runs the Settings journey on a live iOS Simulator",
  { timeout: 240_000 },
  async (t) => {
    const simctl = (args: string[]) =>
      new Promise<string>((resolve, reject) => {
        execFile("xcrun", ["simctl", ...args], { timeout: 60_000 }, (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        });
      });
    // Repository-verification CI has no exclusive claim on the simulator (the
    // dev host may hold the one automation slot); live-simulator journeys are
    // golden-device work, not unit-lane work.
    if (process.env.RELAY_SKIP_LIVE_DEVICE_TESTS === "1") {
      t.skip("live device journeys are disabled in this environment");
      return;
    }
    let booted: string;
    try {
      booted = await simctl(["list", "devices", "booted"]);
    } catch {
      t.skip("simctl is not available");
      return;
    }
    if (!booted.includes(UDID)) {
      t.skip(`simulator ${UDID} is not booted`);
      return;
    }

    // Deterministic journey start: clean relaunch of Settings.
    await simctl(["terminate", UDID, SETTINGS_BUNDLE]).catch(() => undefined);
    await simctl(["launch", UDID, SETTINGS_BUNDLE]);

    const root = await mkdtemp(join(tmpdir(), "relay-goal-ios-"));
    const previousState = process.env.RELAY_STATE_DIR;
    const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
    process.env.RELAY_STATE_DIR = root;
    process.env.RELAY_WORKSPACE_ROOT = root;
    resetControlDatabaseCache();
    // agent-device 0.21.6 sessions outlive the process that opened them and
    // hold exclusive device ownership; clear this fixture's session name so a
    // previous crashed run cannot block the journey, and close it again in
    // finally so the next run starts clean.
    const closeSdkSession = () =>
      new Promise<void>((resolve) => {
        execFile(
          process.execPath,
          [join(repoRoot(), "vendor", "agent-device", "bin", "agent-device.mjs"), "close"],
          {
            timeout: 60_000,
            env: {
              ...process.env,
              AGENT_DEVICE_SESSION: `relay-ios-${UDID}`,
            },
          },
          () => resolve(),
        );
      });

    const openSdkSession = () =>
      new Promise<void>((resolve, reject) => {
        execFile(
          process.execPath,
          [
            join(repoRoot(), "vendor", "agent-device", "bin", "agent-device.mjs"),
            "open",
            SETTINGS_BUNDLE,
            "--udid",
            UDID,
          ],
          {
            timeout: 120_000,
            env: {
              ...process.env,
              AGENT_DEVICE_SESSION: `relay-ios-${UDID}`,
            },
          },
          (error) => (error ? reject(error) : resolve()),
        );
      });
    // Clear any stale owner of this fixture's session name, then own the
    // device session and its app binding before the server connects: the
    // server's clients reattach to this exact session name, so its snapshots
    // and taps run against an already-open app session.
    await closeSdkSession();
    await openSdkSession();
    // Warm the per-target SDK client before the server boots: the first
    // client created after a device-discovery pass misclassifies simulator
    // targets on the runner transport (usbmux-first). A pre-created client
    // carries the correct session binding, and the kernel reuses it.
    const { createDevice } = await import("@relay/core");
    createDevice({ kind: "device", platform: "ios", serial: UDID });
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
      // 0.21.6 semantic sessions require the app to be opened through the
      // same Relay SDK session that observes it; an external simctl launch
      // is invisible to the semantic interact path.
      const launched = await port.invoke("target.app.launch", {
        serial: UDID,
        app: SETTINGS_BUNDLE,
        relaunch: true,
      });
      assert.ok(
        launched.launched?.app === SETTINGS_BUNDLE || launched.observed?.app === SETTINGS_BUNDLE,
        "expected Settings to become the active device session",
      );
      const preObservation = await port.invoke("target.observation.capture", {
        serial: UDID,
      });
      console.log(
        "PRE-OBS:",
        preObservation.semantics?.status,
        preObservation.semantics?.controls?.length ?? 0,
        (preObservation.semantics?.message ?? "").slice(0, 120),
      );
      const result: GoalSessionResult = await createGoalSessionRunner({
        operations: port,
        store: memoryStore(),
        decisionProvider: journeyProvider(),
        id: () => "goal-ios-journey",
      }).start({
        goal: "Open General > About in Settings and capture the device summary",
        targetId: UDID,
        maxSteps: 6,
      });

      console.log(
        "JOURNEY:",
        JSON.stringify(result.stopReason),
        JSON.stringify(result.actions.map((a) => [a.id, a.candidateId, a.status, a.error])),
      );
      if (result.status !== "completed") {
        console.log(
          "LAST-OBS:",
          JSON.stringify({
            screen: result.lastObservation?.screen,
            candidates: (result.lastObservation?.candidates ?? [])
              .slice(0, 12)
              .map((candidate) => [
                candidate.id,
                candidate.kind,
                candidate.label ?? candidate.text,
                candidate.enabled,
                candidate.enabledAssumed,
              ]),
          }),
        );
      }
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
      // The About checkpoint is proven by the page's own stable rows: the
      // device Name and Model Name controls exist in the observation.
      const candidates = result.lastObservation?.candidates ?? [];
      const nameRow = candidates.find((candidate) => candidate.label === "Name");
      assert.ok(nameRow, "expected the About page Name row");
      const modelRow = candidates.find(
        (candidate) => candidate.label === "Model Name" || candidate.label === "Models Name",
      );
      assert.ok(modelRow, "expected the About page Model Name row");
      // Identity: this ran on the exact simulator UDID we asked for.
      assert.equal(result.target.targetId, UDID);
      assert.equal(result.target.platform, "ios");
      // The explicit capture produced review-linked evidence.
      const capture = result.actions.find((action) => action.interaction.kind === "capture");
      assert.ok(capture, "expected an explicit capture action");
      assert.ok((capture?.evidenceRefs ?? []).length > 0);
      // Completion stays a proposal; findings (if any) stay review-required.
      assert.match(result.stopReason?.message ?? "", /no stronger deterministic verifier/u);
      assert.ok(result.findings.every((finding) => finding.requiresReview === true));

      // Reset the journey start for the next run.
      await simctl(["terminate", UDID, SETTINGS_BUNDLE]).catch(() => undefined);
      await simctl(["launch", UDID, SETTINGS_BUNDLE]);
      await closeSdkSession();
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
