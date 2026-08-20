import { operationDefinition, type OperationId } from "@relay/protocol";
import * as z from "zod/v4";
import { graphTest, testCapturePolicy, testSemanticEdits } from "./test-input-schemas.js";
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
  sessionReference,
  stepTarget,
  tapPoint,
  targetReference,
  text,
  unknownRecord,
} from "./input-schema-primitives.js";

export type RelayOperationInputSchema = z.ZodObject;
export type RelayToolInputSchema = z.ZodType<Record<string, unknown>>;

const schemas: Partial<Record<OperationId, RelayOperationInputSchema>> = {
  "system.audit.list": z.object({ limit: z.number().int().positive().optional() }).strict(),
  "locale-finding.known.add": z
    .object({
      finding: z
        .object({
          id: z.string().min(1),
          code: z.enum([
            "SCREEN_MISSING",
            "POSSIBLE_LOCALE_NOT_APPLIED",
            "CONTROL_MISSING",
            "POSSIBLE_UNTRANSLATED_TEXT",
            "POSSIBLE_TEXT_CLIPPED",
          ]),
          canonicalKey: z.string().min(1),
          screenLabel: z.string().min(1),
          locale: z.string().min(1),
          detail: z.string().min(1),
          stableKey: z.string().min(1).optional(),
        })
        .passthrough(),
      scope: z
        .enum(["locale", "control"])
        .optional()
        .describe("Locale only by default; control applies across locales when safely supported"),
      note: z.string().min(1).optional().describe("Required for control-wide acceptance"),
    })
    .strict()
    .superRefine((input, context) => {
      if (input.scope !== "control") return;
      if (input.finding.code !== "POSSIBLE_UNTRANSLATED_TEXT" || !input.finding.stableKey) {
        context.addIssue({
          code: "custom",
          message: "control scope requires a stable untranslated-text finding",
          path: ["scope"],
        });
      }
      if (!input.note?.trim()) {
        context.addIssue({
          code: "custom",
          message: "control scope requires a reason",
          path: ["note"],
        });
      }
    }),
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
  "target.snapshot.capture": z.object(targetReference).strict(),
  "target.screenshot.capture": z.object(targetReference).strict(),
  "target.recover": z
    .object({
      ...targetReference,
      reason: z.enum(["connect", "observe", "control", "record", "auto"]).optional(),
    })
    .strict(),
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
      identifier: z.string().min(1).optional(),
      label: z.string().min(1).optional(),
      text: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      from: tapPoint.optional(),
      to: tapPoint.optional(),
      durationMs: z.number().int().positive().optional(),
      ref: z.string().min(1).optional(),
      query: z.string().min(1).optional(),
      match: z.string().min(1).optional(),
      key: z.enum(["enter", "backspace", "back", "home"]).optional(),
      point: tapPoint.optional(),
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
  "app-map.test.run": z
    .object({
      appMapId: identifier("App Map identifier"),
      testId: identifier("Graph-native Test identifier"),
      expectedRevision: natural("Exact saved App Map revision to run"),
      target: authoringTarget.describe("Explicit device or managed browser target"),
      startup: z
        .discriminatedUnion("mode", [
          z.object({ mode: z.literal("cold") }).strict(),
          z
            .object({
              mode: z.literal("verified-checkpoint"),
              screenId: identifier("Mapped screen identifier to prove before the suffix runs"),
            })
            .strict(),
        ])
        .optional()
        .describe(
          "Explicit startup policy. A checkpoint mismatch stops for review; it never falls back to a cold relaunch.",
        ),
    })
    .strict(),
  "app-map.test.compile": z
    .object({
      appMapId: identifier("App Map identifier"),
      testId: identifier("Graph-native Test identifier"),
      entryCheckpointScreenId: identifier(
        "Optional mapped screen identifier to compile as a verified live checkpoint",
      ).optional(),
    })
    .strict(),
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
  "discovery.journey": z.object({ sessionId: identifier("Discovery session identifier") }).strict(),
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
      combineId: identifier("Saved Combine identifier").optional(),
      variableIds: z.array(identifier("Variable identifier")).optional(),
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
      executionMode: z.enum(["pilot", "all"]).optional(),
      pilotCaseIndex: z.number().int().nonnegative().optional(),
    })
    .strict()
    .superRefine((input, context) => {
      if (!input.testId && !input.combineId) {
        context.addIssue({
          code: "custom",
          message: "Choose exactly one testId or combineId",
          path: ["testId"],
        });
      }
      if ([input.testId, input.combineId].filter(Boolean).length > 1) {
        context.addIssue({
          code: "custom",
          message: "Choose only one testId or combineId",
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
