import type { EvidenceCollectionPolicy, RedactionPolicy } from "@relay/protocol";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";

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
  { id: "evidence", path: "/settings/evidence", label: "Evidence & privacy" },
  { id: "integrations", path: "/settings/integrations", label: "Integrations" },
  { id: "appearance", path: "/settings/appearance", label: "Appearance" },
  { id: "advanced", path: "/settings/advanced", label: "Advanced" },
  { id: "about", path: "/settings/about", label: "About" },
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
  androidSetup(): Promise<unknown>;
};

export function createSettingsProductService(platform: Platform): SettingsProductService {
  let clientPromise: ReturnType<typeof productClientForPlatform> | undefined;
  const client = () =>
    (clientPromise ??= productClientForPlatform(platform)).then(({ client }) => client);
  return {
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
  };
}
