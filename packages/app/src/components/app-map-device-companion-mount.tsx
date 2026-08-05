import type { Accessor } from "solid-js";
import type { CanvasConnection } from "../lib/app-map-connection-draft";
import type { MapTreeNode } from "../lib/app-map-tree";
import { useRecorder } from "../context/recorder";
import { AppMapDeviceCompanion } from "./app-map-device-companion";

export function AppMapDeviceCompanionMount(props: {
  closing: boolean;
  deviceSelected: boolean;
  deviceLabel?: string;
  status: Parameters<typeof AppMapDeviceCompanion>[0]["status"];
  captureBusy: boolean;
  canRecord: boolean;
  hasCanvasContent: boolean;
  selectedConnection: Accessor<CanvasConnection | null>;
  selectedNode: Accessor<MapTreeNode | null>;
  nodes: Accessor<MapTreeNode[]>;
  titleFor: (node: MapTreeNode) => string;
  captureContextLabel?: string;
  onClose: () => void;
  onOpenTargets: () => void;
  onRecordFromHere: () => void;
  onRecordConnection: (connection: CanvasConnection) => void;
  onOrientation: (orientation: "portrait" | "landscape" | "square" | "unknown") => void;
}) {
  const recorder = useRecorder();
  const selectedConnection = () => props.selectedConnection();
  const selectedNode = () => props.selectedNode();

  const recordContextLabel = () => {
    const connection = selectedConnection();
    if (connection) {
      const source = props.nodes().find((node) => node.id === connection.fromScreenId);
      const target = props.nodes().find((node) => node.id === connection.toScreenId);
      return source && target ? `${props.titleFor(source)} → ${props.titleFor(target)}` : undefined;
    }
    const node = selectedNode();
    return node ? `From ${props.titleFor(node)}` : undefined;
  };

  return (
    <AppMapDeviceCompanion
      closing={props.closing}
      deviceSelected={props.deviceSelected}
      deviceLabel={props.deviceLabel}
      status={props.status}
      recording={recorder.recording()}
      take={recorder.take()}
      arming={recorder.arming()}
      captureBusy={props.captureBusy}
      canRecord={props.canRecord}
      recordLabel={
        recorder.arming() || props.captureBusy
          ? "Preparing…"
          : !props.hasCanvasContent
            ? "Start recording"
            : selectedConnection()
              ? selectedConnection()!.state === "needs-recording"
                ? "Record"
                : "Rewrite"
              : "Record"
      }
      recordContextLabel={recordContextLabel()}
      captureContextLabel={props.captureContextLabel}
      onClose={props.onClose}
      onOpenTargets={props.onOpenTargets}
      onRecord={() => {
        if (!props.hasCanvasContent) {
          // A first recording already observes both sides of the
          // transition. Let that single action create the entry screen,
          // destination, and connection; screenshot-only capture remains
          // available from the camera tool.
          props.onRecordFromHere();
          return;
        }
        const connection = selectedConnection();
        if (connection) {
          props.onRecordConnection(connection);
          return;
        }
        props.onRecordFromHere();
      }}
      onStop={() => void recorder.stopRecording()}
      onOrientation={props.onOrientation}
    />
  );
}
