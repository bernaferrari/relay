import type { RelayClient } from "@relay/client";
import type { CompatibilityMatrix, MatrixExpansion, OperationInput } from "@relay/protocol";

type MatrixClient = Pick<RelayClient, "invoke">;

export async function saveMatrix(
  client: MatrixClient,
  input: { id: string; name: string; selectors: CompatibilityMatrix["selectors"] },
  replace: boolean,
): Promise<{ matrix: CompatibilityMatrix }> {
  if (replace) {
    return client.invoke("matrix.update", {
      matrixId: input.id,
      name: input.name,
      selectors: input.selectors,
    } satisfies OperationInput<"matrix.update">);
  }
  return client.invoke("matrix.create", {
    id: input.id,
    name: input.name,
    selectors: input.selectors,
  } satisfies OperationInput<"matrix.create">);
}

export async function deleteMatrix(client: MatrixClient, id: string): Promise<void> {
  await client.invoke("matrix.delete", { matrixId: id });
}

export async function resolveMatrix(client: MatrixClient, id: string): Promise<MatrixExpansion> {
  const data = await client.invoke("matrix.resolve", { matrixId: id });
  return data.expansion;
}

export async function loadMatrixYaml(client: RelayClient, id: string): Promise<string> {
  const data = await client.resource<{ yaml: string }>(
    `/matrices/${encodeURIComponent(id)}/yaml`,
  );
  return data.yaml;
}

export async function importMatrixYaml(
  client: MatrixClient,
  yaml: string,
  conflict: "reject" | "replace",
): Promise<CompatibilityMatrix> {
  const data = await client.invoke("matrix.import", { yaml, conflict });
  return data.matrix;
}
