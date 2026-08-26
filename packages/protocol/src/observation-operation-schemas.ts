import * as z from "zod/v4";
import { empty, identifier, natural, text, unknownRecord } from "./operation-schema-primitives.js";

const discoveryRef = z.object({ sessionId: identifier("Discovery session identifier") }).strict();
/** App Map exploration descriptors. */
export const observationOperationSchemas = {
  "discovery.list": empty,
  "discovery.create": z
    .object({
      id: identifier("Discovery session identifier").optional(),
      name: text("Discovery name"),
      targetId: identifier("Target identifier"),
      appMapId: identifier("App Map identifier").optional(),
      goal: z.string().optional(),
      scope: unknownRecord.optional(),
      targetProfile: unknownRecord.optional(),
      agent: unknownRecord.optional(),
    })
    .strict(),
  "discovery.get": discoveryRef,
  "discovery.suggestion": discoveryRef,
  "discovery.export": discoveryRef,
  "discovery.promote": z
    .object({
      sessionId: identifier("Discovery session identifier"),
      transitionIds: z.array(identifier("Observed transition identifier")).optional(),
      appMapId: identifier("App Map identifier").optional(),
      expectedRevision: natural("Current App Map revision").optional(),
    })
    .strict(),
} as const satisfies Readonly<Record<string, z.ZodObject>>;
