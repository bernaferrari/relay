import * as z from "zod/v4";

const finiteTimestamp = z.number().finite().nonnegative();
const boundedText = z.string().trim().min(1).max(512);
const portableArtifactPath = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !/^[A-Za-z]:[\\/]/u.test(value) &&
      !value.split(/[\\/]/u).some((segment) => !segment || segment === "." || segment === ".."),
    "raw network artifact must be a portable relative path",
  )
  .refine(
    (value) => /\.pcap(?:ng)?$/iu.test(value),
    "raw network artifact must use a PCAP or PCAPNG path",
  );

export const androidNetworkEvidenceCoverageSchema = z.enum([
  "packet-complete",
  "partial",
  "opportunistic",
  "unsupported",
  "interrupted",
]);

export const androidNetworkEvidenceSourceSchema = z
  .object({
    kind: z.enum(["emulator-packet", "app-session-log"]),
    backend: z.enum([
      "android-emulator-tcpdump",
      "android-emulator-console",
      "android-emulator-netsim",
      "agent-device-session-log",
    ]),
  })
  .strict();

const androidPacketCaptureSourceSchema = z
  .object({
    kind: z.literal("emulator-packet"),
    backend: z.enum([
      "android-emulator-tcpdump",
      "android-emulator-console",
      "android-emulator-netsim",
    ]),
  })
  .strict();

/** Typed provenance for the managed-emulator packet collector attempt. A
 * failed attempt remains distinct from any opportunistic app-session log that
 * happened to succeed during the same Run. */
export const androidPacketCaptureProvenanceSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        schemaVersion: z.literal(1),
        status: z.literal("captured"),
        source: androidPacketCaptureSourceSchema,
        scope: z.literal("entire-emulator"),
        startedAt: finiteTimestamp,
        finishedAt: finiteTimestamp,
        coverage: androidNetworkEvidenceCoverageSchema,
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal(1),
        status: z.literal("failed"),
        source: androidPacketCaptureSourceSchema,
        scope: z.literal("entire-emulator"),
        startedAt: finiteTimestamp,
        finishedAt: finiteTimestamp,
        stage: z.enum(["start", "finalize"]),
        message: boundedText,
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (value.finishedAt < value.startedAt) {
      context.addIssue({ code: "custom", message: "finishedAt cannot precede startedAt" });
    }
  });

const androidNetworkFlowSchema = z
  .object({
    protocol: z.enum(["dns", "tcp", "udp", "tls", "quic", "other"]),
    host: boundedText.optional(),
    remoteAddress: boundedText.optional(),
    port: z.number().int().min(1).max(65_535).optional(),
    startedAtMs: finiteTimestamp,
    durationMs: finiteTimestamp.optional(),
    sentBytes: z.number().int().nonnegative(),
    receivedBytes: z.number().int().nonnegative(),
    outcome: z.enum([
      "observed",
      "connected",
      "refused",
      "reset",
      "timed-out",
      "dns-nxdomain",
      "incomplete",
    ]),
  })
  .strict();

const androidNetworkAttributionSchema = z
  .object({
    package: boundedText.optional(),
    uid: z.number().int().nonnegative().optional(),
    rxBytesDelta: z.number().int().nonnegative().optional(),
    txBytesDelta: z.number().int().nonnegative().optional(),
    confidence: z.enum(["high", "mixed", "ambiguous", "unavailable"]),
    reason: boundedText,
  })
  .strict();

const androidRawNetworkCaptureSchema = z
  .object({
    status: z.enum(["not-requested", "denied", "captured", "truncated", "failed"]),
    artifact: z
      .object({
        path: portableArtifactPath,
        bytes: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    bytes: z.number().int().nonnegative().optional(),
    reason: boundedText.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.status === "captured" || value.status === "truncated") && !value.artifact) {
      context.addIssue({
        code: "custom",
        message: `${value.status} raw network evidence needs an artifact`,
      });
    }
    if (value.status !== "captured" && value.status !== "truncated" && value.artifact) {
      context.addIssue({
        code: "custom",
        message: "only captured or truncated raw network evidence may name an artifact",
      });
    }
    if (
      (value.status === "captured" || value.status === "truncated") &&
      value.bytes !== value.artifact?.bytes
    ) {
      context.addIssue({
        code: "custom",
        message: "raw network artifact byte counts must agree",
      });
    }
  });

/** A bounded statement about one Android Run window. Packet sources describe
 * transport facts only; the strict flow schema deliberately has no HTTP
 * method, status, headers, or body fields. */
export const androidNetworkEvidenceSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    source: androidNetworkEvidenceSourceSchema,
    coverage: androidNetworkEvidenceCoverageSchema,
    scope: z.enum(["entire-emulator", "target-application", "session-log"]),
    startedAt: finiteTimestamp,
    finishedAt: finiteTimestamp.optional(),
    packets: z.number().int().nonnegative(),
    bytesSent: z.number().int().nonnegative(),
    bytesReceived: z.number().int().nonnegative(),
    domains: z.array(boundedText).max(256),
    flows: z.array(androidNetworkFlowSchema).max(1_000),
    attribution: androidNetworkAttributionSchema,
    rawCapture: androidRawNetworkCaptureSchema,
    dropped: z.number().int().nonnegative(),
    redactions: z.number().int().nonnegative(),
    limitations: z.array(boundedText).max(32),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.finishedAt !== undefined && value.finishedAt < value.startedAt) {
      context.addIssue({ code: "custom", message: "finishedAt cannot precede startedAt" });
    }
    if (value.source.kind === "app-session-log" && value.coverage !== "opportunistic") {
      context.addIssue({
        code: "custom",
        message: "app-session-log evidence must be opportunistic",
      });
    }
    if (
      value.source.kind === "app-session-log" &&
      (value.source.backend !== "agent-device-session-log" ||
        !["target-application", "session-log"].includes(value.scope))
    ) {
      context.addIssue({
        code: "custom",
        message: "app-session-log evidence needs its session-log backend and application scope",
      });
    }
    if (
      value.source.kind === "emulator-packet" &&
      (value.source.backend === "agent-device-session-log" || value.scope !== "entire-emulator")
    ) {
      context.addIssue({
        code: "custom",
        message: "emulator-packet evidence needs a packet backend and entire-emulator scope",
      });
    }
    if (value.coverage === "packet-complete") {
      if (value.source.kind !== "emulator-packet") {
        context.addIssue({
          code: "custom",
          message: "packet-complete evidence requires an emulator-packet source",
        });
      }
      if (value.finishedAt === undefined || value.dropped > 0) {
        context.addIssue({
          code: "custom",
          message: "packet-complete evidence needs a closed window with no dropped packets",
        });
      }
      if (value.source.backend === "android-emulator-console") {
        context.addIssue({
          code: "custom",
          message: "the emulator console backend cannot claim packet-complete coverage",
        });
      }
    }
    for (const flow of value.flows) {
      if (
        value.finishedAt !== undefined &&
        flow.startedAtMs + (flow.durationMs ?? 0) > value.finishedAt - value.startedAt
      ) {
        context.addIssue({
          code: "custom",
          message: "network flow exceeds the captured Run window",
        });
        break;
      }
    }
    if (value.attribution.confidence === "high") {
      if (
        !value.attribution.package ||
        value.attribution.uid === undefined ||
        value.attribution.rxBytesDelta === undefined ||
        value.attribution.txBytesDelta === undefined
      ) {
        context.addIssue({
          code: "custom",
          message: "high-confidence attribution needs package, UID, and byte deltas",
        });
      }
    }
  });

export type AndroidNetworkEvidenceCoverage = z.output<typeof androidNetworkEvidenceCoverageSchema>;
export type AndroidNetworkEvidenceSummary = z.output<typeof androidNetworkEvidenceSummarySchema>;
export type AndroidPacketCaptureProvenance = z.output<typeof androidPacketCaptureProvenanceSchema>;

export function parseAndroidNetworkEvidenceSummary(value: unknown): AndroidNetworkEvidenceSummary {
  return androidNetworkEvidenceSummarySchema.parse(value);
}

export function parseAndroidPacketCaptureProvenance(
  value: unknown,
): AndroidPacketCaptureProvenance {
  return androidPacketCaptureProvenanceSchema.parse(value);
}
