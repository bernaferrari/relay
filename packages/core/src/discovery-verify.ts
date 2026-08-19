/**
 * Verify-after-action for discovery.do: settle, re-snapshot, detect change.
 * Failures are structured — never silent app relaunch.
 */
import type { SnapshotNode } from "./device.js";
import { fingerprintDiscoveryScreen } from "./discovery.js";
import type { SnapshotPayload } from "./workspace.js";
import { captureSnapshot } from "./workspace.js";

export const DISCOVERY_SETTLE_MS = {
  tap: 200,
  back: 450,
  backResettle: 250,
} as const;

export type DiscoverySettleKind = "tap" | "type" | "scroll" | "back" | "manual";

export type DiscoveryVerifyErrorCode = "snapshot_failed" | "verify_failed";

export class DiscoveryVerifyError extends Error {
  readonly code: DiscoveryVerifyErrorCode;

  constructor(code: DiscoveryVerifyErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "DiscoveryVerifyError";
    this.code = code;
  }
}

export function discoverySettleMs(kind: DiscoverySettleKind): number {
  return kind === "back" ? DISCOVERY_SETTLE_MS.back : DISCOVERY_SETTLE_MS.tap;
}

export function discoveryFingerprintsChanged(before: string, after: string): boolean {
  return before !== after;
}

export function fingerprintDiscoveryNodes(nodes: SnapshotNode[]): string {
  return fingerprintDiscoveryScreen(nodes);
}

export async function waitDiscoverySettle(kind: DiscoverySettleKind): Promise<void> {
  const ms = discoverySettleMs(kind);
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

export type DiscoverySettledSnapshot = {
  snapshot: SnapshotPayload;
  fingerprint: string;
  changed: boolean;
};

/**
 * After an action: optionally wait for UI settle, capture a fresh tree, detect
 * fingerprint change vs before. Does not relaunch apps or invent recovery.
 */
export async function captureSettledDiscoverySnapshot(input: {
  serial: string;
  beforeFingerprint: string;
  kind: DiscoverySettleKind;
  /** Skip the primary settle wait when the caller already waited (e.g. interact). */
  alreadySettled?: boolean;
}): Promise<DiscoverySettledSnapshot> {
  try {
    if (!input.alreadySettled) {
      await waitDiscoverySettle(input.kind);
    }

    let snapshot = await captureSnapshot({ serial: input.serial });
    let fingerprint = fingerprintDiscoveryScreen(snapshot.nodes);

    // Back / sheet closes often animate past the first post-tap tree.
    if (input.kind === "back") {
      const settled = await captureSnapshot({ serial: input.serial });
      const settledFingerprint = fingerprintDiscoveryScreen(settled.nodes);
      if (settledFingerprint !== fingerprint) {
        await new Promise((resolve) => setTimeout(resolve, DISCOVERY_SETTLE_MS.backResettle));
        snapshot = await captureSnapshot({ serial: input.serial });
        fingerprint = fingerprintDiscoveryScreen(snapshot.nodes);
      } else {
        snapshot = settled;
        fingerprint = settledFingerprint;
      }
    }

    return {
      snapshot,
      fingerprint,
      changed: discoveryFingerprintsChanged(input.beforeFingerprint, fingerprint),
    };
  } catch (error) {
    if (error instanceof DiscoveryVerifyError) throw error;
    throw new DiscoveryVerifyError(
      "snapshot_failed",
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}
