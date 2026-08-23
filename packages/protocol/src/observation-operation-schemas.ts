import * as z from "zod/v4";
import { empty, identifier, natural, text, unknownRecord } from "./operation-schema-primitives.js";

const discoveryRef = z.object({ sessionId: identifier("Discovery session identifier") }).strict();
const corpusRef = z.object({ sessionId: identifier("Corpus session identifier") }).strict();
const profileScanFields = {
  serial: identifier("Connected device serial"),
  app: identifier("Application package or bundle identifier"),
  profileId: z.string().optional(),
  name: z.string().optional(),
  maxScrolls: z.number().int().positive().optional(),
  save: z.boolean().optional(),
  openApp: z.boolean().optional(),
  entryPath: z.array(unknownRecord).optional(),
};
const languageProfileScan = z
  .object({
    ...profileScanFields,
    languagePath: z.array(unknownRecord).optional(),
  })
  .strict();
const switcherProfileScan = z
  .object({
    ...profileScanFields,
    kind: z.enum(["language", "account", "environment", "theme", "workspace", "build", "custom"]),
    pickerPath: z.array(unknownRecord).optional(),
  })
  .strict();

/** Explore, corpus, locale-finding, and switcher-profile descriptors. */
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
  "corpus.list": empty,
  "corpus.create": z
    .object({
      id: identifier("Corpus session identifier").optional(),
      name: text("Corpus name"),
      targetId: identifier("Target identifier"),
      scope: unknownRecord,
      targetProfile: unknownRecord.optional(),
    })
    .strict(),
  "corpus.get": corpusRef,
  "corpus.coverage": corpusRef,
  "corpus.analysis": corpusRef,
  "corpus.export": corpusRef,
  "corpus.screen.get": z
    .object({
      sessionId: identifier("Corpus session identifier"),
      screenId: identifier("Corpus screen identifier"),
    })
    .strict(),
  "locale-finding.known.list": empty,
  "locale-finding.known.remove": z
    .object({ findingId: identifier("Known finding identifier") })
    .strict(),
  "language-profile.list": empty,
  "language-profile.scan": languageProfileScan,
  "language-profile.save": z.object({ profile: unknownRecord }).strict(),
  "switcher-profile.list": empty,
  "switcher-profile.scan": switcherProfileScan,
  "switcher-profile.save": z.object({ profile: unknownRecord }).strict(),
} as const satisfies Readonly<Record<string, z.ZodObject>>;
