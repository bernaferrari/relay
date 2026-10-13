import type {
  EvidenceCollectionMode,
  EvidenceCollectionPolicy,
  SensitiveEvidenceChannel,
} from "@relay/protocol";
import { getRedactionPolicy, visualEvidenceAllowed } from "./redaction.js";
import { readWorkspaceSetting, writeWorkspaceSetting } from "./workspace-settings.js";

const EVIDENCE_POLICY_FILE = "evidence.json";
const DEFAULT_POLICY: EvidenceCollectionPolicy = {
  schemaVersion: 1,
  sensitive: {},
  mode: "lightweight",
};
const CHANNELS = new Set<SensitiveEvidenceChannel>([
  "audio",
  "crash",
  "network-body",
  "network-raw",
  "browser-trace",
]);

let activePolicy: EvidenceCollectionPolicy = DEFAULT_POLICY;
let policyOperations: Promise<void> = Promise.resolve();

/** Serialize the whole transaction so a storage preference cannot restore a
 * consent grant revoked by another request while persistence is in flight. */
function serializePolicyOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = policyOperations.then(operation);
  policyOperations = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function clonePolicy(policy: EvidenceCollectionPolicy): EvidenceCollectionPolicy {
  return structuredClone(policy);
}

export function getEvidenceCollectionPolicy(): EvidenceCollectionPolicy {
  return { ...clonePolicy(activePolicy), redaction: getRedactionPolicy() };
}

export async function loadEvidenceCollectionPolicy(): Promise<EvidenceCollectionPolicy> {
  return serializePolicyOperation(readEvidenceCollectionPolicy);
}

async function readEvidenceCollectionPolicy(): Promise<EvidenceCollectionPolicy> {
  const value = await readWorkspaceSetting(EVIDENCE_POLICY_FILE);
  if (value === null) {
    activePolicy = DEFAULT_POLICY;
    return getEvidenceCollectionPolicy();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Evidence collection settings must be an object");
  }
  const raw = value as Partial<EvidenceCollectionPolicy>;
  if (raw.schemaVersion !== 1 || !raw.sensitive || typeof raw.sensitive !== "object") {
    throw new Error("Evidence collection settings have an unsupported format");
  }
  if (raw.mode !== undefined && raw.mode !== "lightweight" && raw.mode !== "full") {
    throw new Error("Evidence collection mode must be lightweight or full");
  }
  const sensitive: EvidenceCollectionPolicy["sensitive"] = {};
  for (const [name, grant] of Object.entries(raw.sensitive)) {
    if (!CHANNELS.has(name as SensitiveEvidenceChannel)) {
      throw new Error(`Unsupported sensitive evidence channel: ${name}`);
    }
    if (
      !grant ||
      typeof grant !== "object" ||
      typeof (grant as { grantedAt?: unknown }).grantedAt !== "number" ||
      typeof (grant as { grantedBy?: unknown }).grantedBy !== "string" ||
      typeof (grant as { reason?: unknown }).reason !== "string"
    ) {
      throw new Error(`Invalid consent grant for ${name}`);
    }
    sensitive[name as SensitiveEvidenceChannel] = {
      grantedAt: (grant as { grantedAt: number }).grantedAt,
      grantedBy: (grant as { grantedBy: string }).grantedBy,
      reason: (grant as { reason: string }).reason,
    };
  }
  activePolicy = {
    schemaVersion: 1,
    sensitive,
    // Existing workspace settings adopt the default. Historical Run manifests
    // are read separately and keep their original frozen policy.
    mode: raw.mode ?? "lightweight",
    ...(typeof raw.updatedAt === "number" ? { updatedAt: raw.updatedAt } : {}),
  };
  return getEvidenceCollectionPolicy();
}

export async function setSensitiveEvidenceConsent(input: {
  channel: SensitiveEvidenceChannel;
  enabled: boolean;
  grantedBy: string;
  reason?: string;
}): Promise<EvidenceCollectionPolicy> {
  if (!CHANNELS.has(input.channel)) throw new Error(`Unsupported channel: ${input.channel}`);
  return serializePolicyOperation(async () => {
    const updatedAt = Date.now();
    const sensitive = { ...activePolicy.sensitive };
    if (input.enabled) {
      sensitive[input.channel] = {
        grantedAt: updatedAt,
        grantedBy: input.grantedBy.trim() || "local-user",
        reason: input.reason?.trim() || "Enabled in Privacy & evidence settings",
      };
    } else {
      delete sensitive[input.channel];
    }
    const next: EvidenceCollectionPolicy = { ...clonePolicy(activePolicy), sensitive, updatedAt };
    await writeWorkspaceSetting(EVIDENCE_POLICY_FILE, next);
    activePolicy = next;
    return getEvidenceCollectionPolicy();
  });
}

export async function setEvidenceCollectionMode(
  mode: EvidenceCollectionMode,
): Promise<EvidenceCollectionPolicy> {
  if (mode !== "lightweight" && mode !== "full") {
    throw new Error("Evidence collection mode must be lightweight or full");
  }
  return serializePolicyOperation(async () => {
    const next = { ...clonePolicy(activePolicy), mode, updatedAt: Date.now() };
    await writeWorkspaceSetting(EVIDENCE_POLICY_FILE, next);
    activePolicy = next;
    return getEvidenceCollectionPolicy();
  });
}

/** Read the frozen policy instead of a mutable workspace preference. A legacy
 * Run without mode keeps its original automatic-video behavior. */
export function automaticVideoAllowed(policy: EvidenceCollectionPolicy): boolean {
  return (
    policy.mode !== "lightweight" && visualEvidenceAllowed(policy.redaction ?? getRedactionPolicy())
  );
}

export function hasSensitiveEvidenceConsent(
  policy: EvidenceCollectionPolicy | undefined,
  channel: SensitiveEvidenceChannel,
): boolean {
  const grant = policy?.sensitive?.[channel];
  return Boolean(
    grant &&
    Number.isFinite(grant.grantedAt) &&
    grant.grantedAt >= 0 &&
    typeof grant.grantedBy === "string" &&
    grant.grantedBy.trim() &&
    typeof grant.reason === "string" &&
    grant.reason.trim(),
  );
}
