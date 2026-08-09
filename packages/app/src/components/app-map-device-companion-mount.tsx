import { useRecorder } from "../context/recorder";
import { AppMapDeviceCompanion } from "./app-map-device-companion";

export function AppMapDeviceCompanionMount(props: {
  closing: boolean;
  deviceSelected: boolean;
  deviceLabel?: string;
  status: Parameters<typeof AppMapDeviceCompanion>[0]["status"];
  unmapped: boolean;
  mappedScreenName?: string;
  captureBusy: boolean;
  canRecord: boolean;
  mapName?: string;
  captureContextLabel?: string;
  onClose: () => void;
  onOpenTargets: () => void;
  onSaveScreen: () => void;
  onRecord: () => void;
  onOrientation: (orientation: "portrait" | "landscape" | "square" | "unknown") => void;
}) {
  const recorder = useRecorder();

  return (
    <AppMapDeviceCompanion
      closing={props.closing}
      deviceSelected={props.deviceSelected}
      deviceLabel={props.deviceLabel}
      status={props.status}
      recording={recorder.recording()}
      take={recorder.take()}
      unmapped={props.unmapped}
      mappedScreenName={props.mappedScreenName}
      captureBusy={props.captureBusy}
      canRecord={props.canRecord}
      mapName={props.mapName}
      captureContextLabel={props.captureContextLabel}
      onClose={props.onClose}
      onOpenTargets={props.onOpenTargets}
      onSaveScreen={props.onSaveScreen}
      onRecord={props.onRecord}
      onStop={() => void recorder.stopRecording()}
      onOrientation={props.onOrientation}
    />
  );
}
