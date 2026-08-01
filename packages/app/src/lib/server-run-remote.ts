import type { MatrixExpansion } from "@relay/protocol";
import type { CompatibilityReport, JobInfo } from "./api-types";
import type { ServerRequest } from "./server-matrix-remote";

export type RunRecipeInput = {
  recipe: string;
  serial?: string;
  targetKind: "browser" | "device";
  browserTargetId?: string;
  platform?: string;
  repetitions: number;
  projectId: string;
  prodAccountMatch?: string;
};

export async function enqueueRecipe(
  request: ServerRequest,
  input: RunRecipeInput,
): Promise<{ jobs: JobInfo[]; matrix: { id: string } }> {
  return request<{ jobs: JobInfo[]; matrix: { id: string } }>("/jobs/matrix", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function enqueueJourneyGraphPath(
  request: ServerRequest,
  input: {
    recipe: string;
    flowName: string;
    transitionPath?: string[];
    serial?: string;
    targetKind: "browser" | "device";
    browserTargetId?: string;
    platform?: string;
  },
): Promise<{ job: JobInfo }> {
  return request<{ job: JobInfo }>("/jobs/graph-path", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function enqueueMatrix(
  request: ServerRequest,
  input: {
    recipe: string;
    matrixId: string;
    repetitions: number;
    prodAccountMatch?: string;
    flowName?: string;
    transitionPath?: string[];
  },
): Promise<{ jobs: JobInfo[]; matrix: MatrixExpansion }> {
  return request<{ jobs: JobInfo[]; matrix: MatrixExpansion }>("/jobs/compatibility-matrix", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function loadMatrixReport(
  request: ServerRequest,
  batchId: string,
): Promise<CompatibilityReport> {
  const data = await request<{ report: CompatibilityReport }>(
    `/reports/matrix/${encodeURIComponent(batchId)}`,
  );
  return data.report;
}

export async function retryJob(request: ServerRequest, jobId: string): Promise<JobInfo> {
  const data = await request<{ job: JobInfo }>(`/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
    body: "{}",
  });
  return data.job;
}
