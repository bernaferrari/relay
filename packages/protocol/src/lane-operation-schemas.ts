import * as z from "zod/v4";
import { laneSaveInputSchema, laneSchema } from "./lane.js";
import { empty, identifier } from "./operation-schema-primitives.js";

const ok = z.object({ ok: z.literal(true) }).strict();

export const laneOperationInputSchemas = {
  "lane.list": empty,
  "lane.save": laneSaveInputSchema,
  "lane.remove": z.object({ laneId: identifier("Lane identifier") }).strict(),
} as const satisfies Readonly<Record<string, z.ZodType>>;

export const laneOperationOutputSchemas = {
  "lane.list": z.object({ lanes: z.array(laneSchema) }).strict(),
  "lane.save": z.object({ lane: laneSchema }).strict(),
  "lane.remove": ok,
} as const satisfies Readonly<Record<string, z.ZodType>>;
