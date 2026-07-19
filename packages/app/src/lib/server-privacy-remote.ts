import type {
  EvidenceCollectionPolicy,
  RedactionPolicy,
  SensitiveEvidenceChannel,
} from "@relay/protocol";
import type { ServerRequest } from "./server-matrix-remote";

export async function loadRedactionPolicy(request: ServerRequest): Promise<RedactionPolicy> {
  const data = await request<{ policy: RedactionPolicy }>("/settings/privacy");
  return data.policy;
}

export async function setRedactionEnabled(
  request: ServerRequest,
  enabled: boolean,
): Promise<RedactionPolicy> {
  const data = await request<{ policy: RedactionPolicy }>("/settings/privacy", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
  return data.policy;
}

export async function loadEvidenceCollectionPolicy(
  request: ServerRequest,
): Promise<EvidenceCollectionPolicy> {
  const data = await request<{ policy: EvidenceCollectionPolicy }>("/settings/evidence");
  return data.policy;
}

export async function setSensitiveEvidenceConsent(
  request: ServerRequest,
  channel: SensitiveEvidenceChannel,
  enabled: boolean,
): Promise<EvidenceCollectionPolicy> {
  const data = await request<{ policy: EvidenceCollectionPolicy }>("/settings/evidence", {
    method: "PUT",
    body: JSON.stringify({
      channel,
      enabled,
      ...(enabled ? { reason: "Enabled in Privacy & evidence settings" } : {}),
    }),
  });
  return data.policy;
}
