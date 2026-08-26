import assert from "node:assert/strict";
import test from "node:test";
import type { RelayClient } from "@relay/client";
import type { EvidenceCollectionPolicy, RedactionPolicy } from "@relay/protocol";
import { createServerPrivacyController } from "./server-privacy-controller";

test("privacy state uses exact registered operation inputs and retains canonical policies", async () => {
  const redaction = { enabled: true } as RedactionPolicy;
  const evidence = { schemaVersion: 1, sensitive: {} } satisfies EvidenceCollectionPolicy;
  const calls: Array<{ id: string; input: unknown }> = [];
  const client = {
    invoke: async (id: string, input: unknown) => {
      calls.push({ id, input });
      return id.startsWith("workspace.privacy") ? { policy: redaction } : { policy: evidence };
    },
  } as unknown as RelayClient;
  const controller = createServerPrivacyController(async () => client);

  assert.equal(await controller.refreshRedactionPolicy(), redaction);
  assert.equal(await controller.updateSensitiveEvidenceConsent("network-body", true), evidence);
  assert.equal(controller.redactionPolicy(), redaction);
  assert.equal(controller.evidenceCollectionPolicy(), evidence);
  assert.deepEqual(calls, [
    { id: "workspace.privacy.get", input: {} },
    {
      id: "workspace.evidence.update",
      input: {
        channel: "network-body",
        enabled: true,
        reason: "Enabled in Privacy & evidence settings",
      },
    },
  ]);
});
