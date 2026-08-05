import type { Accessor } from "solid-js";
import type { AppMap, Flow } from "@relay/protocol";
import { useServer } from "../context/server";
import { toast } from "../context/toast";

/** Starts a verified flow run and the screenshot-refresh convenience path. */
export function useAppMapRunFlow(options: {
  activeAppMap: Accessor<AppMap | undefined>;
  runnableFlow: Accessor<Flow | undefined>;
  graphRunReadiness: Accessor<{ ready: boolean; reason?: string }>;
}) {
  const server = useServer();

  const runCanvasGraph = async () => {
    const appMap = options.activeAppMap();
    const flow = options.runnableFlow();
    if (!appMap || !flow) {
      toast("Add and verify a connection before running this flow", "info");
      return;
    }
    const serial = server.selectedDevice();
    if (!serial) {
      toast("Choose a device before running this flow", "info");
      return;
    }
    await server.setSelectedDevice(serial);
    if (!server.selectedLeaseId()) {
      toast(
        server.controlIssue() ||
          server.liveCaptureIssue() ||
          "This device is not available for control yet",
        "warning",
      );
      return;
    }
    await server.runAppMapFlowRemote(appMap.id, flow.id, flow.name);
  };

  const refreshMapScreenshots = () => {
    if (!options.graphRunReadiness().ready) {
      toast(
        options.graphRunReadiness().reason ?? "Finish the flow before refreshing screenshots",
        "info",
      );
      return;
    }
    toast("Replaying the flow to capture fresh screenshots", "info");
    void runCanvasGraph();
  };

  return { runCanvasGraph, refreshMapScreenshots };
}
