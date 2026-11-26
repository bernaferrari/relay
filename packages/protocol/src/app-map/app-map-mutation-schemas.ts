import * as z from "zod/v4";
import {
  addScreenInputSchema,
  appMapNoteSchema,
  appMapTestSchema,
  connectionPatchSchema,
  connectionSchema,
  mapGroupSchema,
  updateScreenInputSchema,
  appMapCombineSchema,
} from "./app-map-document-schema.js";
import { appMapVariableSchema } from "./app-map-variable-schema.js";
import { flowSchema } from "./app-map-test-family-schema.js";

const changeId = z.string().min(1);

export const appMapPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    notes: z.record(z.string(), appMapNoteSchema).optional(),
  })
  .strict();

export const appMapBatchChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("note.save"), note: appMapNoteSchema }).strict(),
  z.object({ kind: z.literal("note.remove"), noteId: changeId }).strict(),
  z.object({ kind: z.literal("screen.add"), input: addScreenInputSchema }).strict(),
  z
    .object({
      kind: z.literal("screen.update"),
      screenId: changeId,
      input: updateScreenInputSchema,
    })
    .strict(),
  z.object({ kind: z.literal("screen.remove"), screenId: changeId }).strict(),
  z.object({ kind: z.literal("connection.create"), connection: connectionSchema }).strict(),
  z
    .object({
      kind: z.literal("connection.update"),
      connectionId: changeId,
      patch: connectionPatchSchema,
    })
    .strict(),
  z.object({ kind: z.literal("connection.remove"), connectionId: changeId }).strict(),
  z.object({ kind: z.literal("group.save"), group: mapGroupSchema }).strict(),
  z.object({ kind: z.literal("group.remove"), groupId: changeId }).strict(),
  z.object({ kind: z.literal("flow.save"), flow: flowSchema }).strict(),
  z.object({ kind: z.literal("flow.remove"), flowId: changeId }).strict(),
  z.object({ kind: z.literal("test.save"), test: appMapTestSchema }).strict(),
  z.object({ kind: z.literal("variable.save"), variable: appMapVariableSchema }).strict(),
  z.object({ kind: z.literal("combine.save"), combine: appMapCombineSchema }).strict(),
  z.object({ kind: z.literal("combine.remove"), combineId: changeId }).strict(),
]);
