import assert from "node:assert/strict";
import test from "node:test";
import type { RelayClient } from "@relay/client";
import { deleteMatrix, loadMatrixYaml, resolveMatrix, saveMatrix } from "./server-matrix-remote";

test("registered matrix actions invoke operation ids while YAML remains an immutable resource", async () => {
  const calls: Array<{ kind: "invoke" | "resource"; id: string; input?: unknown }> = [];
  const client = {
    invoke: async (id: string, input: unknown) => {
      calls.push({ kind: "invoke", id, input });
      if (id === "matrix.resolve") return { expansion: { profiles: [], excluded: [] } };
      return { matrix: { id: "smoke", name: "Smoke", selectors: [] } };
    },
    resource: async (path: string) => {
      calls.push({ kind: "resource", id: path });
      return { yaml: "schemaVersion: 1" };
    },
  } as unknown as RelayClient;

  await saveMatrix(client, { id: "smoke", name: "Smoke", selectors: [] }, false);
  await resolveMatrix(client, "smoke");
  await loadMatrixYaml(client, "smoke");
  await deleteMatrix(client, "smoke");

  assert.deepEqual(calls, [
    {
      kind: "invoke",
      id: "matrix.create",
      input: { id: "smoke", name: "Smoke", selectors: [] },
    },
    { kind: "invoke", id: "matrix.resolve", input: { matrixId: "smoke" } },
    { kind: "resource", id: "/matrices/smoke/yaml" },
    { kind: "invoke", id: "matrix.delete", input: { matrixId: "smoke" } },
  ]);
});
