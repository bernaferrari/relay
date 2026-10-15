import * as z from "zod/v4";
export const browserPageToolShapes = [
  z.object({
    kind: z.literal("browser.find"),
    query: z.string().max(512),
    direction: z.enum(["first", "next", "previous"]).default("first"),
  }),
  z.object({
    kind: z.literal("browser.zoom"),
    factor: z.number().finite().min(0.25).max(3).optional(),
  }),
  z.object({ kind: z.literal("browser.history") }),
] as const;
export const browserPageToolSchema = z.discriminatedUnion("kind", browserPageToolShapes);
export type BrowserPageTool = z.input<typeof browserPageToolSchema>;
export const browserPageToolResultSchema = z
  .object({
    zoom: z.number().optional(),
    find: z
      .object({
        query: z.string(),
        current: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        truncated: z.boolean(),
      })
      .optional(),
    history: z
      .array(z.object({ url: z.string().max(4096), title: z.string().max(512) }))
      .max(100)
      .optional(),
  })
  .strict();
export type BrowserPageToolResult = z.infer<typeof browserPageToolResultSchema>;
