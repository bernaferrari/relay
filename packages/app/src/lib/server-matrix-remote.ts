import type { CompatibilityMatrix, MatrixExpansion } from "@relay/protocol";

export type ServerRequest = <T = unknown>(
  path: string,
  init?: RequestInit,
  timeoutMs?: number,
) => Promise<T>;

export function saveMatrix(
  request: ServerRequest,
  input: { id: string; name: string; selectors: CompatibilityMatrix["selectors"] },
  replace: boolean,
): Promise<{ matrix: CompatibilityMatrix }> {
  return request<{ matrix: CompatibilityMatrix }>(
    replace ? `/matrices/${encodeURIComponent(input.id)}` : "/matrices",
    { method: replace ? "PUT" : "POST", body: JSON.stringify(input) },
  );
}

export function deleteMatrix(request: ServerRequest, id: string): Promise<void> {
  return request(`/matrices/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function resolveMatrix(request: ServerRequest, id: string): Promise<MatrixExpansion> {
  const data = await request<{ expansion: MatrixExpansion }>(
    `/matrices/${encodeURIComponent(id)}/resolve`,
    { method: "POST", body: "{}" },
  );
  return data.expansion;
}

export async function loadMatrixYaml(request: ServerRequest, id: string): Promise<string> {
  const data = await request<{ yaml: string }>(`/matrices/${encodeURIComponent(id)}/yaml`);
  return data.yaml;
}

export async function importMatrixYaml(
  request: ServerRequest,
  yaml: string,
  conflict: "reject" | "replace",
): Promise<CompatibilityMatrix> {
  const data = await request<{ matrix: CompatibilityMatrix }>("/matrices/import", {
    method: "POST",
    body: JSON.stringify({ yaml, conflict }),
  });
  return data.matrix;
}
