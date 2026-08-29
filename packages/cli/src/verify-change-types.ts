import type { OperationInput, VerificationPlan } from "@relay/protocol";
import type { OperationInvoker } from "./invoke.js";

/** Bounds shared by the reviewed-config planner and live Proof executor. */
export const VERIFY_CHANGE_MAX_CONFIG_BYTES = 4 * 1024 * 1024;
export const VERIFY_CHANGE_MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
export const VERIFY_CHANGE_MAX_CHANGED_FILES = 2_048;
export const VERIFY_CHANGE_MAX_ASSOCIATIONS = 2_048;
export const VERIFY_CHANGE_DEFAULT_POLL_INTERVAL_MS = 500;
export const VERIFY_CHANGE_DEFAULT_POLL_TIMEOUT_MS = 1_800_000;
export const VERIFY_CHANGE_MAX_POLL_TIMEOUT_MS = 86_400_000;
export const VERIFY_CHANGE_MAX_POLL_ATTEMPTS = 10_000;

export type VerifyChangeGitResult = { stdout: string; stderr?: string };

/** Adapter seam for bounded local Git calls. */
export type VerifyChangeGitRunner = (
  args: readonly string[],
  options: { cwd: string; maxBuffer: number },
) => Promise<VerifyChangeGitResult>;

/** Adapter seam for tests and callers that already have reviewed config data. */
export type VerifyChangeConfigReader = (path: string) => Promise<unknown> | unknown;

export type VerifyChangeActorKind = "human" | "agent" | "system";

export type VerifyChangeSleep = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export type VerifyChangeJobPoller = (
  client: OperationInvoker,
  jobId: string,
  options: {
    signal: AbortSignal;
    timeoutMs: number;
    intervalMs: number;
    sleep: VerifyChangeSleep;
    now: () => number;
  },
) => Promise<unknown>;

export type VerifyChangeCommandInput = {
  base: string;
  configFile: string;
  confirm: boolean;
  cwd?: string;
  readConfig?: VerifyChangeConfigReader;
  git?: VerifyChangeGitRunner;
  client?: OperationInvoker;
  signal?: AbortSignal;
  actorKind?: VerifyChangeActorKind;
  poll?: VerifyChangeJobPoller;
  sleep?: VerifyChangeSleep;
  now?: () => number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
};

export type VerifyChangeNextAction = {
  kind: "confirm" | "provide-build" | "review" | "approve-plan" | "run-pilot" | "complete";
  reason: string;
  command?: string;
};

export type VerifyChangePlanResult = {
  schemaVersion: 1;
  kind: "verify-change-plan";
  configFile: string;
  git: {
    repositoryRoot: string;
    baseRef: string;
    baseSha: string;
    headSha: string;
    changedFiles: readonly string[];
  };
  plan: VerificationPlan;
  proofStart: OperationInput<"proof.start">;
  proof?: unknown;
  proofStartResponse?: unknown;
  proofApprovalResponse?: unknown;
  execution: {
    confirmationRequired: true;
    confirmed: boolean;
    proofStarted: boolean;
    planApproved: boolean;
    pilot: {
      available: boolean;
      attempted: boolean;
      reason: string;
      targetCaseId?: string;
      runId?: string;
    };
    runs: readonly {
      appMapId: string;
      testId: string;
      targetCaseId: string;
      jobId: string;
      runId: string;
    }[];
    terminalState?: string;
    nextAction: VerifyChangeNextAction;
  };
  uncertainty: {
    coverageGaps: readonly unknown[];
    residualRisk: readonly string[];
  };
};
