import type { AppMapPrimaryAction } from "./app-map-primary-action";

export type AppMapPrimaryActionControl = {
  label: string;
  disabled: boolean;
  describedBy?: string;
  reason: string;
  activate: () => void;
};

export function appMapPrimaryActionControl(
  action: AppMapPrimaryAction,
  activate: () => void,
  reasonId = "app-map-primary-action-reason",
): AppMapPrimaryActionControl {
  const reason = action.reason.trim();
  return {
    label: action.label,
    disabled: action.kind === "blocked",
    ...(reason ? { describedBy: reasonId } : {}),
    reason,
    activate,
  };
}
