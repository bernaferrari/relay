import { operationDefinition, type OperationId } from "@relay/protocol";
import * as z from "zod/v4";

export type RelayOperationInputSchema = z.ZodObject;
export type RelayToolInputSchema = z.ZodType<Record<string, unknown>>;

const text = (description: string) => z.string().min(1).describe(description);
const natural = (description: string) => z.number().nonnegative().describe(description);
const identifier = (description: string) => text(description);
const unknownRecord = z.record(z.string(), z.unknown());
const empty = z.object({}).strict();
const open = z.object({}).catchall(z.unknown());

const targetReference = {
  serial: identifier("Connected device or managed target identifier"),
};

const sessionReference = {
  sessionId: identifier("Authoring session identifier"),
};

const authoringTarget = z
  .object({
    kind: z.enum(["device", "browser"]),
    platform: z.enum(["android", "ios", "browser"]),
    targetId: identifier("Device serial or managed browser target identifier"),
  })
  .strict();

const point = z.object({ x: z.number(), y: z.number() }).strict();
const stepTarget = unknownRecord.describe("Semantic selector, accessibility reference, or point");

const authoringInteraction = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("tap"), target: stepTarget, applied: z.boolean().optional() })
    .strict(),
  z
    .object({
      kind: z.literal("type"),
      text: z.string(),
      target: stepTarget.optional(),
      applied: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("swipe"),
      from: point,
      to: point,
      durationMs: natural("Gesture duration in milliseconds").optional(),
      applied: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("key"),
      key: z.enum(["back", "home"]),
      applied: z.boolean().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("wait"), ms: natural("Wait duration in milliseconds") }).strict(),
  z.object({ kind: z.literal("observe"), label: z.string().optional() }).strict(),
  z.object({ kind: z.literal("screenshot"), label: z.string().optional() }).strict(),
  z
    .object({
      kind: z.literal("reusable"),
      recipeId: identifier("Reusable action identifier"),
      bindings: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("steps"),
      steps: z.array(unknownRecord),
      label: z.string().optional(),
    })
    .strict(),
]);

const destination = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new-screen"), title: z.string().optional() }).strict(),
  z
    .object({ kind: z.literal("screen"), screenId: identifier("Destination screen identifier") })
    .strict(),
  z.object({ kind: z.literal("end") }).strict(),
]);

const connectionDestination = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("screen"), screenId: identifier("Destination screen identifier") })
    .strict(),
  z.object({ kind: z.literal("end") }).strict(),
]);

const schemas: Partial<Record<OperationId, RelayOperationInputSchema>> = {
  "system.audit.list": z.object({ limit: z.number().int().positive().optional() }).strict(),
  "workspace.privacy.update": z.object({ enabled: z.boolean() }).strict(),
  "workspace.evidence.update": z
    .object({
      channel: z.enum(["audio", "crash", "network-body"]),
      enabled: z.boolean(),
      reason: z.string().optional(),
    })
    .strict(),
  "target.create": z
    .object({
      id: identifier("Optional stable target identifier").optional(),
      name: text("Human-readable target name"),
      startUrl: z.url(),
      headless: z.boolean().optional(),
    })
    .strict(),
  "target.delete": z.object({ targetId: identifier("Managed target identifier") }).strict(),
  "target.preflight": z.object({ targetId: identifier("Managed target identifier") }).strict(),
  "target.open": z.object({ targetId: identifier("Managed browser target identifier") }).strict(),
  "target.boot": z.object(targetReference).strict(),
  "target.authorize": z.object(targetReference).strict(),
  "target.snapshot.capture": z.object(targetReference).strict(),
  "target.screenshot.capture": z.object(targetReference).strict(),
  "target.app.launch": z
    .object({
      ...targetReference,
      app: text("App name, package, or bundle identifier"),
      relaunch: z.boolean().optional(),
    })
    .strict(),
  "target.interact": z
    .object({
      ...targetReference,
      kind: z.enum(["label", "point", "ref", "find", "text-match", "swipe", "type"]),
    })
    .catchall(z.unknown()),
  "target.touch": z
    .object({
      ...targetReference,
      action: z.enum(["down", "move", "up", "cancel"]),
      x: z.number(),
      y: z.number(),
    })
    .strict(),
  "target.key": z
    .object({
      ...targetReference,
      kind: z.enum(["text", "key"]),
      text: z.string().optional(),
      key: z.enum(["enter", "backspace"]).optional(),
    })
    .strict(),
  "target.scroll": z
    .object({
      ...targetReference,
      x: z.number(),
      y: z.number(),
      scrollX: z.number(),
      scrollY: z.number(),
    })
    .strict(),
  "target.video.start": z
    .object({ ...targetReference, action: z.enum(["start", "stop"]) })
    .strict(),
  "project.save": z
    .object({ id: identifier("Project identifier"), name: text("Project name") })
    .strict(),
  "build.save": z
    .object({
      id: identifier("Build identifier"),
      name: text("Build name"),
      platform: z.enum(["android", "ios"]),
      sourceUrl: z.string().optional(),
      status: z.string().optional(),
    })
    .strict(),
  "device-pool.save": z
    .object({
      id: identifier("Device-pool identifier"),
      name: text("Device-pool name"),
      platform: z.enum(["android", "ios", "mixed"]).optional(),
      deviceSerials: z.array(identifier("Device serial")),
    })
    .strict(),
  "lease.create": z
    .object({
      poolId: identifier("Device-pool identifier"),
      deviceSerial: identifier("Device serial"),
      expiresAt: natural("Lease expiration timestamp").optional(),
    })
    .strict(),
  "lease.takeover": z
    .object({
      leaseId: identifier("Exact active lease being handed off"),
      expiresAt: natural("New lease expiration timestamp").optional(),
      reason: text("Why control is being handed to this actor"),
    })
    .strict(),
  "lease.release": z.object({ leaseId: identifier("Target lease identifier") }).strict(),
  "action.run": z
    .object({ actionId: identifier("Reusable action identifier") })
    .catchall(z.unknown()),
  "workspace.variables.update": z
    .object({
      expectedRevision: natural("Current variables revision"),
      value: z.array(unknownRecord),
      actorId: z.string().optional(),
      idempotencyKey: z.string().optional(),
    })
    .strict(),
  "app-map.get": z.object({ appMapId: identifier("App Map identifier") }).strict(),
  "app-map.create": z
    .object({ appMapId: identifier("App Map identifier"), name: text("App Map name") })
    .strict(),
  "app-map.duplicate": z
    .object({
      sourceAppMapId: identifier("Source App Map identifier"),
      appMapId: identifier("New App Map identifier"),
      name: text("Optional copy name").optional(),
    })
    .strict(),
  "app-map.remove": z.object({ appMapId: identifier("App Map identifier") }).strict(),
  "app-map.export": z.object({ appMapId: identifier("App Map identifier") }).strict(),
  "app-map.import": z
    .object({
      yaml: text("Portable App Map YAML"),
      dryRun: z.boolean().optional(),
      conflict: z.enum(["reject", "replace", "copy"]).optional(),
    })
    .strict(),
  "app-map.update": z
    .object({
      appMapId: identifier("App Map identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      patch: z
        .object({
          name: text("App Map name").optional(),
          description: z.union([z.string(), z.null()]).optional(),
          notes: z.record(z.string(), unknownRecord).optional(),
        })
        .strict(),
    })
    .strict(),
  "app-map.screen.add": z
    .object({
      appMapId: identifier("App Map identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      screen: z
        .object({
          id: identifier("Stable screen identifier"),
          title: text("Screen name"),
          description: z.string().optional(),
          identity: unknownRecord.describe("Optional observed screen identity").optional(),
          position: point.describe("Optional canvas position").optional(),
        })
        .strict(),
    })
    .strict(),
  "app-map.screen.update": z
    .object({
      appMapId: identifier("App Map identifier"),
      screenId: identifier("Screen identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      input: unknownRecord.describe("Screen update"),
    })
    .strict(),
  "app-map.screen.remove": z
    .object({
      appMapId: identifier("App Map identifier"),
      screenId: identifier("Screen identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
    })
    .strict(),
  "app-map.connection.create": z
    .object({
      appMapId: identifier("App Map identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      connection: z
        .object({
          id: identifier("Stable connection identifier"),
          fromScreenId: identifier("Source screen identifier"),
          destination: connectionDestination,
          label: z.string().optional(),
          caseStackId: identifier("Optional case stack identifier").optional(),
          state: z.enum(["draft", "ready"]).optional(),
          actions: z.array(unknownRecord).describe("Optional action specifications").optional(),
        })
        .strict(),
    })
    .strict(),
  "app-map.connection.update": z
    .object({
      appMapId: identifier("App Map identifier"),
      connectionId: identifier("Connection identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      patch: unknownRecord.describe("Connection patch"),
    })
    .strict(),
  "app-map.connection.remove": z
    .object({
      appMapId: identifier("App Map identifier"),
      connectionId: identifier("Connection identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
    })
    .strict(),
  "app-map.flow.save": z
    .object({
      appMapId: identifier("App Map identifier"),
      flowId: identifier("Flow identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      flow: z
        .object({
          name: text("Flow name"),
          startScreenId: identifier("Starting screen identifier"),
          setup: z
            .object({
              routineId: identifier("Before-run Routine identifier"),
              bindings: z.record(z.string(), z.string()).optional(),
            })
            .strict()
            .optional(),
          connectionIds: z.array(identifier("Connection identifier")),
        })
        .strict(),
    })
    .strict(),
  "app-map.flow.remove": z
    .object({
      appMapId: identifier("App Map identifier"),
      flowId: identifier("Flow identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
    })
    .strict(),
  "app-map.flow.run": z
    .object({
      appMapId: identifier("App Map identifier"),
      flowId: identifier("Saved flow identifier"),
      serial: identifier("Connected device serial").optional(),
      platform: z.enum(["android", "ios"]).optional(),
      targetKind: z.enum(["device", "browser"]).optional(),
      browserTargetId: identifier("Managed browser target identifier").optional(),
      variables: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    })
    .strict(),
  "app-map.case-stack.save": z
    .object({
      appMapId: identifier("App Map identifier"),
      caseStackId: identifier("Case Stack identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      caseStack: unknownRecord.describe("Normalized reusable Case Stack"),
    })
    .strict(),
  "app-map.case-stack.attach": z
    .object({
      appMapId: identifier("App Map identifier"),
      connectionId: identifier("Connection identifier"),
      caseStackId: identifier("Case Stack identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      caseStack: unknownRecord.describe("Optional Case Stack to create atomically").optional(),
    })
    .strict(),
  "app-map.case-stack.remove": z
    .object({
      appMapId: identifier("App Map identifier"),
      caseStackId: identifier("Case Stack identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
    })
    .strict(),
  "app-map.routine.save": z
    .object({
      appMapId: identifier("App Map identifier"),
      routineId: identifier("Routine identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      routine: z
        .object({
          name: text("Routine name"),
          description: z.string().optional(),
          parameters: z.array(unknownRecord).optional(),
          actions: z.array(unknownRecord).describe("Reusable action specifications"),
        })
        .strict(),
    })
    .strict(),
  "app-map.routine.remove": z
    .object({
      appMapId: identifier("App Map identifier"),
      routineId: identifier("Routine identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
    })
    .strict(),
  "app-map.proposal.submit": z
    .object({
      appMapId: identifier("App Map identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      proposal: unknownRecord.describe("Reviewable App Map proposal"),
    })
    .strict(),
  "app-map.observations.propose": z
    .object({
      appMapId: identifier("App Map identifier"),
      sessionId: identifier("Observation session identifier"),
      expectedRevision: natural("Current App Map revision"),
      proposalId: identifier("Optional stable proposal identifier").optional(),
      title: text("Proposal title").optional(),
      transitionIds: z.array(identifier("Observed transition identifier")).optional(),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
    })
    .strict(),
  "app-map.proposal.approve": z
    .object({
      appMapId: identifier("App Map identifier"),
      proposalId: identifier("Proposal identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      reason: z.string().optional(),
    })
    .strict(),
  "app-map.proposal.reject": z
    .object({
      appMapId: identifier("App Map identifier"),
      proposalId: identifier("Proposal identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      reason: z.string().optional(),
    })
    .strict(),
  "authoring.session.get": z.object(sessionReference).strict(),
  "authoring.session.create": z
    .object({
      appMapId: identifier("App Map identifier"),
      target: authoringTarget,
      leaseId: identifier("Actor-owned target lease identifier"),
      expectedAppMapRevision: natural("Current App Map revision"),
      sourceScreenId: identifier("Source screen identifier").optional(),
      pendingConnectionId: identifier("Pending connection identifier").optional(),
      group: z.string().optional(),
    })
    .strict(),
  "authoring.session.observe": z.object(sessionReference).strict(),
  "authoring.session.start": z.object(sessionReference).strict(),
  "authoring.session.interact": z
    .object({ ...sessionReference, interaction: authoringInteraction })
    .strict(),
  "authoring.session.stop": z.object(sessionReference).strict(),
  "authoring.take.trim": z
    .object({
      ...sessionReference,
      fromMs: natural("Clip start in milliseconds").optional(),
      toMs: natural("Clip end in milliseconds").optional(),
      actionIds: z.array(identifier("Authoring action identifier")).optional(),
    })
    .strict(),
  "authoring.take.reorder": z
    .object({ ...sessionReference, actionIds: z.array(identifier("Authoring action identifier")) })
    .strict(),
  "authoring.take.replace": z
    .object({
      ...sessionReference,
      actionId: identifier("Authoring action identifier"),
      interaction: authoringInteraction,
    })
    .strict(),
  "authoring.take.replay": z.object(sessionReference).strict(),
  "authoring.session.commit": z
    .object({
      ...sessionReference,
      destination: destination.optional(),
    })
    .strict(),
  "authoring.session.discard": z.object(sessionReference).strict(),
  "authoring.session.cancel": z.object(sessionReference).strict(),
  "authoring.session.cleanup": z.object(sessionReference).strict(),
  "schedule.delete": z.object({ scheduleId: identifier("Schedule identifier") }).strict(),
  "matrix.delete": z.object({ matrixId: identifier("Compatibility matrix identifier") }).strict(),
  "matrix.resolve": z.object({ matrixId: identifier("Compatibility matrix identifier") }).strict(),
  "discovery.rename": z
    .object({ sessionId: identifier("Discovery session identifier"), name: text("Discovery name") })
    .strict(),
  "discovery.status.update": z
    .object({
      sessionId: identifier("Discovery session identifier"),
      status: z.enum(["draft", "running", "paused", "complete", "stopped"]),
    })
    .strict(),
  "discovery.capture": z.object({ sessionId: identifier("Discovery session identifier") }).strict(),
  "discovery.interact": z
    .object({ sessionId: identifier("Discovery session identifier"), kind: z.string() })
    .catchall(z.unknown()),
  "job.list": z
    .object({ full: z.boolean().optional(), limit: z.number().int().positive().optional() })
    .strict(),
  "job.get": z.object({ jobId: identifier("Job identifier") }).strict(),
  "job.start": z
    .object({ action: identifier("Action or App Map identifier"), serial: z.string().optional() })
    .catchall(z.unknown()),
  "job.retry": z.object({ jobId: identifier("Job identifier") }).strict(),
  "job.cancel": z.object({ jobId: identifier("Job identifier") }).strict(),
  "job.pause": z.object({ jobId: identifier("Job identifier") }).strict(),
  "job.resume": z.object({ jobId: identifier("Job identifier") }).strict(),
  "run.pin.update": z
    .object({ runId: identifier("Run identifier"), pinned: z.boolean().optional() })
    .strict(),
  "step.run": z.object({ step: unknownRecord, serial: identifier("Target identifier") }).strict(),
  "generation.create": z
    .object({
      purpose: z.enum(["variable", "test-plan"]),
      prompt: text("Generation prompt"),
      provider: z.string().optional(),
      model: z.string().optional(),
      count: z.number().int().positive().optional(),
      seed: z.number().int().optional(),
    })
    .strict(),
};

/**
 * MCP schemas are presentation contracts. Relay's protocol parser remains the
 * authority and is run again immediately before invocation.
 */
export function relayOperationInputSchema(operationId: OperationId): RelayOperationInputSchema {
  const schema = schemas[operationId];
  if (schema) return schema;
  return operationDefinition(operationId).input.description === "empty object" ? empty : open;
}

export function relayToolInputSchema(
  operationId: OperationId,
  requiresConfirmation: boolean,
): RelayToolInputSchema {
  const directSchema = relayOperationInputSchema(operationId).extend({
    confirm: requiresConfirmation
      ? z.literal(true).describe("Explicit approval for this protected operation")
      : z.literal(true).optional().describe("Optional explicit approval"),
  });

  return directSchema;
}
