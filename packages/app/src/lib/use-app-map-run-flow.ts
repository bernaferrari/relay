import type { Accessor } from "solid-js";
import type { AppMap, Flow } from "@relay/protocol";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { humanError } from "./human-error";

/** Starts a verified App Map flow on the selected device. */
export function useAppMapRunFlow(options: {
  activeAppMap: Accessor<AppMap | undefined>;
  runnableFlow: Accessor<Flow | undefined>;
}) {
  const server = useServer();

  const runCanvasGraph = async () => {
    const appMap = options.activeAppMap();
    const flow = options.runnableFlow();
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
    await server.runAppMapFlowRemote(appMap.id, flow.id, flow.name);
  };

  return { runCanvasGraph };
}
