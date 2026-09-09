import * as z from "zod/v4";
import {
  authoringTarget,
  empty,
  identifier,
  natural,
  point,
  queryBoolean,
  sessionReference,
  unknownRecord,
} from "./operation-schema-primitives.js";

const mutationIdentity = {
  expectedRevision: natural("Current App Map revision"),
  eventId: identifier("Optional idempotent activity event identifier").optional(),
};
const runtimeTarget = {
  serial: identifier("Connected device serial").optional(),
  platform: z.enum(["android", "ios"]).optional(),
  targetKind: z.enum(["device", "browser"]).optional(),
  browserTargetId: identifier("Managed browser target identifier").optional(),
};

/** App Map and Take schemas omitted from the original MCP-only table. */
export const appMapAuthoringOperationSchemas = {
  "app-map.list": empty,
  "app-map.commit": z
    .object({
      appMapId: identifier("App Map identifier"),
      ...mutationIdentity,
      summary: z.string().optional(),
      changes: z.array(unknownRecord),
      patch: unknownRecord.optional(),
    })
    .strict(),
  "app-map.screen.capture": z
    .object({
      appMapId: identifier("App Map identifier"),
      ...mutationIdentity,
      target: authoringTarget,
      originApplication: z.string().trim().min(1).optional(),
      leaseId: identifier("Exclusive control lease"),
      title: z.string().optional(),
      position: point.optional(),
    })
    .strict(),
  "app-map.screen.refresh.prepare": z
    .object({
      appMapId: identifier("App Map identifier"),
      screenId: identifier("Screen identifier"),
      expectedRevision: natural("Current App Map revision"),
      target: authoringTarget,
      leaseId: identifier("Exclusive control lease"),
    })
    .strict(),
  "app-map.screen.refresh.apply": z
    .object({
      appMapId: identifier("App Map identifier"),
      screenId: identifier("Screen identifier"),
      expectedRevision: natural("Current App Map revision"),
      token: identifier("Prepared capture token"),
    })
    .strict(),
  "app-map.screen.alias-observe": z
    .object({
      appMapId: identifier("App Map identifier"),
      screenId: identifier("Mapped screen the observed target screen is"),
      ...mutationIdentity,
      target: authoringTarget,
      leaseId: identifier("Exclusive control lease"),
    })
    .strict(),
  "app-map.scroll-surface.capture": z
    .object({
      appMapId: identifier("App Map identifier"),
      screenId: identifier("Logical screen identifier"),
      variantId: identifier("Screen variant identifier"),
      ...mutationIdentity,
      target: authoringTarget,
      leaseId: identifier("Exclusive control lease"),
      maxScrolls: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  "app-map.scroll-surface.regenerate": z
    .object({
      appMapId: identifier("App Map identifier"),
      screenId: identifier("Logical screen identifier"),
      variantId: identifier("Screen variant identifier"),
      captureId: identifier("Scroll capture identifier"),
      ...mutationIdentity,
    })
    .strict(),
  "app-map.screen.consolidate": z
    .object({
      appMapId: identifier("App Map identifier"),
      targetScreenId: identifier("Surviving screen identifier"),
      sourceScreenIds: z.array(identifier("Source screen identifier")).min(1),
      ...mutationIdentity,
      dryRun: z.boolean().optional(),
      targetTitle: z.string().optional(),
      surfaceImport: unknownRecord.optional(),
    })
    .strict(),
  "app-map.connection.run": z
    .object({
      appMapId: identifier("App Map identifier"),
      connectionId: identifier("Saved connection identifier"),
      ...runtimeTarget,
      variables: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    })
    .strict(),
  "app-map.group.save": z
    .object({
      appMapId: identifier("App Map identifier"),
      groupId: identifier("Map group identifier"),
      ...mutationIdentity,
      group: unknownRecord,
    })
    .strict(),
  "app-map.group.remove": z
    .object({
      appMapId: identifier("App Map identifier"),
      groupId: identifier("Map group identifier"),
      ...mutationIdentity,
    })
    .strict(),
  "app-map.variable.save": z
    .object({
      appMapId: identifier("App Map identifier"),
      variableId: identifier("Variable identifier"),
      ...mutationIdentity,
      variable: unknownRecord,
    })
    .strict(),
  "app-map.variable.infer": z
    .object({
      appMapId: identifier("App Map identifier"),
      variableId: identifier("Variable identifier"),
      expectedRevision: z.number().int().nonnegative(),
      target: z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("device"),
            platform: z.enum(["android", "ios"]),
            targetId: identifier("Target identifier"),
          })
          .strict(),
        z
          .object({
            kind: z.literal("browser"),
            platform: z.literal("browser"),
            targetId: identifier("Target identifier"),
          })
          .strict(),
      ]),
      leaseId: identifier("Actor-owned target lease identifier"),
      taughtRows: z
        .array(
          z
            .object({
              id: identifier("Variable option identifier"),
              identifier: z.string().min(1).optional(),
              label: z.string().min(1).optional(),
              text: z.string().min(1).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(8),
      name: z.string().min(1).optional(),
      kind: z
        .enum([
          "language",
          "location",
          "account",
          "theme",
          "workspace",
          "build",
          "toggle",
          "custom",
        ])
        .optional(),
      apply: unknownRecord.optional(),
    })
    .strict(),
  "app-map.variable.remove": z
    .object({
      appMapId: identifier("App Map identifier"),
      variableId: identifier("Variable identifier"),
      ...mutationIdentity,
    })
    .strict(),
  "app-map.test.remove": z
    .object({
      appMapId: identifier("App Map identifier"),
      testId: identifier("Test identifier"),
      ...mutationIdentity,
    })
    .strict(),
  "app-map.combine.preflight": z
    .object({
      appMapId: identifier("App Map identifier"),
      combineId: identifier("Combine identifier"),
      serial: z.string().optional(),
      platform: z.enum(["android", "ios"]).optional(),
      targetKind: z.enum(["device", "browser"]).optional(),
      browserTargetId: z.string().optional(),
      selectedCellIds: z.array(identifier("Combine cell identifier")).optional(),
    })
    .strict(),
  "app-map.combine.save": z
    .object({
      appMapId: identifier("App Map identifier"),
      combineId: identifier("Combine identifier"),
      ...mutationIdentity,
      combine: unknownRecord,
    })
    .strict(),
  "app-map.combine.remove": z
    .object({
      appMapId: identifier("App Map identifier"),
      combineId: identifier("Combine identifier"),
      ...mutationIdentity,
    })
    .strict(),
  "authoring.session.list": z
    .object({
      appMapId: z.string().optional(),
      targetId: z.string().optional(),
      activeOnly: queryBoolean.optional(),
      includeHistory: queryBoolean.optional(),
    })
    .strict(),
  "authoring.session.begin": z
    .object({
      appMapId: identifier("App Map identifier"),
      testName: z.string().trim().min(1).optional(),
      target: authoringTarget,
      leaseId: identifier("Actor-owned target lease identifier"),
      expectedAppMapRevision: natural("Current App Map revision"),
      sourceScreenId: z.string().optional(),
      pendingConnectionId: z.string().optional(),
      group: z.string().optional(),
    })
    .strict(),
  "authoring.session.capture": z.object(sessionReference).strict(),
  "authoring.take.optimization.get": z.object(sessionReference).strict(),
} as const satisfies Readonly<Record<string, z.ZodObject>>;
