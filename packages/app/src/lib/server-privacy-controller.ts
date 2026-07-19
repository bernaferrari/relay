import { createSignal } from "solid-js";
import type {
  EvidenceCollectionPolicy,
  RedactionPolicy,
  SensitiveEvidenceChannel,
} from "@relay/protocol";
import type { ServerRequest } from "./server-matrix-remote";
import {
  loadEvidenceCollectionPolicy,
  loadRedactionPolicy,
  setRedactionEnabled,
  setSensitiveEvidenceConsent,
} from "./server-privacy-remote";

export function createServerPrivacyController(request: ServerRequest) {
  const [redactionPolicy, setRedactionPolicy] = createSignal<RedactionPolicy | null>(null);
  const [evidenceCollectionPolicy, setEvidenceCollectionPolicy] =
    createSignal<EvidenceCollectionPolicy | null>(null);

  async function refreshRedactionPolicy(): Promise<RedactionPolicy> {
    const policy = await loadRedactionPolicy(request);
    setRedactionPolicy(policy);
    return policy;
  }

  async function updateRedactionEnabled(enabled: boolean): Promise<RedactionPolicy> {
    const policy = await setRedactionEnabled(request, enabled);
    setRedactionPolicy(policy);
    return policy;
  }

  async function refreshEvidenceCollectionPolicy(): Promise<EvidenceCollectionPolicy> {
    const policy = await loadEvidenceCollectionPolicy(request);
    setEvidenceCollectionPolicy(policy);
    return policy;
  }

  async function updateSensitiveEvidenceConsent(
    channel: SensitiveEvidenceChannel,
    enabled: boolean,
  ): Promise<EvidenceCollectionPolicy> {
    const policy = await setSensitiveEvidenceConsent(request, channel, enabled);
    setEvidenceCollectionPolicy(policy);
    return policy;
  }

  function clearPrivacyPolicies(): void {
    setRedactionPolicy(null);
    setEvidenceCollectionPolicy(null);
  }

  return {
    redactionPolicy,
    evidenceCollectionPolicy,
    refreshRedactionPolicy,
    refreshEvidenceCollectionPolicy,
    updateRedactionEnabled,
    updateSensitiveEvidenceConsent,
    clearPrivacyPolicies,
  };
}
