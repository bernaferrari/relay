import type { AuthoringInteraction } from "@relay/protocol";
import { createRelayOutcomeJobs, type WorkflowRef } from "@relay/workflows";
import * as z from "zod/v4";
import type { OperationInvoker } from "./server.js";

type OutcomeInputSchema = z.ZodType<Record<string, unknown>>;

export type RelayOutcomeToolDescriptor = {
  readonly name: `relay_${string}`;
  readonly title: string;
  readonly description: string;
  readonly requiresConfirmation: boolean;
  readonly inputSchema: OutcomeInputSchema;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: false;
  };
};

const identifier = z.string().trim().min(1);
const targetId = identifier.optional().describe("Only needed when more than one device is ready");
const workflowDecision = { ref: identifier, expectedVersion: identifier } as const;
const semanticTarget = z
  .object({
    identifier: identifier.optional(),
    label: identifier.optional(),
    text: identifier.optional(),
    role: identifier.optional(),
    point: z.object({ x: z.number(), y: z.number() }).strict().optional(),
  })
  .strict();
const recordedInteraction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tap"), target: semanticTarget }).strict(),
  z
    .object({
      kind: z.literal("type"),
      text: z.string(),
      target: semanticTarget.optional(),
      mode: z.enum(["append", "replace"]).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("key"), key: z.enum(["back", "home"]) }).strict(),
  z
    .object({
      kind: z.literal("swipe"),
      from: z.object({ x: z.number(), y: z.number() }).strict(),
      to: z.object({ x: z.number(), y: z.number() }).strict(),
      durationMs: z.number().min(50).max(5_000).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("wait"), ms: z.number().int().nonnegative() }).strict(),
]);

export const relayOutcomeTools = Object.freeze([
  {
    name: "relay_connect_target",
    title: "Connect to a target",
    description:
      "Discover ready local devices and select the sole target automatically. Supply targetId only when several devices are ready.",
    requiresConfirmation: false,
    inputSchema: z.object({ targetId }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "relay_record_test",
    title: "Record a Test",
    description:
      "Start one canonical recording on the sole ready device and current App Map revision. Relay may acquire an unclaimed lease but never takes over another actor's control.",
    requiresConfirmation: true,
    inputSchema: z
      .object({ appMapId: identifier.optional(), title: identifier, targetId })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_run_test",
    title: "Run a Test",
    description:
      "Compile and run one saved Test against the sole ready device and current App Map revision. Returns an inspectable workflow reference and immutable run evidence references.",
    requiresConfirmation: false,
    inputSchema: z
      .object({ appMapId: identifier.optional(), testId: identifier, targetId })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_record_action",
    title: "Record one action",
    description:
      "Append one typed tap, type, key, swipe, or wait to the active recording using its opaque reference and optimistic version.",
    requiresConfirmation: false,
    inputSchema: z.object({ ...workflowDecision, interaction: recordedInteraction }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_add_checkpoint",
    title: "Add a recording checkpoint",
    description: "Capture an immutable named checkpoint in the active recording.",
    requiresConfirmation: false,
    inputSchema: z.object({ ...workflowDecision, label: identifier.optional() }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_stop_recording",
    title: "Stop and compile a recording",
    description: "Stop raw capture and compile the canonical Take for review.",
    requiresConfirmation: false,
    inputSchema: z.object(workflowDecision).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_replay_recording",
    title: "Replay a recording",
    description: "Replay the exact reviewed Take revision and return its proof state.",
    requiresConfirmation: false,
    inputSchema: z.object(workflowDecision).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_approve_recording",
    title: "Approve a recorded Test",
    description:
      "After a passing replay, explicitly approve the recording into the App Map and generated Test.",
    requiresConfirmation: true,
    inputSchema: z.object(workflowDecision).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_repeat_test",
    title: "Repeat a Test",
    description:
      "Run one representative pilot over selected values. Inspect the returned workflow, then explicitly call relay_continue_repeat for the remaining values.",
    requiresConfirmation: false,
    inputSchema: z
      .object({
        appMapId: identifier.optional(),
        testId: identifier,
        dimensionId: identifier,
        valueIds: z.array(identifier).min(1),
        evidence: z.enum(["visual", "smoke"]).optional(),
        targetId,
      })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_inspect_workflow",
    title: "Inspect a workflow",
    description:
      "Read the latest canonical Run, Repeat, or recording state from an opaque workflow reference.",
    requiresConfirmation: false,
    inputSchema: z.object({ ref: identifier }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "relay_continue_repeat",
    title: "Continue a Repeat",
    description:
      "After reviewing a successful representative pilot, explicitly run the untouched selected values. Uses optimistic workflow versioning.",
    requiresConfirmation: true,
    inputSchema: z.object({ ref: identifier, expectedVersion: identifier }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_inspect_failure",
    title: "Inspect a failure",
    description:
      "Read one failed Run together with its immutable evidence and existing repair proposals.",
    requiresConfirmation: false,
    inputSchema: z.object({ runId: identifier }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "relay_propose_repair",
    title: "Propose a repair",
    description:
      "Create a reviewable accept-current or disable proposal for one failed check. This never approves or rewrites a Test.",
    requiresConfirmation: false,
    inputSchema: z
      .object({
        runId: identifier,
        checkId: identifier,
        proposal: z.enum(["accept-current", "disable"]),
        reason: identifier,
      })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_export_evidence",
    title: "Export evidence",
    description:
      "Export the portable content-addressed TracePack for one persisted Run. Advanced Combine export remains available in raw operation profiles.",
    requiresConfirmation: false,
    inputSchema: z.object({ runId: identifier }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
] as const satisfies readonly RelayOutcomeToolDescriptor[]);

export async function invokeRelayOutcomeTool(input: {
  name: RelayOutcomeToolDescriptor["name"];
  argumentsValue: Record<string, unknown>;
  confirmed: boolean;
  invoker: OperationInvoker;
  actorId: string;
  signal: AbortSignal;
}): Promise<unknown> {
  const descriptor = relayOutcomeTools.find(({ name }) => name === input.name);
  if (!descriptor) throw new TypeError(`Unknown Relay outcome tool: ${input.name}`);
  if (descriptor.requiresConfirmation && !input.confirmed) {
    throw new TypeError(`${descriptor.name} requires confirm: true.`);
  }
  const parsed = descriptor.inputSchema.parse(input.argumentsValue) as Record<string, unknown>;
  const jobs = createRelayOutcomeJobs(
    {
      invoke: (operationId, operationInput) =>
        input.invoker.invoke(operationId, operationInput as never, { signal: input.signal }),
    },
    { actorId: input.actorId },
  );
  if (input.name === "relay_connect_target") {
    return jobs.connect({
      kind: "connect-target",
      ...(typeof parsed.targetId === "string" ? { targetId: parsed.targetId } : {}),
    });
  }
  if (input.name === "relay_record_test") {
    return jobs.record({
      kind: "record-test",
      ...(typeof parsed.appMapId === "string" ? { appMapId: parsed.appMapId } : {}),
      title: parsed.title as string,
      confirmControl: true,
      ...(typeof parsed.targetId === "string" ? { targetId: parsed.targetId } : {}),
    });
  }
  if (input.name === "relay_run_test") {
    return jobs.run({
      kind: "run-test",
      ...(typeof parsed.appMapId === "string" ? { appMapId: parsed.appMapId } : {}),
      testId: parsed.testId as string,
      ...(typeof parsed.targetId === "string" ? { targetId: parsed.targetId } : {}),
    });
  }
  if (input.name === "relay_repeat_test") {
    return jobs.repeat({
      kind: "repeat-test",
      ...(typeof parsed.appMapId === "string" ? { appMapId: parsed.appMapId } : {}),
      testId: parsed.testId as string,
      over: {
        dimensionId: parsed.dimensionId as string,
        valueIds: parsed.valueIds as string[],
      },
      ...(parsed.evidence === "visual" || parsed.evidence === "smoke"
        ? { evidence: parsed.evidence }
        : {}),
      ...(typeof parsed.targetId === "string" ? { targetId: parsed.targetId } : {}),
    });
  }
  if (input.name === "relay_record_action") {
    return jobs.advanceRecording({
      action: "record",
      ref: parsed.ref as WorkflowRef,
      expectedVersion: parsed.expectedVersion as string,
      interaction: parsed.interaction as AuthoringInteraction,
    });
  }
  if (input.name === "relay_add_checkpoint") {
    return jobs.advanceRecording({
      action: "checkpoint",
      ref: parsed.ref as WorkflowRef,
      expectedVersion: parsed.expectedVersion as string,
      ...(typeof parsed.label === "string" ? { label: parsed.label } : {}),
    });
  }
  if (input.name === "relay_stop_recording") {
    return jobs.advanceRecording({
      action: "stop",
      ref: parsed.ref as WorkflowRef,
      expectedVersion: parsed.expectedVersion as string,
    });
  }
  if (input.name === "relay_replay_recording") {
    return jobs.advanceRecording({
      action: "replay",
      ref: parsed.ref as WorkflowRef,
      expectedVersion: parsed.expectedVersion as string,
    });
  }
  if (input.name === "relay_approve_recording") {
    return jobs.advanceRecording({
      action: "approve",
      ref: parsed.ref as WorkflowRef,
      expectedVersion: parsed.expectedVersion as string,
    });
  }
  if (input.name === "relay_inspect_workflow") {
    return jobs.inspect(parsed.ref as WorkflowRef);
  }
  if (input.name === "relay_continue_repeat") {
    return jobs.continueRepeat({
      ref: parsed.ref as WorkflowRef,
      expectedVersion: parsed.expectedVersion as string,
      confirmRemaining: true,
    });
  }
  if (input.name === "relay_inspect_failure") {
    return jobs.inspectFailure({ kind: "inspect-failure", runId: parsed.runId as string });
  }
  if (input.name === "relay_propose_repair") {
    return jobs.proposeRepair({
      kind: "propose-repair",
      runId: parsed.runId as string,
      checkId: parsed.checkId as string,
      proposal: parsed.proposal as "accept-current" | "disable",
      reason: parsed.reason as string,
    });
  }
  return jobs.exportEvidence({ kind: "export-evidence", runId: parsed.runId as string });
}
