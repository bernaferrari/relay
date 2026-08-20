import type {
  Connection,
  ConnectionNavigationTarget,
  ConnectionScreenProof,
  Proposal,
} from "@relay/protocol";
import type { SnapshotNode } from "../device.js";
import { observeScreenIdentity } from "../screen-identity.js";
import { IosMutationOutcomeUnknownError } from "../ios-mutation-policy.js";
import { captureSnapshot, interact, type InteractInput } from "../workspace.js";

function fingerprintOf(nodes: Parameters<typeof observeScreenIdentity>[0]): string | undefined {
  return observeScreenIdentity(nodes).fingerprint;
}

/**
 * Small runtime seam for an otherwise device-backed proof. It keeps the
 * one-shot proof unit-testable without giving callers a second way to mutate
 * a real device.
 */
export type ConnectionProofRuntime = {
  captureSnapshot: (input: { serial: string }) => Promise<{ nodes: SnapshotNode[] }>;
  interact: (input: InteractInput, options: { serial: string }) => Promise<unknown>;
};

const liveConnectionProofRuntime: ConnectionProofRuntime = { captureSnapshot, interact };

/**
 * The original iOS error is the terminal signal. This supplementary context
 * describes the already-proven state immediately before it, so an agent or
 * person can repair a map connection without guessing which screen Relay
 * thought it was on.
 */
export type ConnectionProofOutcomeUnknownDiagnostic = {
  serial: string;
  connectionId: string;
  phase: "return-to-source" | "target-activation";
  before: {
    observedFingerprint?: string;
    expectedDestination: ConnectionScreenProof;
    expectedSource?: ConnectionScreenProof;
  };
};

const outcomeUnknownDiagnostics = new WeakMap<object, ConnectionProofOutcomeUnknownDiagnostic>();

export function connectionProofOutcomeUnknownDiagnostic(
  error: unknown,
): ConnectionProofOutcomeUnknownDiagnostic | undefined {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return undefined;
  const diagnostic = outcomeUnknownDiagnostics.get(error);
  return diagnostic ? structuredClone(diagnostic) : undefined;
}

function attachConnectionProofOutcomeUnknown(
  error: unknown,
  diagnostic: ConnectionProofOutcomeUnknownDiagnostic,
): void {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return;
  const copy = structuredClone(diagnostic);
  outcomeUnknownDiagnostics.set(error, copy);
  // Make this portable for in-process MCP/agent hosts while retaining the
  // typed error object for ordinary core callers.
  try {
    Object.defineProperty(error, "connectionProof", {
      configurable: true,
      enumerable: true,
      value: copy,
    });
  } catch {
    // Frozen third-party errors remain available through the WeakMap above.
  }
}

function rethrowConnectionProofOutcomeUnknown(
  error: unknown,
  diagnostic: ConnectionProofOutcomeUnknownDiagnostic,
): void {
  if (!(error instanceof IosMutationOutcomeUnknownError)) return;
  attachConnectionProofOutcomeUnknown(error, diagnostic);
  throw error;
}

async function activate(
  runtime: ConnectionProofRuntime,
  serial: string,
  target: ConnectionNavigationTarget,
  onUnknown: (error: unknown) => void,
): Promise<boolean> {
  try {
    if (target.kind === "identifier") {
      await runtime.interact({ kind: "identifier", identifier: target.identifier }, { serial });
      return true;
    }
    if (target.kind === "accessibility") {
      await runtime.interact({ kind: "label", label: target.label }, { serial });
      return true;
    }
  } catch (error) {
    // An unknown iOS tap is terminal. Trying a lower-ranked selector could
    // send a second physical input to a screen that may already have changed.
    onUnknown(error);
    return false;
  }
  return false;
}

/** One-shot Keep replay. Pass → ready. Fail or wrong screen → stay draft. */
export async function proveConnectionOnDevice(input: {
  serial: string;
  connection: Connection;
  /** Test/runtime seam; normal calls use the single shared workspace path. */
  runtime?: ConnectionProofRuntime;
}): Promise<{ proven: boolean; reason: string }> {
  const runtime = input.runtime ?? liveConnectionProofRuntime;
  const navigation = input.connection.navigation;
  if (!navigation?.targetAlternatives.length) {
    return { proven: false, reason: "No navigation contract to replay." };
  }
  const expected = navigation.expectedDestination.identity.fingerprint;
  const source = input.connection.return?.expectedDestination.identity.fingerprint;
  const here = fingerprintOf((await runtime.captureSnapshot({ serial: input.serial })).nodes);
  const diagnosticFor = (
    phase: ConnectionProofOutcomeUnknownDiagnostic["phase"],
    observedFingerprint: string | undefined,
  ): ConnectionProofOutcomeUnknownDiagnostic => ({
    serial: input.serial,
    connectionId: input.connection.id,
    phase,
    before: {
      ...(observedFingerprint ? { observedFingerprint } : {}),
      expectedDestination: structuredClone(navigation.expectedDestination),
      ...(input.connection.return
        ? { expectedSource: structuredClone(input.connection.return.expectedDestination) }
        : {}),
    },
  });
  if (here === expected && source) {
    try {
      await runtime.interact({ kind: "key", key: "back" }, { serial: input.serial });
    } catch (error) {
      // A Back command can be just as ambiguous as a tap. Do not reduce it to
      // a normal failed proof and continue with a target alternative.
      rethrowConnectionProofOutcomeUnknown(error, diagnosticFor("return-to-source", here));
      return { proven: false, reason: "Could not return to the source screen." };
    }
  }
  const atSource = fingerprintOf((await runtime.captureSnapshot({ serial: input.serial })).nodes);
  if (source && atSource !== source) {
    return { proven: false, reason: "Device is not on the source screen." };
  }
  let tapped = false;
  for (const alternative of navigation.targetAlternatives) {
    if (
      await activate(runtime, input.serial, alternative, (error) =>
        rethrowConnectionProofOutcomeUnknown(error, diagnosticFor("target-activation", atSource)),
      )
    ) {
      tapped = true;
      break;
    }
  }
  if (!tapped) return { proven: false, reason: "No target alternative activated." };
  const after = fingerprintOf((await runtime.captureSnapshot({ serial: input.serial })).nodes);
  if (after === expected) return { proven: true, reason: "Replay matched the destination." };
  return { proven: false, reason: "Replay did not land on the expected destination." };
}

export function connectionIdsFromProposal(proposal: Proposal): string[] {
  return proposal.changes.flatMap((change) => {
    if (change.kind === "connection.connect") return [change.connection.id];
    if (change.kind === "connection.update") return [change.connectionId];
    return [];
  });
}
