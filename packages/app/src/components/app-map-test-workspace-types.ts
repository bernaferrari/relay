import type { WorkspaceController } from "../lib/workspace-controller";

export type AppMapTestWorkspaceProps = {
  testId?: string;
  onTestChange?: (testId: string) => void;
  onOpenRun?: (runId: string) => void;
  onChooseTarget?: () => void;
  onOpenTarget?: () => void;
  onOpenVariables?: () => void;
  onRecord?: () => void;
  workspaceController?: WorkspaceController;
};
