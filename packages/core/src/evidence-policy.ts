import type { EvidenceCollectionPolicy, SensitiveEvidenceChannel } from "@relay/protocol";
import { getRedactionPolicy } from "./redaction.js";
import { readWorkspaceSetting, writeWorkspaceSetting } from "./workspace-settings.js";

const EVIDENCE_POLICY_FILE = "evidence.json";
const DEFAULT_POLICY: EvidenceCollectionPolicy = { schemaVersion: 1, sensitive: {} };
const CHANNELS = new Set<SensitiveEvidenceChannel>([
  "audio",
  "crash",
  "network-body",
  "browser-trace",
]);

let activePolicy: EvidenceCollectionPolicy = DEFAULT_POLICY;

function clonePolicy(policy: EvidenceCollectionPolicy): EvidenceCollectionPolicy {
  return structuredClone(policy);
}

export function getEvidenceCollectionPolicy(): EvidenceCollectionPolicy {
  return { ...clonePolicy(activePolicy), redaction: getRedactionPolicy() };
}

export async function loadEvidenceCollectionPolicy(): Promise<EvidenceCollectionPolicy> {
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
  const next: EvidenceCollectionPolicy = { schemaVersion: 1, sensitive, updatedAt };
  await writeWorkspaceSetting(EVIDENCE_POLICY_FILE, next);
  activePolicy = next;
  return getEvidenceCollectionPolicy();
}

export function hasSensitiveEvidenceConsent(
  policy: EvidenceCollectionPolicy | undefined,
  channel: SensitiveEvidenceChannel,
): boolean {
  return Boolean(policy?.sensitive[channel]);
}
