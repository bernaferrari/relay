import type {
  AuthoringInteraction,
  AuthoringTarget,
  StepTarget,
  GoalSessionAction,
} from "@relay/protocol";
import type { AuthorTestSnapshot } from "./types.js";
import { CanonicalAuthoringWorkflow } from "./authoring-workflow.js";
import { acquireOwnLease, selectAppMap } from "./target-catalog.js";
import type { RelayOperationPort } from "./operation-port.js";
import type { GoalSessionRunner } from "./goal-runner.js";

const MAX_TITLE_CHARS = 160;

function assertOpenedTarget(result: { session: { targetId: string } }, targetId: string): void {
  if (result.session.targetId !== targetId) {
    throw new TypeError(
      `Relay opened target ${result.session.targetId}, but promotion requested ${targetId}.`,
    );
  }
}

export type GoalPromotionInput = {
  sessionId: string;
  title?: string;
  appMapId?: string;
  confirmControl: true;
};

export type GoalPromotionRunnerOptions = {
  operations: RelayOperationPort;
  sessions: Pick<GoalSessionRunner, "inspect">;
  actorId: string;
};

export type GoalPromotionRunner = {
  promote(input: GoalPromotionInput): Promise<AuthorTestSnapshot>;
};

function promotionTargetId(sessionId: string): string {
  return `goal-test-${sessionId.slice(0, 110)}`;
}

function promotionTitle(goal: string, requested?: string): string {
  const title = requested?.trim() || `Goal reproduction: ${goal}`;
  if (!title) throw new TypeError("A promotion title is required.");
  return title.slice(0, MAX_TITLE_CHARS);
}

function stepTarget(selector: {
  identifier?: string;
  ref?: string;
  label?: string;
  point?: { x: number; y: number };
}): StepTarget {
  return {
    ...(selector.identifier ? { identifier: selector.identifier } : {}),
    ...(selector.ref ? { ref: selector.ref } : {}),
    ...(selector.label ? { label: selector.label } : {}),
    ...(selector.point ? { point: { ...selector.point } } : {}),
  };
}

/** Promoted tests keep the executed action shapes: fill, system keys, swipes,
 * waits, and explicit captures map onto the same authoring vocabulary. */
function authoringInteraction(action: GoalSessionAction): AuthoringInteraction {
  const interaction = action.interaction;
  if (interaction.kind === "fill") {
    if (
      interaction.target.point &&
      !interaction.target.identifier &&
      !interaction.target.ref &&
      !interaction.target.label
    ) {
      throw new TypeError(
        `Goal action ${action.id} fills via a point selector only. Review it manually before promotion.`,
      );
    }
    return {
      kind: "type",
      text: interaction.value,
      ...(interaction.mode ? { mode: interaction.mode } : {}),
      target: stepTarget(interaction.target),
    };
  }
  if (interaction.kind === "key") {
    return { kind: "key", key: interaction.key };
  }
  if (interaction.kind === "swipe") {
    return { kind: "swipe", from: { ...interaction.from }, to: { ...interaction.to } };
  }
  if (interaction.kind === "wait") {
    return { kind: "wait", ms: interaction.ms };
  }
  if (interaction.kind === "capture") {
    return { kind: "observe" };
  }
  if (interaction.target.point && !interaction.target.identifier && !interaction.target.ref && !interaction.target.label) {
    throw new TypeError(
      `Goal action ${action.id} has only a point selector. Review it manually before promotion.`,
    );
  }
  return { kind: "tap", target: stepTarget(interaction.target) };
}

async function prepareTarget(
  operations: RelayOperationPort,
  sessionId: string,
  startUrl: string,
  authenticationFixtureReference?: string,
): Promise<AuthoringTarget> {
  const targetId = promotionTargetId(sessionId);
  const registered = await operations.invoke("target.list", {});
  const existing = registered.targets.find((target) => target.id === targetId);
  if (existing && (existing.kind !== "browser" || existing.browser?.startUrl !== startUrl)) {
    throw new TypeError("The promotion target is bound to a different browser configuration.");
  }
  if (!existing) {
    const created = await operations.invoke("target.create", {
      id: targetId,
      name: `Relay Test ${sessionId.slice(0, 8)}`,
      startUrl,
      headless: true,
      profileRetention: "ephemeral",
    });
    if (created.target.id !== targetId || created.target.kind !== "browser") {
      throw new TypeError("Relay returned an unexpected promotion browser target.");
    }
  }
  const opened = await operations.invoke("target.open", {
    targetId,
    ...(authenticationFixtureReference
      ? { authenticationFixtureReference }
      : { signedOut: true as const }),
    presentation: "embedded",
  });
  assertOpenedTarget(opened, targetId);
  return { kind: "browser", platform: "browser", targetId };
}

export function createGoalPromotionRunner(
  options: GoalPromotionRunnerOptions,
): GoalPromotionRunner {
  if (!options.actorId.trim()) throw new TypeError("Goal promotion requires an actor identity.");
  const authoring = new CanonicalAuthoringWorkflow(options.operations);

  return {
    async promote(input) {
      if (input.confirmControl !== true) {
        throw new TypeError("Goal promotion requires explicit confirmation before target control.");
      }
      const session = await options.sessions.inspect(input.sessionId);
      const reproduction = session.reproduction;
      if (!reproduction || reproduction.status !== "reproduced") {
        throw new TypeError(
          "Goal promotion requires a completed fresh reproduction. Reproduce the goal first.",
        );
      }
      if (session.target.platform !== "browser" || !session.target.startUrl) {
        throw new TypeError("Goal promotion currently requires a browser goal with a startUrl.");
      }
      const actions = reproduction.actions.filter((action) => action.status === "acknowledged");
      if (actions.length === 0 || actions.length !== reproduction.actions.length) {
        throw new TypeError("Goal promotion requires every reproduced action to be acknowledged.");
      }
      const target = await prepareTarget(
        options.operations,
        session.id,
        session.target.startUrl,
        session.target.authenticationFixtureReference,
      );
      const appMapId = await selectAppMap(
        options.operations,
        input.appMapId,
        promotionTitle(session.goal, input.title),
      );
      const leaseId = await acquireOwnLease(options.operations, options.actorId, target.targetId);
      const title = promotionTitle(session.goal, input.title);
      let snapshot = await authoring.start({
        kind: "author-test",
        actorId: options.actorId,
        title,
        appMapId,
        target,
        leaseId,
        revision: "current",
        workflowRequestId: `goal-promote-${session.id.slice(0, 110)}`,
        continuation: "durable",
      });
      if (!snapshot.workflow) return snapshot;
      const recorded = snapshot.review?.actionCount ?? 0;
      if (recorded > actions.length) {
        throw new TypeError(
          "The existing promotion recording contains more actions than the goal path.",
        );
      }
      for (let index = recorded; index < actions.length; index += 1) {
        if (!snapshot.workflow || !snapshot.allowedNextActions.includes("record")) return snapshot;
        snapshot = await authoring.advanceDurable({
          ...snapshot.workflow,
          action: "record",
          interaction: authoringInteraction(actions[index]!),
        });
        if (snapshot.phase === "needs-attention" || snapshot.stage !== "recording") return snapshot;
      }
      if (snapshot.workflow && snapshot.allowedNextActions.includes("stop")) {
        snapshot = await authoring.advanceDurable({ ...snapshot.workflow, action: "stop" });
      }
      if (snapshot.workflow && snapshot.allowedNextActions.includes("replay")) {
        snapshot = await authoring.advanceDurable({ ...snapshot.workflow, action: "replay" });
      }
      return snapshot;
    },
  };
}
