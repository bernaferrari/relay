import type { AppMapPrimaryAction } from "./app-map-primary-action";

export type AppMapPrimaryActionControl = {
  label: string;
  blocked: boolean;
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
  const blocked = action.kind === "blocked";
  return {
    label: action.label,
    blocked,
    ...(reason ? { describedBy: reasonId } : {}),
    reason,
    activate: () => {
      if (!blocked) activate();
    },
  };
}
