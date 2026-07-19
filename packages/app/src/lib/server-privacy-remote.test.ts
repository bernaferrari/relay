import assert from "node:assert/strict";
import test from "node:test";
import {
  loadEvidenceCollectionPolicy,
  loadRedactionPolicy,
  setRedactionEnabled,
  setSensitiveEvidenceConsent,
} from "./server-privacy-remote";

test("keeps privacy policy transport behind one typed boundary", async () => {
  const calls: Array<{ path: string; method?: string; body?: string }> = [];
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, method: init?.method, body: init?.body as string | undefined });
    return {
      policy: path.endsWith("evidence")
        ? { schemaVersion: 1, sensitive: {} }
        : { enabled: true, source: "workspace", locked: false },
    } as T;
  };

  await loadRedactionPolicy(request);
  await setRedactionEnabled(request, false);
  await loadEvidenceCollectionPolicy(request);
  await setSensitiveEvidenceConsent(request, "audio", true);

  assert.deepEqual(calls, [
    { path: "/settings/privacy", method: undefined, body: undefined },
    {
      path: "/settings/privacy",
      method: "PUT",
      body: JSON.stringify({ enabled: false }),
    },
    { path: "/settings/evidence", method: undefined, body: undefined },
    {
      path: "/settings/evidence",
      method: "PUT",
      body: JSON.stringify({
        channel: "audio",
        enabled: true,
        reason: "Enabled in Privacy & evidence settings",
      }),
    },
  ]);
});
