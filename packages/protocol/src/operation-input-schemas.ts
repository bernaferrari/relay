import * as z from "zod/v4";
import {
  appMapTestCompileInputSchema,
  appMapTestRunInputSchema,
  graphTest,
  testSemanticEdits,
} from "./app-map-test-operation-schemas.js";
import { reviewedDocumentOriginOperationSchemas } from "./reviewed-document-origin-operation-schemas.js";
import { appMapAuthoringOperationSchemas } from "./app-map-authoring-operation-schemas.js";
import { executionOperationSchemas } from "./execution-operation-schemas.js";
import { observationOperationSchemas } from "./observation-operation-schemas.js";
import { workspaceOperationSchemas } from "./workspace-operation-schemas.js";
import { coreTargetOperationInputSchemas } from "./core-target-operation-input-schemas.js";
import { combineStartOperationInputSchemas } from "./combine-start-operation-input-schema.js";
import {
  authoringInteraction,
  authoringTarget,
  connectionDestination,
  destination,
  empty,
  identifier,
  natural,
  open,
  point,
  queryBoolean,
  sessionReference,
  stepTarget,
  tapPoint,
  targetReference,
  text,
  unknownRecord,
} from "./operation-schema-primitives.js";

export type RelayOperationInputSchema = z.ZodObject;
export type RelayToolInputSchema = z.ZodType<Record<string, unknown>>;

export const operationInputSchemas = {
  ...reviewedDocumentOriginOperationSchemas,
  ...workspaceOperationSchemas,
  ...appMapAuthoringOperationSchemas,
  ...observationOperationSchemas,
  ...executionOperationSchemas,
  ...coreTargetOperationInputSchemas,
  ...combineStartOperationInputSchemas,
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
  "system.doctor.get": empty,
  "target.list": empty,
  "target.devices.list": z.object({ phase: z.literal("android").optional() }).strict(),
  "target.boot": z.object(targetReference).strict(),
  "target.authorize": z.object(targetReference).strict(),
  "lease.list": z.object({ status: z.enum(["active", "all"]).optional() }).strict(),
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
      kind: z.enum([
        "label",
        "identifier",
        "point",
        "ref",
        "find",
        "text-match",
        "swipe",
        "type",
        "key",
        "replace",
      ]),
      preview: z.boolean().optional().describe("If true, resolve or annotate only — no commit tap"),
      identifier: z
        .string()
        .min(1)
        .optional()
        .describe("Required when kind is 'identifier': accessibility identifier to tap"),
      label: z
        .string()
        .min(1)
        .optional()
        .describe("Required when kind is 'label': accessibility label to tap"),
      text: z
        .string()
        .optional()
        .describe(
          "Required when kind is 'type' or 'replace': text to type (type) or replace the target's content with (replace)",
        ),
      x: z
        .number()
        .optional()
        .describe("Required when kind is 'point': x coordinate in captured viewport pixels"),
      y: z
        .number()
        .optional()
        .describe("Required when kind is 'point': y coordinate in captured viewport pixels"),
      from: tapPoint
        .optional()
        .describe("Required when kind is 'swipe': swipe start point { x, y }"),
      to: tapPoint.optional().describe("Required when kind is 'swipe': swipe end point { x, y }"),
      durationMs: z.number().int().positive().optional(),
      ref: z.string().min(1).optional(),
      query: z.string().min(1).optional(),
      match: z.string().min(1).optional(),
      key: z
        .enum(["enter", "backspace", "back", "home"])
        .optional()
        .describe("Required when kind is 'key': which system key to send"),
      target: z
        .object({
          identifier: z.string().min(1).optional(),
          ref: z.string().min(1).optional(),
          label: z.string().min(1).optional(),
          text: z.string().min(1).optional(),
          point: tapPoint.optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  "target.ground": z
    .object({
      ...targetReference,
      target: z
        .union([
          text("Accessibility label, identifier, or natural-language control name"),
          z
            .object({
              kind: z.enum([
                "label",
                "identifier",
                "point",
                "ref",
                "find",
                "text-match",
                "swipe",
                "type",
                "key",
                "replace",
              ]),
            })
            .catchall(z.unknown()),
        ])
        .describe("Text to resolve, or a full InteractInput to passthrough"),
      screenshot: z
        .object({
          base64: text("PNG/JPEG base64 screenshot for vision fallback"),
          mime: z.string().optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  "target.do": z
    .object({
      ...targetReference,
      target: z
        .union([
          text("Accessibility label, identifier, or natural-language control name"),
          z
            .object({
              kind: z.enum([
                "label",
                "identifier",
                "point",
                "ref",
                "find",
                "text-match",
                "swipe",
                "type",
                "key",
                "replace",
              ]),
            })
            .catchall(z.unknown()),
        ])
        .describe("Text to ground then tap, or a full InteractInput"),
    })
    .strict(),
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
      sourceSha256: z.string().optional(),
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
      poolId: identifier('Device-pool identifier. Use "local" for a connected device'),
      deviceSerial: identifier("Device serial"),
      expiresAt: natural("Lease expiration timestamp").optional(),
    })
    .strict(),
  "lease.takeover": z
    .object({
      leaseId: identifier("Exact active lease being handed off"),
      expiresAt: natural("New lease expiration timestamp").optional(),
      reason: text("Why control is being handed to this actor"),
      confirm: z.literal(true),
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
  "app-map.get": z
    .object({
      appMapId: identifier("App Map identifier"),
      list: z
        .enum(["variables", "tests", "combines"])
        .optional()
        .describe("Return only that catalog instead of the full map summary"),
    })
    .strict(),
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
      handoff: z
        .object({
          expectedApp: text("Exact foreground application package expected after the tap"),
          returnAction: z
            .enum(["back", "relaunch-source"])
            .describe("Reversible way to leave the handoff surface"),
        })
        .strict()
        .optional(),
      interaction: z
        .discriminatedUnion("kind", [
          z.object({ kind: z.literal("point"), x: z.coerce.number(), y: z.coerce.number() }).strict(),
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
          z
            .object({
              kind: z.literal("swipe"),
              from: point,
              to: point,
              durationMs: z.number().int().positive().optional(),
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
      throughConnectionId: identifier("Last Connection to replay").optional(),
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
  "app-map.routine.impact": z
    .object({
      appMapId: identifier("App Map identifier"),
      routineId: identifier("Routine identifier"),
    })
    .strict(),
  "app-map.diff.impact": z
    .object({
      appMapId: identifier("App Map identifier"),
      changedFiles: z
        .array(z.string().min(1))
        .describe("Repository paths changed by the diff under review"),
      sourcePaths: z
        .record(z.string(), z.array(z.string()))
        .describe(
          "Optional App Map entity id to repository source paths front-matter",
        )
        .optional(),
    })
    .strict(),
  "app-map.test.save": z
    .object({
      appMapId: identifier("App Map identifier"),
      testId: identifier("Stable Test identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      test: graphTest,
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
  "app-map.test.run": appMapTestRunInputSchema,
  "app-map.test.compile": appMapTestCompileInputSchema,
  "app-map.test.from-intent": z
    .object({
      appMapId: identifier("App Map identifier"),
      intent: text("English coverage goal compiled onto ready App Map edges"),
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
      serial: identifier("Optional device serial for one-shot Keep replay").optional(),
      prove: z.boolean().optional(),
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
  "app-map.proposal.revert": z
    .object({
      appMapId: identifier("App Map identifier"),
      proposalId: identifier("Approved repair proposal identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
      reason: text("Why the reviewed repair is being reverted").optional(),
    })
    .strict(),
  "run.repair.list": z.object({ limit: z.number().int().min(1).max(500).optional() }).strict(),
  "run.replay.offline": z.object({ runId: identifier("Persisted run identifier") }).strict(),
  "run.repair.get": z
    .object({ runId: identifier("Source run identifier"), checkId: identifier("Failed check id") })
    .strict(),
  "run.repair.retry": z
    .object({ runId: identifier("Source run identifier"), checkId: identifier("Failed check id") })
    .strict(),
  "run.repair.propose": z
    .object({
      runId: identifier("Source run identifier"),
      checkId: identifier("Failed check id"),
      kind: z.enum(["retarget", "accept-current", "disable"]),
      reason: text("Required audit reason for this review branch"),
      selector: stepTarget
        .describe("Exact successful runtime selector; required only for retarget")
        .optional(),
      equivalentTargets: z
        .array(
          z
            .object({
              runId: identifier("Equivalent source run identifier"),
              checkId: identifier("Equivalent failed check id"),
            })
            .strict(),
        )
        .max(100)
        .optional(),
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
  "discovery.start": z.object({ sessionId: identifier("Discovery session identifier") }).strict(),
  "discovery.cancel": z.object({ sessionId: identifier("Discovery session identifier") }).strict(),
  "discovery.here": z.object({ sessionId: identifier("Discovery session identifier") }).strict(),
  "discovery.coverage": z
    .object({ sessionId: identifier("Discovery session identifier") })
    .strict(),
  "discovery.exploration-timeline": z
    .object({ sessionId: identifier("Discovery session identifier") })
    .strict(),
  "discovery.do": z
    .object({
      sessionId: identifier("Discovery session identifier"),
      controlId: identifier("Discovery control identifier").optional(),
      kind: z.string().optional(),
    })
    .catchall(z.unknown()),
  "discovery.interact": z
    .object({ sessionId: identifier("Discovery session identifier"), kind: z.string() })
    .catchall(z.unknown()),
  "job.list": z
    .object({ full: queryBoolean.optional(), limit: z.coerce.number().int().positive().optional() })
    .strict(),
  "job.get": z.object({ jobId: identifier("Job identifier") }).strict(),
  "job.combine.campaign.get": z
    .object({ batchId: identifier("Combine campaign identifier") })
    .strict(),
  "job.combine.campaign.resume": z
    .object({
      batchId: identifier("Combine campaign identifier"),
      reviewed: z.boolean().optional(),
    })
    .strict(),
  "job.combine.campaign.cancel": z
    .object({ batchId: identifier("Combine campaign identifier") })
    .strict(),
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
} as const satisfies Readonly<Record<string, RelayOperationInputSchema>>;

export type OperationSchemaId = keyof typeof operationInputSchemas;
export type OperationSchemaInput<Id extends OperationSchemaId> = z.output<
  (typeof operationInputSchemas)[Id]
>;

export function operationInputSchema(operationId: string): RelayOperationInputSchema {
  const schema = operationInputSchemas[operationId as OperationSchemaId];
  if (!schema) throw new Error(`Missing input schema for registered operation ${operationId}`);
  return schema;
}
