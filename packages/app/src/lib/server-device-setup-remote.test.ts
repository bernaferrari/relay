import assert from "node:assert/strict";
import test from "node:test";
import type { RelayClient } from "@relay/client";
import {
  loadAndroidAppLocales,
  saveAppleDeviceSetup,
  saveIosLivePreview,
} from "./server-device-setup-remote";

test("device mutations and app locale lookup use registered operation ids", async () => {
  const calls: Array<{ id: string; input: unknown }> = [];
  const client = {
    invoke: async (id: string, input: unknown) => {
      calls.push({ id, input });
      if (id === "target.app.locales") return { locales: ["en", "pt-BR"] };
      return { setup: { version: 1 } };
    },
  } as unknown as RelayClient;

  assert.deepEqual(await loadAndroidAppLocales(client, "pixel-1", "com.example"), ["en", "pt-BR"]);
  await saveAppleDeviceSetup(client, { teamId: "ABCDE12345", bundleId: "com.example.runner" });
  await saveIosLivePreview(client, "agent-device-png");

  assert.deepEqual(calls, [
    {
      id: "target.app.locales",
      input: { serial: "pixel-1", package: "com.example" },
    },
    {
      id: "workspace.apple-device.update",
      input: { teamId: "ABCDE12345", bundleId: "com.example.runner" },
    },
    {
      id: "workspace.apple-live-preview.update",
      input: { backend: "agent-device-png" },
    },
  ]);
});
