import * as z from "zod/v4";
import { browserAuthenticationFixtureOperationInputSchemas } from "./browser-authentication-fixture.js";
import {
  appMapTestCompileInputSchema,
  appMapTestRunInputSchema,
  graphTest,
  repeatWorkflowMutationSchema,
  testSemanticEdits,
} from "./app-map-test-operation-schemas.js";
import { reviewedDocumentOriginOperationSchemas } from "./reviewed-document-origin-operation-schemas.js";
import { appMapAuthoringOperationSchemas } from "./app-map-authoring-operation-schemas.js";
import { executionOperationSchemas } from "./execution-operation-schemas.js";
import { observationOperationSchemas } from "./observation-operation-schemas.js";
import { workspaceOperationSchemas } from "./workspace-operation-schemas.js";
import { coreTargetOperationInputSchemas } from "./core-target-operation-input-schemas.js";
import { combineStartOperationInputSchemas } from "./combine-start-operation-input-schema.js";
import { workflowRecordOperationInputSchemas } from "./workflow-record-operation-schemas.js";
import { changeVerificationOperationInputSchemas } from "./change-verification-operation-schemas.js";
import { proofSetupOperationInputSchemas } from "./proof-setup.js";
import { repeatFailureKindSchema } from "./repeat-failure.js";
import { targetOperationInputSchemas } from "./target-operation-input-schemas.js";
import { stateFixtureSchema } from "./exploration-policy.js";
import {
  authoringInteraction,
  authoringRecordingEdit,
  authoringTarget,
  connectionDestination,
  destination,
  identifier,
  natural,
  point,
  queryBoolean,
  sessionReference,
  stepTarget,
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
  ...workflowRecordOperationInputSchemas,
  ...changeVerificationOperationInputSchemas,
  ...proofSetupOperationInputSchemas,
  ...browserAuthenticationFixtureOperationInputSchemas,
  ...targetOperationInputSchemas,
  "project.save": z
    .object({ id: identifier("Project identifier"), name: text("Project name") })
    .strict(),
  "build.save": z
    .object({
      id: identifier("Build identifier"),
      name: text("Build name"),
      platform: z.enum(["android", "ios", "web"]),
      sourceUrl: z.string().optional(),
      sourceSha256: z.string().optional(),
      sourceSha: z.string().optional(),
      configuration: z.string().optional(),
      environmentRevision: z.string().optional(),
      applicationId: z.string().optional(),
      deploymentDigest: z
        .string()
        .regex(/^sha256:[a-f0-9]{64}$/u)
        .optional(),
      webDeploymentMode: z.enum(["provider-verified", "self-managed"]).optional(),
      webProviderReceipt: z
        .object({
          schemaVersion: z.literal(1),
          issuer: z.literal("relay-web-deployment-provider"),
          provider: identifier("Web deployment provider"),
          deploymentId: identifier("Web deployment identifier"),
          sourceUrl: z.string().trim().min(1).max(2_048),
          sourceSha: z.string().regex(/^[a-f0-9]{40}$/u),
          deploymentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
          configuration: identifier("Web deployment configuration"),
          environmentRevision: identifier("Web deployment environment revision"),
          issuedAt: z.number().int().nonnegative(),
          signature: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
        })
        .strict()
        .optional(),
      status: z.string().optional(),
    })
    .strict()
    .superRefine((input, context) => {
      if (input.platform !== "web") {
        if (input.deploymentDigest !== undefined) {
          context.addIssue({
            code: "custom",
            path: ["deploymentDigest"],
            message: "is only valid for web deployments",
          });
        }
        if (input.webDeploymentMode !== undefined || input.webProviderReceipt !== undefined) {
          context.addIssue({
            code: "custom",
            path: [
              input.webDeploymentMode !== undefined ? "webDeploymentMode" : "webProviderReceipt",
            ],
            message: "is only valid for web deployments",
          });
        }
        return;
      }
      if (input.webDeploymentMode === "self-managed") {
        if (!input.sourceUrl) {
          context.addIssue({
            code: "custom",
            path: ["sourceUrl"],
            message: "is required for self-managed web development",
          });
        }
        if (input.webProviderReceipt !== undefined) {
          context.addIssue({
            code: "custom",
            path: ["webProviderReceipt"],
            message: "is not valid for self-managed web development",
          });
        }
        return;
      }
      if (!input.webProviderReceipt) {
        context.addIssue({
          code: "custom",
          path: ["webProviderReceipt"],
          message: "a signed provider receipt is required for provider-verified web builds",
        });
      } else if (!input.sourceUrl) {
        // The receipt is authoritative for the deployment URL, so clients do
        // not need to repeat a mutable copy in the ordinary build input.
        return;
      }
    }),
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
          z
            .object({ kind: z.literal("point"), x: z.coerce.number(), y: z.coerce.number() })
            .strict(),
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
        .describe("Optional App Map entity id to repository source paths front-matter")
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
  "app-map.test.undo": z
    .object({
      appMapId: identifier("App Map identifier"),
      testId: identifier("Graph-native Test identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
    })
    .strict(),
  "app-map.test.redo": z
    .object({
      appMapId: identifier("App Map identifier"),
      testId: identifier("Graph-native Test identifier"),
      expectedRevision: natural("Current App Map revision"),
      eventId: identifier("Optional idempotent activity event identifier").optional(),
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
  "run.trace-pack.get": z.object({ runId: identifier("Persisted run identifier") }).strict(),
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
      testName: z.string().trim().min(1).optional(),
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
  "authoring.take.edit": z.object({ ...sessionReference, edit: authoringRecordingEdit }).strict(),
  "authoring.take.replay": z.object(sessionReference).strict(),
  "authoring.session.commit": z
    .object({
      ...sessionReference,
      destination: destination.optional(),
      testName: z.string().trim().min(1).max(160).optional(),
      createTest: z.literal(true).optional(),
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
  "discovery.start": z
    .object({
      sessionId: identifier("Discovery session identifier"),
      strategy: z.enum(["surface", "timeline", "hard-edges"]).optional(),
      maxDepth: z.number().int().min(1).max(12).optional(),
      fixture: stateFixtureSchema.optional(),
    })
    .strict(),
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
  "job.combine.campaign.repeat.active": z
    .object({
      appMapId: identifier("App Map identifier"),
      testId: identifier("Test identifier"),
    })
    .strict(),
  "job.combine.campaign.repeat.clusters": z
    .object({
      batchId: identifier("Combine campaign identifier"),
      failureKind: repeatFailureKindSchema.optional(),
      cohort: identifier("Repeat target cohort").optional(),
    })
    .strict(),
  "job.combine.campaign.resume": z
    .object({
      batchId: identifier("Combine campaign identifier"),
      reviewed: z.boolean().optional(),
      expectedAppMapRevision: z.number().int().nonnegative().optional(),
      cellIds: z.array(identifier("Repeat rerun cell identifier")).max(1_000).optional(),
      clusterIds: z.array(identifier("Repeat failure cluster identifier")).max(1_000).optional(),
      workflowMutation: repeatWorkflowMutationSchema.optional(),
    })
    .strict(),
  "job.combine.campaign.cancel": z
    .object({
      batchId: identifier("Combine campaign identifier"),
      workflowMutation: repeatWorkflowMutationSchema.optional(),
    })
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
