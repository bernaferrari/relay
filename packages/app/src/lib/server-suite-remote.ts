import type { JobInfo, SaveSuiteInput, SuiteRunManifest, TestSuite } from "./api-types";
import type { ServerRequest } from "./server-matrix-remote";

const path = (id: string) => `/suites/${encodeURIComponent(id)}`;

export async function listSuites(request: ServerRequest): Promise<TestSuite[]> {
  const data = await request<{ suites: TestSuite[] }>("/suites");
  return data.suites;
}

export async function saveSuite(request: ServerRequest, input: SaveSuiteInput): Promise<TestSuite> {
  const data = await request<{ suite: TestSuite }>(input.id ? path(input.id) : "/suites", {
    method: input.id ? "PUT" : "POST",
    body: JSON.stringify(input),
  });
  return data.suite;
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
  const data = await request<{ suite: TestSuite }>(`${path(id)}/restore`, {
    method: "POST",
    body: JSON.stringify({ updatedAt }),
  });
  return data.suite;
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
