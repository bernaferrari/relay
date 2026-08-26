import { createSignal } from "solid-js";
import type { RelayClient } from "@relay/client";
import type {
  EvidenceCollectionPolicy,
  RedactionPolicy,
  SensitiveEvidenceChannel,
} from "@relay/protocol";

export function createServerPrivacyController(client: () => Promise<RelayClient>) {
  const [redactionPolicy, setRedactionPolicy] = createSignal<RedactionPolicy | null>(null);
  const [evidenceCollectionPolicy, setEvidenceCollectionPolicy] =
    createSignal<EvidenceCollectionPolicy | null>(null);

  async function refreshRedactionPolicy(): Promise<RedactionPolicy> {
    const policy = (await (await client()).invoke("workspace.privacy.get", {})).policy;
    setRedactionPolicy(policy);
    return policy;
  }

  async function updateRedactionEnabled(enabled: boolean): Promise<RedactionPolicy> {
    const policy = (await (await client()).invoke("workspace.privacy.update", { enabled })).policy;
    setRedactionPolicy(policy);
    return policy;
  }

  async function refreshEvidenceCollectionPolicy(): Promise<EvidenceCollectionPolicy> {
    const policy = (await (await client()).invoke("workspace.evidence.get", {})).policy;
    setEvidenceCollectionPolicy(policy);
    return policy;
  }

  async function updateSensitiveEvidenceConsent(
    channel: SensitiveEvidenceChannel,
    enabled: boolean,
  ): Promise<EvidenceCollectionPolicy> {
    const policy = (
      await (
        await client()
      ).invoke("workspace.evidence.update", {
        channel,
        enabled,
        ...(enabled ? { reason: "Enabled in Privacy & evidence settings" } : {}),
      })
    ).policy;
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
