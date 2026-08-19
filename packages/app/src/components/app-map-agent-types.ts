export type AgentState = "idle" | "running" | "stopping" | "complete" | "error";
export type AgentStrategy = "divide" | "compare";

export type AgentWorkerStatus = "queued" | "running" | "complete" | "error" | "stopped";

export type AgentWorker = {
  id: string;
  targetId: string;
  targetName: string;
  focus?: string;
  actionBudget: number;
  status: AgentWorkerStatus;
  stage: string;
  sessionId?: string;
  proposalId?: string;
  screens: number;
  interactions: number;
  error?: string;
};
