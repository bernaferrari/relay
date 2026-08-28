import { createSimpleContext } from "@relay/ui/context/helper";
import { createWorkspaceController } from "../lib/workspace-controller";

/** One controller per mounted Relay interface, shared by providers and chrome. */
export const { use: useWorkspaceController, provider: WorkspaceControllerProvider } =
  createSimpleContext({
    name: "WorkspaceController",
    gate: false,
    init: createWorkspaceController,
  });
