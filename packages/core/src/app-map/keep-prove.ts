import type { Connection, ConnectionNavigationTarget, Proposal } from "@relay/protocol";
import { observeScreenIdentity } from "../screen-identity.js";
import { captureSnapshot, interact } from "../workspace.js";

function fingerprintOf(nodes: Parameters<typeof observeScreenIdentity>[0]): string | undefined {
  return observeScreenIdentity(nodes).fingerprint;
}

async function activate(serial: string, target: ConnectionNavigationTarget): Promise<boolean> {
  try {
    if (target.kind === "identifier") {
      await interact({ kind: "identifier", identifier: target.identifier }, { serial });
      return true;
    }
    if (target.kind === "accessibility") {
      await interact({ kind: "label", label: target.label }, { serial });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** One-shot Keep replay. Pass → ready. Fail or wrong screen → stay draft. */
export async function proveConnectionOnDevice(input: {
  serial: string;
  connection: Connection;
}): Promise<{ proven: boolean; reason: string }> {
  const navigation = input.connection.navigation;
  if (!navigation?.targetAlternatives.length) {
    return { proven: false, reason: "No navigation contract to replay." };
  }
  const expected = navigation.expectedDestination.identity.fingerprint;
  const source = input.connection.return?.expectedDestination.identity.fingerprint;
  const here = fingerprintOf((await captureSnapshot({ serial: input.serial })).nodes);
  if (here === expected && source) {
    try {
      await interact({ kind: "key", key: "back" }, { serial: input.serial });
    } catch {
      return { proven: false, reason: "Could not return to the source screen." };
    }
  }
  const atSource = fingerprintOf((await captureSnapshot({ serial: input.serial })).nodes);
  if (source && atSource !== source) {
    return { proven: false, reason: "Device is not on the source screen." };
  }
  let tapped = false;
  for (const alternative of navigation.targetAlternatives) {
    if (await activate(input.serial, alternative)) {
      tapped = true;
      break;
    }
  }
  if (!tapped) return { proven: false, reason: "No target alternative activated." };
  const after = fingerprintOf((await captureSnapshot({ serial: input.serial })).nodes);
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
