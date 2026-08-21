import type { AppMapCombineCellTargetBinding } from "@relay/protocol";
import type { LocalCombineTargetOption } from "../lib/app-map-combine-targets";
import { LocalExecutionTargetPicker } from "./local-execution-target-picker";

/**
 * Target selection is deliberately a separate control from the saved runtime
 * profile. The profile proves what was compiled; this picker says where the
 * accepted work may execute. It only renders attached local Android/iOS
 * lanes, never a made-up cloud/provider capacity option.
 */
export function AppMapCombineTargetPicker(props: {
  testName: string;
  worldLabel: string;
  targets: readonly LocalCombineTargetOption[];
  binding?: AppMapCombineCellTargetBinding;
  busy?: boolean;
  onBind: (target?: LocalCombineTargetOption["target"]) => void;
}) {
  return (
    <LocalExecutionTargetPicker
      label={`Local execution target for ${props.testName} in ${props.worldLabel}`}
      targets={props.targets}
      target={props.binding?.target.kind === "local-device" ? props.binding.target : undefined}
      busy={props.busy}
      statusNamespace="combine"
      onBind={props.onBind}
    />
  );
}
