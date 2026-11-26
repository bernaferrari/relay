import * as z from "zod/v4";
import { combineProfileTargetInputSchema } from "../combine/combine-profile-target-schema.js";
import {
  authoringTarget,
  finiteInputPoint,
  empty,
  explicitQueryBoolean,
  identifier,
  natural,
  queryBoolean,
  sessionReference,
  unknownRecord,
} from "../operation/operation-schema-primitives.js";
import { authoringDebugOriginInputSchema } from "../authoring/authoring-capture.js";
import { logicalScrollSurfaceImportInputSchema } from "../recipe/recipe-scroll-surface-schema.js";
import { appMapBatchChangeSchema, appMapPatchSchema } from "./app-map-mutation-schemas.js";
import { appMapCombineSchema, mapGroupSchema } from "./app-map-document-schema.js";
import { appMapVariableSchema } from "./app-map-variable-schema.js";

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

const nativeAuthoringTarget = z
  .object({
    kind: z.literal("device"),
    platform: z.enum(["android", "ios"]),
    targetId: identifier("Target identifier"),
  })
  .strict();

/** App Map and Take schemas omitted from the original MCP-only table. */
export const appMapAuthoringOperationSchemas = {
  "app-map.list": empty,
  "app-map.commit": z
    .object({
      appMapId: identifier("App Map identifier"),
      ...mutationIdentity,
      summary: z.string().min(1).optional(),
      changes: z.array(appMapBatchChangeSchema),
      patch: appMapPatchSchema.optional(),
    })
    .strict(),
  "app-map.screen.capture": z
    .object({
      appMapId: identifier("App Map identifier"),
      ...mutationIdentity,
      target: authoringTarget,
      originApplication: z.string().trim().min(1).optional(),
      leaseId: identifier("Exclusive control lease"),
      title: z.string().min(1).optional(),
      position: finiteInputPoint.optional(),
      authenticationFixtureReference: z.string().trim().min(1).optional(),
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
      target: nativeAuthoringTarget,
      leaseId: identifier("Exclusive control lease"),
      maxScrolls: z.number().int().min(1).max(12).optional(),
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
      targetTitle: z.string().min(1).optional(),
      mode: z
        .enum(["scroll-surface", "same-screen"])
        .optional()
        .describe(
          "same-screen approves equivalent captures such as keyboard open/closed, keeping actions and aliases. Default scroll-surface requires ordered viewport evidence.",
        ),
      surfaceImport: logicalScrollSurfaceImportInputSchema.optional(),
    })
    .strict()
    .refine(({ mode, surfaceImport }) => mode !== "same-screen" || surfaceImport === undefined, {
      path: ["surfaceImport"],
      message: "Scroll evidence cannot be used for same-screen merging",
    }),
  "app-map.connection.run": z
    .object({
      appMapId: identifier("App Map identifier"),
      connectionId: identifier("Saved connection identifier"),
      ...runtimeTarget,
      variables: z
        .record(z.string(), z.union([z.string().min(1), z.array(z.string().min(1))]))
        .optional(),
    })
    .strict(),
  "app-map.group.save": z
    .object({
      appMapId: identifier("App Map identifier"),
      groupId: identifier("Map group identifier"),
      ...mutationIdentity,
      group: mapGroupSchema,
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
      variable: appMapVariableSchema
        .omit({
          id: true,
          organizationId: true,
          projectId: true,
          appMapId: true,
          createdAt: true,
          updatedAt: true,
        })
        .extend({
          id: z.string().min(1).optional(),
          organizationId: z.string().min(1).optional(),
          projectId: z.string().min(1).optional(),
          appMapId: z.string().min(1).optional(),
          createdAt: z.number().optional(),
          updatedAt: z.number().optional(),
        }),
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
      serial: identifier("Connected device serial").optional(),
      platform: z.enum(["android", "ios"]).optional(),
      targetKind: z.enum(["device", "browser"]).optional(),
      browserTargetId: identifier("Managed browser target identifier").optional(),
      targetProfileId: identifier("Saved runtime profile identifier").optional(),
      selectedCellIds: z.array(identifier("Combine cell identifier")).optional(),
      selected: z
        .record(identifier("Variable identifier"), z.array(identifier("Variable value identifier")))
        .optional(),
      strategy: z.enum(["zip", "cartesian", "pairwise"]).optional(),
      profileTargets: z.array(combineProfileTargetInputSchema).max(64).optional(),
    })
    .strict(),
  "app-map.combine.save": z
    .object({
      appMapId: identifier("App Map identifier"),
      combineId: identifier("Combine identifier"),
      ...mutationIdentity,
      combine: appMapCombineSchema.omit({
        id: true,
        organizationId: true,
        projectId: true,
        appMapId: true,
        createdAt: true,
        updatedAt: true,
      }),
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
      appMapId: identifier("App Map identifier").optional(),
      targetId: identifier("Target identifier").optional(),
      activeOnly: explicitQueryBoolean.optional(),
      includeHistory: queryBoolean.optional(),
      latestRevisionOnly: explicitQueryBoolean.optional(),
    })
    .strict(),
  "authoring.session.begin": z
    .object({
      appMapId: identifier("App Map identifier"),
      testName: z.string().trim().min(1).optional(),
      target: authoringTarget,
      originApplication: z
        .string()
        .trim()
        .min(1)
        .describe("Explicit native application package or bundle identifier")
        .optional(),
      leaseId: identifier("Actor-owned target lease identifier"),
      expectedAppMapRevision: natural("Current App Map revision"),
      sourceScreenId: z.string().min(1).optional(),
      pendingConnectionId: z.string().min(1).optional(),
      workflowRequestId: identifier("Durable authoring request identifier").optional(),
      debugOrigin: authoringDebugOriginInputSchema.optional(),
      group: z.string().min(1).optional(),
    })
    .strict(),
  "authoring.session.capture": z.object(sessionReference).strict(),
  "authoring.take.optimization.get": z.object(sessionReference).strict(),
} as const satisfies Readonly<Record<string, z.ZodObject>>;
