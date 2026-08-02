export type AgentState = "idle" | "running" | "stopping" | "complete" | "error";

export type AgentModelOption = {
  id: string;
  label: string;
  shortLabel: string;
  provider: string;
  model?: string;
};

export type AgentWorkerStatus = "queued" | "running" | "complete" | "error" | "stopped";

export type AgentWorker = {
  id: string;
  targetId: string;
  targetName: string;
  model: AgentModelOption;
  status: AgentWorkerStatus;
  stage: string;
  planner: "model" | "semantic";
  sessionId?: string;
  proposalId?: string;
  screens: number;
  interactions: number;
  error?: string;
};

export const AGENT_MODELS: readonly AgentModelOption[] = [
  {
    id: "relay",
    label: "Relay adaptive",
    shortLabel: "Relay",
    provider: "openrouter",
  },
  {
    id: "gpt",
    label: "GPT-4.1 mini",
    shortLabel: "GPT",
    provider: "openrouter",
    model: "openai/gpt-4.1-mini",
  },
  {
    id: "claude",
    label: "Claude Sonnet",
    shortLabel: "Claude",
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4",
  },
  {
    id: "gemini",
    label: "Gemini Flash",
    shortLabel: "Gemini",
    provider: "openrouter",
    model: "google/gemini-2.5-flash",
  },
];
