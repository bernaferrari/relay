import assert from "node:assert/strict";
import test from "node:test";
import { loadRedactionPolicy, setRedactionEnabled } from "./server-privacy-remote";

test("keeps privacy policy transport behind one typed boundary", async () => {
  const calls: Array<{ path: string; method?: string; body?: string }> = [];
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, method: init?.method, body: init?.body as string | undefined });
    return { policy: { enabled: true, source: "workspace", locked: false } } as T;
  };

  await loadRedactionPolicy(request);
  await setRedactionEnabled(request, false);

  assert.deepEqual(calls, [
    { path: "/settings/privacy", method: undefined, body: undefined },
    {
      path: "/settings/privacy",
      method: "PUT",
      body: JSON.stringify({ enabled: false }),
    },
  ]);
});
