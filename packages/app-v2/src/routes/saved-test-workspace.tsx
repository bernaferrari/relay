import { workspaceToolsSurface } from "../components/workspace-surfaces";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { useRef, type ReactNode } from "react";
import { Button } from "@relay/ui-react/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@relay/ui-react/components/popover";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { AuthoringWorkspace } from "./authoring-workspace";

export function SavedTestWorkspace({
  stage,
  outline,
  inspector,
  settingsAnchor,
  onSettingsAnchorChange,
  settingsOpen,
  onSettingsOpenChange,
  deviceName,
}: {
  stage: ReactNode;
  outline: ReactNode;
  inspector?: ReactNode;
  settingsAnchor?: HTMLElement | null;
  onSettingsAnchorChange?(anchor: HTMLElement | null): void;
  settingsOpen: boolean;
  onSettingsOpenChange(open: boolean): void;
  deviceName?: string;
}) {
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  return (
    <AuthoringWorkspace
      stage={stage}
      tools={
        <div className={`h-full ${workspaceToolsSurface}`}>
          <ScrollArea
            className="min-h-0 flex-1"
            viewportProps={{ "aria-label": "Test steps", className: "overscroll-auto" }}
          >
            {outline}
          </ScrollArea>
          {inspector ? (
            <Popover open={settingsOpen} onOpenChange={onSettingsOpenChange}>
              <PopoverTrigger
                ref={settingsTriggerRef}
                onClick={() => onSettingsAnchorChange?.(null)}
                render={<Button variant="ghost" className="h-auto w-full justify-start" />}
              >
                <SlidersHorizontal className="size-4 text-muted-foreground" />
                <span>Run settings</span>
                <span className="ml-auto max-w-[45%] truncate text-sidebar-foreground text-xs font-normal">
                  {deviceName}
                </span>
                <ChevronDown
                  className={`size-3.5 text-muted-foreground ${settingsOpen ? "rotate-180" : ""}`}
                />
              </PopoverTrigger>
              <PopoverContent
                anchor={settingsAnchor ?? undefined}
                finalFocus={() => settingsAnchor ?? settingsTriggerRef.current}
                side={settingsAnchor ? "bottom" : "top"}
                align={settingsAnchor ? "start" : "end"}
                className="max-h-[min(640px,80dvh)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
                aria-label="Run settings"
              >
                {inspector}
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      }
    />
  );
}
