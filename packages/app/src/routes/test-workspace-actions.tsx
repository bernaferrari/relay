/** @jsxImportSource react */
import { TestWorkspaceHeader } from "../components/test-workspace";
import { Button } from "@relay/ui-react/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@relay/ui-react/components/popover";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@relay/ui-react/components/dropdown-menu";
import { Link, useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown, ChevronLeft, MoreHorizontal, Play } from "lucide-react";
import type { MouseEvent, ReactNode, RefObject } from "react";

export function TestWorkspaceActions({
  testId,
  appMapId,
  testName,
  testPresent,
  inPlan,
  activeRun,
  attachedRunId,
  liveRunId,
  startPending,
  onOpenDetails,
  configurationLabel,
  configurationName,
  profileBlocked,
  onRun,
  settingsOpen,
  onSettingsOpen,
  configurationTriggerRef,
  runSettings,
  hasRecentRuns,
  onHistoryOpen,
}: {
  testId: string;
  appMapId?: string;
  testName?: string;
  testPresent: boolean;
  inPlan: boolean;
  activeRun: boolean;
  attachedRunId?: string;
  liveRunId?: string;
  startPending: boolean;
  onOpenDetails?(): void;
  configurationLabel: string;
  configurationName: string;
  profileBlocked: boolean;
  onRun(event: MouseEvent<HTMLButtonElement>): void;
  settingsOpen: boolean;
  onSettingsOpen(open: boolean | ((current: boolean) => boolean)): void;
  configurationTriggerRef: RefObject<HTMLButtonElement | null>;
  runSettings: ReactNode;
  hasRecentRuns: boolean;
  onHistoryOpen(): void;
}) {
  const { testEditorService } = useRouteContext({ from: "__root__" });
  const [copied, setCopied] = useState<"copied" | "failed">();
  // A Test is also a small file people keep in their repo and agents edit.
  async function copyFile() {
    try {
      const yaml = await testEditorService.getYaml!(testId, appMapId);
      await navigator.clipboard.writeText(yaml);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }
  return (
    <TestWorkspaceHeader
      title={testName ?? "Test"}
      context={
        !inPlan ? (
          <Link
            to="/tests"
            search={{ app: appMapId }}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden="true" /> Tests
          </Link>
        ) : undefined
      }
      actions={
        <>
          {/* Recording more steps lives in the step list's Add step menu. */}
          {activeRun && (liveRunId || attachedRunId) ? (
            <Button
              nativeButton={false}
              render={<Link to="/runs/$runId" params={{ runId: (liveRunId ?? attachedRunId)! }} />}
              size="sm"
            >
              View live run
            </Button>
          ) : (
            // One split button: run now, or open the chevron to choose where it runs.
            <div
              className="flex items-center *:data-[slot=button]:first:rounded-e-none *:data-[slot=button]:last:rounded-s-none"
              role="group"
              aria-label="Run"
            >
              <Button
                size="sm"
                onClick={onRun}
                disabled={startPending}
                title={configurationLabel}
                aria-description={configurationLabel}
              >
                <Play aria-hidden="true" />
                {startPending ? "Starting…" : profileBlocked ? "Fix setup" : "Run"}
              </Button>
              {testPresent ? (
                <Popover open={settingsOpen} onOpenChange={onSettingsOpen}>
                  <PopoverTrigger
                    // Outline, so Run stays the one filled action in the header.
                    render={<Button ref={configurationTriggerRef} size="sm" variant="outline" />}
                    aria-label={`Run settings: ${configurationName}`}
                    aria-description={`Run settings: ${configurationLabel}`}
                    title={configurationLabel}
                  >
                    {/* Where it runs stays visible: the target is part of the decision. */}
                    {configurationName !== "Run settings" ? (
                      <>
                        <span className="sr-only">Run on</span>
                        <span className="max-w-56 truncate font-normal opacity-90">
                          {configurationName}
                        </span>
                      </>
                    ) : null}
                    <ChevronDown aria-hidden="true" />
                  </PopoverTrigger>
                  <PopoverContent
                    finalFocus={configurationTriggerRef}
                    align="end"
                    className="max-h-[min(640px,80dvh)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
                    aria-label="Run settings"
                  >
                    {runSettings}
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>
          )}
          {testPresent || attachedRunId || hasRecentRuns ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" />}
                aria-label="More test actions"
              >
                <MoreHorizontal aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {attachedRunId ? (
                  <DropdownMenuItem
                    render={<Link to="/runs/$runId" params={{ runId: attachedRunId }} />}
                  >
                    Review result
                  </DropdownMenuItem>
                ) : null}
                {hasRecentRuns ? (
                  <DropdownMenuItem onClick={() => onHistoryOpen()}>Run history</DropdownMenuItem>
                ) : null}
                {testPresent && testEditorService.getYaml ? (
                  <DropdownMenuItem onClick={() => void copyFile()}>
                    {copied === "copied"
                      ? "Copied test file"
                      : copied === "failed"
                        ? "Couldn’t copy test file"
                        : "Copy as test file (YAML)"}
                  </DropdownMenuItem>
                ) : null}
                {testPresent && onOpenDetails ? (
                  <DropdownMenuItem onClick={() => onOpenDetails()}>
                    Name and details
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </>
      }
    />
  );
}
