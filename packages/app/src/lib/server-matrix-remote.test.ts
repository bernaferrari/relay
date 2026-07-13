import assert from "node:assert/strict";
import test from "node:test";
import { deleteMatrix, loadMatrixYaml, resolveMatrix, saveMatrix } from "./server-matrix-remote";

test("builds matrix endpoints through the shared request boundary", async () => {
  const calls: Array<{ path: string; method?: string }> = [];
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, method: init?.method });
    if (path.endsWith("/resolve")) return { expansion: { profiles: [], excluded: [] } } as T;
    if (path.endsWith("/yaml")) return { yaml: "schemaVersion: 1" } as T;
    return { matrix: { id: "smoke", name: "Smoke", selectors: [] } } as T;
  };
  await saveMatrix(request, { id: "smoke", name: "Smoke", selectors: [] }, false);
  await resolveMatrix(request, "smoke");
  await loadMatrixYaml(request, "smoke");
  await deleteMatrix(request, "smoke");
  assert.deepEqual(
    calls.map((call) => `${call.method ?? "GET"} ${call.path}`),
    [
      "POST /matrices",
      "POST /matrices/smoke/resolve",
      "GET /matrices/smoke/yaml",
      "DELETE /matrices/smoke",
    ],
  );
});
