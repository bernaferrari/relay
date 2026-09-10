import { workspaceToolsSurface } from "../components/workspace-surfaces";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import type { ReactNode } from "react";
import { Button } from "@relay/ui-react/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@relay/ui-react/components/popover";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { AuthoringWorkspace } from "./authoring-workspace";

export function SavedTestWorkspace({
  stage,
  outline,
  inspector,
  settingsOpen,
  onSettingsOpenChange,
  deviceName,
}: {
  stage: ReactNode;
  outline: ReactNode;
  inspector?: ReactNode;
  settingsOpen: boolean;
  onSettingsOpenChange(open: boolean): void;
  deviceName?: string;
}) {
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
                render={
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start gap-2 rounded-none px-4 py-3 text-sm"
                  />
                }
              >
                <SlidersHorizontal className="size-4 text-muted-foreground" />
                <span>Run settings</span>
                <span className="ml-auto max-w-[45%] truncate text-xs font-normal text-muted-foreground">
                  {deviceName}
                </span>
                <ChevronDown
                  className={`size-3.5 text-muted-foreground ${settingsOpen ? "rotate-180" : ""}`}
                />
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
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
