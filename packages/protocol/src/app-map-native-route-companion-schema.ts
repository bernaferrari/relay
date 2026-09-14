import * as z from "zod/v4";
import { identifier } from "./operation-schema-primitives.js";

const nativeRouteCompanion = z
  .object({
    platform: z.enum(["android", "ios"]),
    appMapId: identifier("Companion App Map identifier"),
    testId: identifier("Companion Test identifier"),
  })
  .strict();

export const nativeRouteCompanions = z
  .array(nativeRouteCompanion)
  .min(1)
  .max(2)
  .superRefine((items, context) => {
    const platforms = items.map((item) => item.platform);
    if (new Set(platforms).size !== platforms.length) {
      context.addIssue({
        code: "custom",
        message: "nativeRouteCompanions platforms must be unique",
        path: ["nativeRouteCompanions"],
      });
    }
  });
