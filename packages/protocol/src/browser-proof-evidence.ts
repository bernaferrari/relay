import * as z from "zod/v4";
import { browserCaseProfileSchema, browserEngineSchema } from "./browser-case-profile.js";
import { browserDevicePageSchema } from "./browser-device.js";

export const BROWSER_PROOF_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const BROWSER_PROOF_EVIDENCE_ARTIFACT_KIND = "browser-proof-evidence" as const;

export const BROWSER_PROOF_EVIDENCE_CHANNELS = [
  "screenshot",
  "accessibility",
  "console-errors",
  "page-errors",
  "network",
  "trace",
  "popup-topology",
] as const;

export type BrowserProofEvidenceChannel = (typeof BROWSER_PROOF_EVIDENCE_CHANNELS)[number];

const identifier = z.string().trim().min(1).max(256);
const natural = z.number().int().nonnegative();
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const channelStatus = z.enum(["captured", "partial", "unsupported", "denied", "failed", "missing"]);

/** Shared evidence counters keep browser proof compatible with the generic
 * run evidence manifest. Browser-specific channels only add a typed name and
 * bounded references to the generic persisted artifacts. */
export const browserProofEvidenceChannelSchema = z
  .object({
    status: channelStatus,
    entries: natural,
    bytes: natural,
    dropped: natural,
    redactions: natural,
    artifactRefs: z.array(z.string().trim().min(1).max(4_096)).max(256).readonly(),
    message: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

const browserErrorSummarySchema = z
  .object({
    messages: z.array(z.string().trim().min(1).max(2_048)).max(256).readonly(),
    truncated: z.boolean(),
  })
  .strict();

const browserNetworkSummarySchema = z
  .object({
    requests: natural,
    failedRequests: natural,
    pendingRequests: natural,
    statusCodes: z.record(z.string().regex(/^\d{3}$/u), natural),
  })
  .strict();

const browserTraceReferenceSchema = z
  .object({
    path: z.string().trim().min(1).max(4_096),
    digest: sha256,
    format: z.enum(["playwright-trace", "trace"]),
  })
  .strict();

const browserPopupTopologySchema = z
  .object({
    pages: z.array(browserDevicePageSchema).max(128).readonly(),
    activePageId: identifier,
  })
  .strict();

const browserProofCompletenessSchema = z
  .object({
    status: z.enum(["complete", "partial"]),
    required: z.array(z.enum(BROWSER_PROOF_EVIDENCE_CHANNELS)).max(16).readonly(),
    captured: z.array(z.enum(BROWSER_PROOF_EVIDENCE_CHANNELS)).max(16).readonly(),
    missing: z.array(z.string().trim().min(1).max(256)).max(16).readonly(),
  })
  .strict()
  .superRefine((value, context) => {
    const unique = (items: readonly string[], path: string) => {
      if (new Set(items).size !== items.length) {
        context.addIssue({ code: "custom", path: [path], message: "must not contain duplicates" });
      }
    };
    unique(value.required, "required");
    unique(value.captured, "captured");
    const required = new Set(value.required);
    const captured = new Set(value.captured);
    const missing = value.required.filter((channel) => !captured.has(channel));
    if (
      missing.length !== value.missing.length ||
      missing.some((item, index) => item !== value.missing[index])
    ) {
      context.addIssue({
        code: "custom",
        path: ["missing"],
        message: "must list every required channel that was not captured in required order",
      });
    }
    if (value.status === "complete" && (missing.length > 0 || captured.size !== required.size)) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "complete browser evidence cannot have missing required channels",
      });
    }
    if (value.status === "partial" && missing.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "partial browser evidence must name a missing required channel",
      });
    }
    for (const channel of value.captured) {
      if (!required.has(channel)) {
        context.addIssue({
          code: "custom",
          path: ["captured"],
          message: `captured channel ${channel} is not required`,
        });
      }
    }
  });

/** All browser Checkpoint channels that are required for a merge-grade proof. */
export const BROWSER_PROOF_REQUIRED_CHANNELS = Object.freeze([
  ...BROWSER_PROOF_EVIDENCE_CHANNELS,
]) as readonly BrowserProofEvidenceChannel[];

export const browserProofEvidenceSchema = z
  .object({
    schemaVersion: z.literal(BROWSER_PROOF_EVIDENCE_SCHEMA_VERSION),
    runId: identifier,
    target: z
      .object({
        targetId: identifier,
        targetProfileId: identifier,
      })
      .strict(),
    build: z
      .object({
        /** Proof build identity is always bound to one exact full Git SHA. */
        sourceSha: z.string().regex(/^[a-f0-9]{40}$/u),
        artifactDigest: sha256,
      })
      .strict(),
    browser: z
      .object({
        engine: browserEngineSchema,
        version: identifier,
      })
      .strict(),
    /** Complete frozen BrowserCaseProfile, not a mutable target default. */
    environment: browserCaseProfileSchema,
    channels: z
      .object({
        screenshot: browserProofEvidenceChannelSchema,
        accessibility: browserProofEvidenceChannelSchema,
        "console-errors": browserProofEvidenceChannelSchema,
        "page-errors": browserProofEvidenceChannelSchema,
        network: browserProofEvidenceChannelSchema,
        trace: browserProofEvidenceChannelSchema,
        "popup-topology": browserProofEvidenceChannelSchema,
      })
      .strict(),
    consoleErrors: browserErrorSummarySchema.optional(),
    pageErrors: browserErrorSummarySchema.optional(),
    networkSummary: browserNetworkSummarySchema.optional(),
    traceReference: browserTraceReferenceSchema.optional(),
    popupTopology: browserPopupTopologySchema.optional(),
    completeness: browserProofCompletenessSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.browser.engine !== value.environment.engine) {
      context.addIssue({
        code: "custom",
        path: ["browser", "engine"],
        message: "must equal environment.engine",
      });
    }
    const required = new Set(value.completeness.required);
    const captured = new Set<BrowserProofEvidenceChannel>();
    for (const channel of BROWSER_PROOF_REQUIRED_CHANNELS) {
      const record = value.channels[channel];
      if (record.status === "captured") captured.add(channel);
      if (record.status === "captured" && record.artifactRefs.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["channels", channel, "artifactRefs"],
          message: "captured browser evidence requires at least one artifact reference",
        });
      }
    }
    const expectedCaptured = BROWSER_PROOF_REQUIRED_CHANNELS.filter((channel) =>
      captured.has(channel),
    );
    if (
      value.completeness.captured.length !== expectedCaptured.length ||
      expectedCaptured.some((channel, index) => value.completeness.captured[index] !== channel)
    ) {
      context.addIssue({
        code: "custom",
        path: ["completeness", "captured"],
        message: "must exactly match captured channel statuses in canonical order",
      });
    }
    const payloads: Partial<Record<BrowserProofEvidenceChannel, unknown>> = {
      "console-errors": value.consoleErrors,
      "page-errors": value.pageErrors,
      network: value.networkSummary,
      trace: value.traceReference,
      "popup-topology": value.popupTopology,
    };
    const payloadNames: Partial<Record<BrowserProofEvidenceChannel, string>> = {
      "console-errors": "consoleErrors",
      "page-errors": "pageErrors",
      network: "networkSummary",
      trace: "traceReference",
      "popup-topology": "popupTopology",
    };
    for (const channel of Object.keys(payloads) as BrowserProofEvidenceChannel[]) {
      if (captured.has(channel) && payloads[channel] === undefined) {
        context.addIssue({
          code: "custom",
          path: [payloadNames[channel]!],
          message: `is required when ${channel} evidence is captured`,
        });
      }
      if (!captured.has(channel) && payloads[channel] !== undefined) {
        context.addIssue({
          code: "custom",
          path: [payloadNames[channel]!],
          message: `must be omitted unless ${channel} evidence is captured`,
        });
      }
    }
    if (
      value.completeness.required.length !== BROWSER_PROOF_REQUIRED_CHANNELS.length ||
      BROWSER_PROOF_REQUIRED_CHANNELS.some(
        (channel, index) => value.completeness.required[index] !== channel,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["completeness", "required"],
        message: "must use the canonical browser proof channel set",
      });
    }
    if (value.completeness.captured.some((channel) => !captured.has(channel))) {
      context.addIssue({
        code: "custom",
        path: ["completeness", "captured"],
        message: "captured list must match captured channel statuses",
      });
    }
    if (required.size !== BROWSER_PROOF_REQUIRED_CHANNELS.length) {
      context.addIssue({
        code: "custom",
        path: ["completeness", "required"],
        message: "required channel identities must be unique",
      });
    }
  });

export type BrowserProofEvidenceChannelRecord = z.output<typeof browserProofEvidenceChannelSchema>;
export type BrowserProofEvidence = z.output<typeof browserProofEvidenceSchema>;

export function parseBrowserProofEvidence(value: unknown): BrowserProofEvidence {
  return browserProofEvidenceSchema.parse(value);
}

/** A persisted artifact constructor for adapters that collect the browser
 * channels. It validates before the artifact crosses the Run boundary. */
export function browserProofEvidenceArtifact(
  data: unknown,
  capturedAt: number,
): {
  kind: typeof BROWSER_PROOF_EVIDENCE_ARTIFACT_KIND;
  capturedAt: number;
  data: BrowserProofEvidence;
} {
  if (!Number.isInteger(capturedAt) || capturedAt < 0) {
    throw new Error("browser proof evidence capturedAt must be a non-negative integer");
  }
  return {
    kind: BROWSER_PROOF_EVIDENCE_ARTIFACT_KIND,
    capturedAt,
    data: parseBrowserProofEvidence(data),
  };
}
