import type { EvidenceCollectionPolicy, RedactionPolicy } from "@relay/protocol";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";
import type { IntegrationsProductService } from "./integration-product-service";
import { createIntegrationsProductService } from "./integration-product-service";

export type SettingsCategory =
  | "general"
  | "evidence"
  | "integrations"
  | "appearance"
  | "advanced"
  | "about";

export const settingsCategories: readonly {
  id: SettingsCategory;
  path: `/settings/${SettingsCategory}`;
  label: string;
}[] = [
  { id: "general", path: "/settings/general", label: "General" },
  // Capture policy. QA evidence is Result / Findings / visual compare.
  { id: "evidence", path: "/settings/evidence", label: "Privacy" },
  { id: "integrations", path: "/settings/integrations", label: "Integrations" },
  { id: "appearance", path: "/settings/appearance", label: "Appearance" },
  { id: "advanced", path: "/settings/advanced", label: "Advanced" },
  { id: "about", path: "/settings/about", label: "Help & about" },
] as const;

export const settingsQueryKeys = {
  privacy: ["settings", "privacy"] as const,
  evidence: ["settings", "evidence"] as const,
  appleSetup: ["settings", "devices", "apple"] as const,
  androidSetup: ["settings", "devices", "android"] as const,
};

export type SettingsProductService = {
  privacy(): Promise<RedactionPolicy>;
  setPrivacy(enabled: boolean): Promise<RedactionPolicy>;
  evidence(): Promise<EvidenceCollectionPolicy>;
  setEvidence(input: {
    channel: "audio" | "crash" | "network-body" | "network-raw" | "browser-trace";
    enabled: boolean;
    reason?: string;
  }): Promise<EvidenceCollectionPolicy>;
  appleSetup(): Promise<unknown>;
  /** Save (or with "", remove) the model key. The key is never read back. */
  setModelKey?(key: string): Promise<{ configured: boolean; source: string }>;
  androidSetup(): Promise<unknown>;
  /** Optional for existing settings fixture adapters; production exposes the read-only integration seam. */
  integrations?: IntegrationsProductService;
};

export function createSettingsProductService(platform: Platform): SettingsProductService {
  let clientPromise: ReturnType<typeof productClientForPlatform> | undefined;
  const client = () =>
    (clientPromise ??= productClientForPlatform(platform)).then(({ client }) => client);
  return {
    async setModelKey(key) {
      return (await client()).invoke("system.model-key.set", { key });
    },
    async privacy() {
      return (await client()).invoke("workspace.privacy.get", {}).then((result) => result.policy);
    },
    async setPrivacy(enabled) {
      return (await client())
        .invoke("workspace.privacy.update", { enabled })
        .then((result) => result.policy);
    },
    async evidence() {
      return (await client()).invoke("workspace.evidence.get", {}).then((result) => result.policy);
    },
    async setEvidence(input) {
      return (await client())
        .invoke("workspace.evidence.update", input)
        .then((result) => result.policy);
    },
    async appleSetup() {
      return (await client()).resource("/settings/devices/apple");
    },
    async androidSetup() {
      return (await client()).resource("/settings/devices/android");
    },
    integrations: createIntegrationsProductService(platform),
  };
}
