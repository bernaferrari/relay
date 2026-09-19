import type {
  EvidenceCollectionPolicy,
  JobSummary,
  MatrixExpansion,
  RedactionPolicy,
  SensitiveEvidenceChannel,
  SoakReport,
} from "@relay/protocol";
import type { RelayClient } from "./index.js";

type ClientTransport = Pick<RelayClient, "invoke" | "resource">;

export function health(client: ClientTransport) {
  return client.invoke("system.health.get", {});
}

export function redactionPolicy(client: ClientTransport): Promise<{ policy: RedactionPolicy }> {
  return client.invoke("workspace.privacy.get", {});
}

export function setRedactionEnabled(
  client: ClientTransport,
  enabled: boolean,
): Promise<{ policy: RedactionPolicy }> {
  return client.invoke("workspace.privacy.update", { enabled });
}

export function evidenceCollectionPolicy(
  client: ClientTransport,
): Promise<{ policy: EvidenceCollectionPolicy }> {
  return client.invoke("workspace.evidence.get", {});
}

export function setSensitiveEvidenceConsent(
  client: ClientTransport,
  channel: SensitiveEvidenceChannel,
  enabled: boolean,
  reason?: string,
): Promise<{ policy: EvidenceCollectionPolicy }> {
  return client.invoke("workspace.evidence.update", {
    channel,
    enabled,
    ...(reason ? { reason } : {}),
  });
}

export type StartSoakInput = {
  recipe: string;
  matrixId: string;
  repetitions?: number;
  prodAccountMatch?: string;
};

export type StartSoakResult = {
  jobs: JobSummary[];
  matrix: MatrixExpansion;
  batchId: string;
  repetitions: number;
};

export function startSoak(
  client: ClientTransport,
  input: StartSoakInput,
): Promise<StartSoakResult> {
  return client.invoke("job.soak.start", input) as Promise<StartSoakResult>;
}

export function soakReport(
  client: ClientTransport,
  batchId: string,
): Promise<{ report: SoakReport }> {
  return client.resource(`/reports/soak/${encodeURIComponent(batchId)}`);
}
