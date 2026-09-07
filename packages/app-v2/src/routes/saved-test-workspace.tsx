import type { ReactNode } from "react";
import { Button } from "@relay/ui-react/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
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
        <div className="flex h-full min-h-0 flex-col rounded-lg bg-card">
          <div className="min-h-0 flex-1 overflow-y-auto">{outline}</div>
          {inspector ? (
            <Collapsible
              open={settingsOpen}
              onOpenChange={onSettingsOpenChange}
              className="shrink-0 border-t border-border/50"
            >
              <CollapsibleTrigger
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
              </CollapsibleTrigger>
              <CollapsibleContent className="max-h-[50vh] overflow-y-auto">
                {inspector}
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      }
    />
  );
}
