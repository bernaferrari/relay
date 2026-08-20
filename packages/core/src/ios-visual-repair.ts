/**
 * Durable proof for a single iOS visual transition.
 *
 * Screenshot transport paths are intentionally absent from this module's
 * public output. A repair package retains immutable `relay-evidence://` refs
 * only, so a person or agent can investigate a failure after temp cleanup.
 */
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import type { AuthoringEvidence } from "@relay/protocol";
import { persistAuthoringEvidence } from "./authoring-evidence.js";
import { visualEvidenceAllowed } from "./redaction.js";

export type IosVisualVerificationInteraction = {
  /** Stable caller-provided id when one exists; Relay assigns one otherwise. */
  id?: string;
  /** A concise description suitable for a repair surface or agent handoff. */
  label: string;
  /** The exact resolved input that was sent to the device, never a best guess. */
  input: Record<string, unknown>;
};

export type IosVisualVerificationRepair = {
  interaction: IosVisualVerificationInteraction;
  /** Keep successful evidence only when an explicit reviewer requested it. */
  retain?: "on-failure" | "always";
};

export type IosVisualVerificationFailureStage =
  | "before-capture"
  | "action"
  | "after-capture"
  | "fingerprint";

export type IosVisualVerificationCapture = {
  capturedAt: number;
  fingerprint?: string;
  evidence?: AuthoringEvidence;
};

export type CapturedIosVisualRaster = IosVisualVerificationCapture & { bytes: Uint8Array };

export type IosVisualVerificationTiming = {
  startedAt: number;
  /** Time at which the visual proof itself finished, before storage cleanup. */
  finishedAt: number;
  settleMs: number;
  beforeCapturedAt?: number;
  actionStartedAt?: number;
  actionFinishedAt?: number;
  afterCapturedAt?: number;
};

export type IosVisualVerificationFailure = {
  stage: IosVisualVerificationFailureStage;
  message: string;
  at: number;
};

export type IosVisualVerificationRepairPackage = {
  schemaVersion: 1;
  kind: "ios-visual-transition";
  serial: string;
  interaction: Required<IosVisualVerificationInteraction>;
  timing: IosVisualVerificationTiming;
  outcome: "changed" | "unchanged" | "incomplete";
  /** The first failure remains the action outcome; later probes never overwrite it. */
  failure?: IosVisualVerificationFailure;
  failures?: IosVisualVerificationFailure[];
  before?: IosVisualVerificationCapture;
  after?: IosVisualVerificationCapture;
  /** Self-contained index that points at immutable image evidence. */
  manifest: AuthoringEvidence;
};

export type IosVisualVerificationDiagnostic = {
  serial: string;
  timing: IosVisualVerificationTiming;
  outcome: "changed" | "unchanged" | "incomplete";
  failure?: IosVisualVerificationFailure;
  failures?: IosVisualVerificationFailure[];
  before?: Omit<IosVisualVerificationCapture, "evidence">;
  after?: Omit<IosVisualVerificationCapture, "evidence">;
  repair?: IosVisualVerificationRepairPackage;
  repairError?: string;
  cleanupErrors?: string[];
};

/**
 * Success returns the timing and optional immutable evidence. Failures retain
 * the same diagnostic on their original Error object, so cancellation and
 * runner failures keep their original identity and semantics.
 */
export type IosVisualVerificationResult = IosVisualVerificationDiagnostic;

const diagnostics = new WeakMap<object, IosVisualVerificationDiagnostic>();

/** Retrieve the exact visual proof package attached to an interaction failure. */
export function iosVisualVerificationDiagnostic(
  error: unknown,
): IosVisualVerificationDiagnostic | undefined {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return undefined;
  const diagnostic = diagnostics.get(error);
  return diagnostic ? structuredClone(diagnostic) : undefined;
}

export function iosVisualVerificationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function normalizeIosVisualVerificationInteraction(
  interaction: IosVisualVerificationInteraction,
): Required<IosVisualVerificationInteraction> {
  const label = interaction.label.trim() || "iOS interaction";
  return {
    id: interaction.id?.trim() || `ios-visual-${randomUUID()}`,
    label,
    input: structuredClone(interaction.input),
  };
}

export function iosVisualVerificationCaptureSummary(
  capture: IosVisualVerificationCapture | undefined,
): Omit<IosVisualVerificationCapture, "evidence"> | undefined {
  if (!capture) return undefined;
  return {
    capturedAt: capture.capturedAt,
    ...(capture.fingerprint ? { fingerprint: capture.fingerprint } : {}),
  };
}

export async function removeIosVisualVerificationTemporary(
  path: string,
): Promise<string | undefined> {
  try {
    await unlink(path);
    return undefined;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return undefined;
    return `${path}: ${iosVisualVerificationErrorMessage(error)}`;
  }
}

export function canPersistIosVisualVerificationRepair(): boolean {
  return visualEvidenceAllowed();
}

export async function persistIosVisualVerificationRepair(input: {
  serial: string;
  interaction: Required<IosVisualVerificationInteraction>;
  timing: IosVisualVerificationTiming;
  outcome: IosVisualVerificationRepairPackage["outcome"];
  failure?: IosVisualVerificationRepairPackage["failure"];
  failures?: IosVisualVerificationRepairPackage["failures"];
  before?: CapturedIosVisualRaster;
  after?: CapturedIosVisualRaster;
}): Promise<IosVisualVerificationRepairPackage> {
  const persistCapture = async (
    capture: CapturedIosVisualRaster | undefined,
  ): Promise<IosVisualVerificationCapture | undefined> => {
    if (!capture) return undefined;
    const evidence = await persistAuthoringEvidence({
      kind: "screenshot",
      capturedAt: capture.capturedAt,
      data: capture.bytes,
      mime: "image/png",
    });
    return {
      capturedAt: capture.capturedAt,
      ...(capture.fingerprint ? { fingerprint: capture.fingerprint } : {}),
      evidence,
    };
  };

  const before = await persistCapture(input.before);
  const after = await persistCapture(input.after);
  const manifestPayload = {
    schemaVersion: 1 as const,
    kind: "ios-visual-transition" as const,
    serial: input.serial,
    interaction: input.interaction,
    timing: input.timing,
    outcome: input.outcome,
    ...(input.failure ? { failure: input.failure } : {}),
    ...(input.failures?.length ? { failures: input.failures } : {}),
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  };
  const manifest = await persistAuthoringEvidence({
    kind: "snapshot",
    capturedAt: input.timing.finishedAt,
    data: JSON.stringify(manifestPayload),
    mime: "application/json",
  });
  return { ...manifestPayload, manifest };
}

export function attachIosVisualVerificationDiagnostic(
  error: unknown,
  diagnostic: IosVisualVerificationDiagnostic,
): void {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return;
  const copy = structuredClone(diagnostic);
  diagnostics.set(error, copy);
  // Keep this enumerable for in-process agent hosts that serialize Error
  // fields, while preserving the original Error class and cancellation type.
  try {
    Object.defineProperty(error, "iosVisualVerification", {
      configurable: true,
      enumerable: true,
      value: copy,
    });
  } catch {
    // Frozen third-party errors remain readable through the WeakMap above.
  }
}
