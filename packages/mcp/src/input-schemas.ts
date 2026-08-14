import { operationDefinition, type OperationId } from "@relay/protocol";
import * as z from "zod/v4";
import {
  graphTest,
  legacyTest,
  testCapturePolicy,
  testSemanticEdits,
} from "./test-input-schemas.js";

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

const authoringTarget = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("device"),
      platform: z.enum(["android", "ios"]),
      targetId: identifier("Connected device serial"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("browser"),
      platform: z.literal("browser"),
      targetId: identifier("Managed browser target identifier"),
    })
    .strict(),
]);

const point = z
  .object({
    x: z.number(),
    y: z.number(),
    anchor: z
      .object({
        horizontal: z.enum(["left", "center", "right"]),
        vertical: z.enum(["top", "center", "bottom"]),
      })
      .strict()
      .optional(),
    referenceBounds: z
      .object({ width: z.number().positive(), height: z.number().positive() })
      .strict()
      .optional(),
  })
  .strict();
const stepTarget = z
  .object({
    identifier: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    point: point.optional(),
  })
  .strict()
  .refine(
    ({ identifier, ref, label, text: targetText, point: targetPoint }) =>
      Boolean(identifier || ref || label || targetText || targetPoint),
    "Target needs an identifier, ref, label, text, or point",
  )
  .describe("Semantic selector, accessibility reference, or point");

const authoringInteraction = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("tap"), target: stepTarget, applied: z.boolean().optional() })
    .strict(),
  z
    .object({
      kind: z.literal("type"),
      text: z.string(),
      target: stepTarget.optional(),
      mode: z.enum(["append", "replace"]).optional(),
      applied: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("clipboard"),
      action: z.enum(["write", "read", "paste", "copy"]),
      text: z.string().optional(),
      target: stepTarget.optional(),
      expect: z.string().optional(),
      match: z.enum(["exact", "contains"]).optional(),
      applied: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("app"),
      action: z.enum([
        "open",
        "close",
        "switcher",
        "inspect",
        "assert-installed",
        "assert-not-installed",
        "install",
        "update",
        "uninstall",
      ]),
      app: z.string().optional(),
      url: z.url().optional(),
      relaunch: z.boolean().optional(),
      artifact: z.string().optional(),
      as: z.string().optional(),
      version: z.string().optional(),
      versionMatch: z.enum(["exact", "contains"]).optional(),
      applied: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("device"),
      action: z.enum(["lock", "unlock", "keyboard-dismiss", "keyboard-enter"]),
      applied: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rotate"),
      orientation: z.enum([
        "portrait",
        "portrait-upside-down",
        "landscape-left",
        "landscape-right",
      ]),
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
  "target.ui.describe": z.object(targetReference).strict(),
  "target.ui.back": z
    .object({
      ...targetReference,
      parentTitles: z.array(z.string()).optional(),
    })
    .strict(),
  "target.ui.scrollCollect": z
    .object({
      ...targetReference,
      maxScrolls: z.number().int().min(0).max(8).optional(),
      allowSensitive: z.boolean().optional(),
    })
    .strict(),
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
  "app-map.teach": z
    .object({
      appMapId: identifier("App Map identifier"),
      expectedRevision: natural("Optional App Map revision; stale values retry").optional(),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      target: authoringTarget,
      leaseId: identifier("Exclusive control lease"),
      fromScreenId: identifier("Source screen when tapping a destination").optional(),
      title: text("Destination screen title").optional(),
      label: text("Connection label").optional(),
      interaction: z
        .discriminatedUnion("kind", [
          z.object({ kind: z.literal("point"), x: z.number(), y: z.number() }).strict(),
          z
            .object({
              kind: z.literal("label"),
              label: text("Visible label"),
              point: point.optional(),
            })
            .strict(),
          z
            .object({
              kind: z.literal("identifier"),
              identifier: identifier("Accessibility identifier"),
              point: point.optional(),
            })
            .strict(),
        ])
        .optional(),
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
  "app-map.test.save": z
    .object({
      appMapId: identifier("App Map identifier"),
      testId: identifier("Stable Test identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      test: z.union([graphTest, legacyTest]),
    })
    .strict(),
  "app-map.test.edit": z
    .object({
      appMapId: identifier("App Map identifier"),
      testId: identifier("Graph-native Test identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      edits: testSemanticEdits,
    })
    .strict(),
  "app-map.test.propose": z
    .object({
      appMapId: identifier("App Map identifier"),
      testId: identifier("Graph-native Test identifier"),
      expectedRevision: natural("App Map revision the proposal was based on"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      proposalId: identifier("Optional stable proposal identifier").optional(),
      title: text("Human-readable review title").optional(),
      description: text("Optional review context").optional(),
      edits: testSemanticEdits,
    })
    .strict(),
  "app-map.test.run": z
    .object({
      appMapId: identifier("App Map identifier"),
      testId: identifier("Graph-native Test identifier"),
      expectedRevision: natural("Exact saved App Map revision to run"),
      target: authoringTarget.describe("Explicit device or managed browser target"),
    })
    .strict(),
  "app-map.test.compile": z
    .object({
      appMapId: identifier("App Map identifier"),
      testId: identifier("Graph-native Test identifier"),
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
  "corpus.rename": z
    .object({ sessionId: identifier("Corpus session identifier"), name: text("Corpus name") })
    .strict(),
  "corpus.status.update": z
    .object({
      sessionId: identifier("Corpus session identifier"),
      status: z.enum(["draft", "running", "paused", "complete", "stopped", "failed"]),
    })
    .strict(),
  "corpus.start": z.object({ sessionId: identifier("Corpus session identifier") }).strict(),
  "corpus.cancel": z.object({ sessionId: identifier("Corpus session identifier") }).strict(),
  "job.list": z
    .object({ full: z.boolean().optional(), limit: z.number().int().positive().optional() })
    .strict(),
  "job.get": z.object({ jobId: identifier("Job identifier") }).strict(),
  "job.combine.start": z
    .object({
      appMapId: identifier("App Map identifier"),
      testId: identifier("Test identifier to run once").optional(),
      combineId: identifier("Saved run matrix identifier").optional(),
      flowId: identifier("Legacy Flow identifier").optional(),
      variableIds: z.array(identifier("State set identifier")).optional(),
      selected: z.record(z.string(), z.array(z.string())).optional(),
      strategy: z.enum(["zip", "cartesian", "pairwise"]).optional(),
      serial: identifier("Connected device serial").optional(),
      platform: z.enum(["android", "ios"]).optional(),
      targetKind: z.enum(["device", "browser"]).optional(),
      browserTargetId: identifier("Managed browser target identifier").optional(),
      title: z.string().optional(),
      seed: z.number().int().optional(),
      sets: z.array(unknownRecord).optional(),
      capture: testCapturePolicy.optional(),
    })
    .strict()
    .superRefine((input, context) => {
      if (!input.testId && !input.combineId && !input.flowId) {
        context.addIssue({
          code: "custom",
          message: "Choose exactly one testId, combineId, or flowId",
          path: ["testId"],
        });
      }
      if ([input.testId, input.combineId, input.flowId].filter(Boolean).length > 1) {
        context.addIssue({
          code: "custom",
          message: "Choose only one testId, combineId, or flowId",
          path: ["testId"],
        });
      }
      if (!input.serial && !input.browserTargetId) {
        context.addIssue({
          code: "custom",
          message: "Choose serial or browserTargetId",
          path: ["serial"],
        });
      }
      if (input.serial && input.browserTargetId) {
        context.addIssue({
          code: "custom",
          message: "Choose only one serial or browserTargetId",
          path: ["serial"],
        });
      }
      if (input.serial && input.targetKind === "browser") {
        context.addIssue({
          code: "custom",
          message: "A serial target must use targetKind device",
          path: ["targetKind"],
        });
      }
      if (input.browserTargetId && input.targetKind === "device") {
        context.addIssue({
          code: "custom",
          message: "A browserTargetId must use targetKind browser",
          path: ["targetKind"],
        });
      }
    }),
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
