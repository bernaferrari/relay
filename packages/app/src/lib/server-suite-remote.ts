import type { JobInfo, SaveSuiteInput, SuiteRunManifest, TestSuite } from "./api-types";
import type { ServerRequest } from "./server-matrix-remote";

const path = (id: string) => `/collections/${encodeURIComponent(id)}`;

export async function listSuites(request: ServerRequest): Promise<TestSuite[]> {
  const data = await request<{ collections: TestSuite[] }>("/collections");
  return data.collections;
}

export async function saveSuite(request: ServerRequest, input: SaveSuiteInput): Promise<TestSuite> {
  const data = await request<{ collection: TestSuite }>(
    input.id ? path(input.id) : "/collections",
    {
      method: input.id ? "PUT" : "POST",
      body: JSON.stringify(input),
    },
  );
  return data.collection;
}

export async function deleteSuite(request: ServerRequest, id: string): Promise<void> {
  await request(path(id), { method: "DELETE" });
}

export async function loadSuiteHistory(request: ServerRequest, id: string): Promise<TestSuite[]> {
  const data = await request<{ history: TestSuite[] }>(`${path(id)}/history`);
  return data.history;
}

export async function restoreSuite(
  request: ServerRequest,
  id: string,
  updatedAt: number,
): Promise<TestSuite> {
  const data = await request<{ collection: TestSuite }>(`${path(id)}/restore`, {
    method: "POST",
    body: JSON.stringify({ updatedAt }),
  });
  return data.collection;
}

export async function runSuite(
  request: ServerRequest,
  id: string,
  target: {
    serial?: string;
    platform?: "android" | "ios";
    targetKind?: "device" | "browser";
    browserTargetId?: string;
  },
): Promise<{ manifest: SuiteRunManifest; jobs: JobInfo[] }> {
  return request(`${path(id)}/run`, {
    method: "POST",
    body: JSON.stringify(target),
  });
}
