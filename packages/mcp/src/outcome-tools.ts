import { repeatSpecSchema, type AuthoringInteraction, type RepeatSpec } from "@relay/protocol";
import { createRelayOutcomeJobs, type RelayOutcomeJobs, type WorkflowRef } from "@relay/workflows";
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

const recordingEdit = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("remove"), actionIds: z.array(identifier).min(1) }).strict(),
  z.object({ kind: z.literal("reorder"), actionIds: z.array(identifier).min(1) }).strict(),
  z
    .object({ kind: z.literal("replace"), actionId: identifier, interaction: recordedInteraction })
    .strict(),
  z
    .object({
      kind: z.literal("merge"),
      actionIds: z.array(identifier).min(2),
      intent: z.string().trim().min(1).max(240).optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal("split"), actionId: identifier, atStep: z.number().int().min(1) })
    .strict(),
  z
    .object({
      kind: z.literal("rename"),
      actionId: identifier,
      intent: z.string().trim().min(1).max(240),
    })
    .strict(),
]);

export const relayOutcomeTools = Object.freeze([
  {
    name: "relay_connect_target",
    title: "Connect to a Device",
    description:
      "Discover ready local Devices and select the sole Device automatically. Supply targetId only when several Devices are ready.",
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
    name: "relay_observe_target",
    title: "Observe a Device",
    description:
      "Capture one bounded pixel and semantic observation without taking control. Pixels remain available when accessibility is stale or unavailable.",
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
      "Start one recording in the current Test workspace on the sole ready Device. Relay may reserve available control but never displaces another person or agent.",
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
      "Compile and run one saved Test on the sole ready Device. Returns a continuation reference and immutable Run evidence references.",
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
    description: "Stop raw capture and prepare the recorded Test for review.",
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
    name: "relay_edit_recording",
    title: "Edit a recording",
    description:
      "Transform the reviewed recording with one typed remove, reorder, replace, merge, split, or rename command. Every successful edit creates a new revision that must replay before approval.",
    requiresConfirmation: false,
    inputSchema: z.object({ ...workflowDecision, edit: recordingEdit }).strict(),
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
    description: "Replay the exact reviewed recording revision and return its proof state.",
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
    description: "After a passing replay, explicitly approve the recording as the named Test.",
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
        repeat: repeatSpecSchema,
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
      "Read the latest canonical Run, Repeat, or recording state from a continuation reference.",
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
      "Export the portable content-addressed TracePack for one persisted Run. Advanced batch export remains available in raw operation profiles.",
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
  const jobs = createRelayOutcomeJobs(
    {
      invoke: (operationId, operationInput) =>
        input.invoker.invoke(operationId, operationInput as never, { signal: input.signal }),
    },
    { actorId: input.actorId },
  );
  return invokeRelayOutcomeToolWithJobs({
    name: input.name,
    argumentsValue: input.argumentsValue,
    confirmed: input.confirmed,
    jobs,
  });
}

/**
 * Validate and translate the public MCP boundary into the outcome façade.
 * Kept separate from transport construction so every public tool can be
 * contract-tested without reproducing canonical workflow behavior in MCP.
 */
export async function invokeRelayOutcomeToolWithJobs(input: {
  name: RelayOutcomeToolDescriptor["name"];
  argumentsValue: Record<string, unknown>;
  confirmed: boolean;
  jobs: RelayOutcomeJobs;
}): Promise<unknown> {
  const descriptor = relayOutcomeTools.find(({ name }) => name === input.name);
  if (!descriptor) throw new TypeError(`Unknown Relay outcome tool: ${input.name}`);
  if (descriptor.requiresConfirmation && !input.confirmed) {
    throw new TypeError(`${descriptor.name} requires confirm: true.`);
  }
  const parsed = descriptor.inputSchema.parse(input.argumentsValue) as Record<string, unknown>;
  const { jobs } = input;
  if (input.name === "relay_connect_target") {
    return jobs.connect({
      kind: "connect-target",
      ...(typeof parsed.targetId === "string" ? { targetId: parsed.targetId } : {}),
    });
  }
  if (input.name === "relay_observe_target") {
    return jobs.observe({
      kind: "observe-target",
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
      repeat: parsed.repeat as RepeatSpec,
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
  if (input.name === "relay_edit_recording") {
    return jobs.editRecording({
      kind: "edit-recording",
      ref: parsed.ref as WorkflowRef,
      expectedVersion: parsed.expectedVersion as string,
      edit: parsed.edit as Parameters<RelayOutcomeJobs["editRecording"]>[0]["edit"],
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
