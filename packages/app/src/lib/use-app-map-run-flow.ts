import type { Accessor } from "solid-js";
import type { AppMap, Flow } from "@relay/protocol";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { humanError } from "./human-error";
import type { AppMapRunTarget } from "./app-map-run-readiness";

/** Starts a verified App Map flow on the selected device. */
export function useAppMapRunFlow(options: {
  activeAppMap: Accessor<AppMap | undefined>;
  runnableFlow: Accessor<Flow | undefined>;
  transitionPath: Accessor<readonly string[] | null | undefined>;
  onRunStarting?: () => void;
}) {
  const server = useServer();

  const runCanvasGraph = async (target?: AppMapRunTarget) => {
    const appMap = options.activeAppMap();
    const flow = target?.flow ?? options.runnableFlow();
    const transitionPath = target?.transitionPath ?? options.transitionPath();
    if (!appMap || !flow) {
      toast("Record and keep at least one path on the map, then run it", "info");
      return;
    }
    const serial = server.selectedDevice();
    if (!serial) {
      toast("Choose a device before running the path", "info");
      return;
    }
    await server.setSelectedDevice(serial);
    if (!server.selectedLeaseId()) {
      toast(
        humanError(
          server.controlIssue() ||
            server.liveCaptureIssue() ||
            "This device is not ready to control yet",
        ),
        "warning",
      );
      return;
    }
    const throughConnectionId =
      transitionPath?.length && transitionPath.length < flow.connectionIds.length
        ? transitionPath.at(-1)
        : undefined;
    options.onRunStarting?.();
    await server.runAppMapFlowRemote(
      appMap.id,
      flow.id,
      target?.title ?? flow.name,
      throughConnectionId,
    );
  };

  return { runCanvasGraph };
}
