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
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, Circle, MoreHorizontal, Play } from "lucide-react";
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
  recordDisabled,
  recordPending,
  recordStepSelected,
  onRecord,
  startPending,
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
  recordDisabled: boolean;
  recordPending: boolean;
  recordStepSelected: boolean;
  onRecord(): void;
  startPending: boolean;
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
          {testPresent && !activeRun ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRecord()}
              disabled={recordDisabled}
              title={
                recordStepSelected
                  ? "Record new steps after the selected step"
                  : "Record new steps at the end"
              }
            >
              <Circle className="fill-destructive text-destructive" aria-hidden="true" />
              {recordPending ? "Starting…" : "Record steps"}
            </Button>
          ) : null}
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
              className="flex items-center *:data-[slot=button]:first:rounded-e-none *:data-[slot=button]:last:rounded-s-none *:data-[slot=button]:last:border-s-primary-foreground/25"
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
                    render={<Button ref={configurationTriggerRef} size="sm" />}
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
                {!activeRun && testPresent ? (
                  <DropdownMenuItem
                    render={
                      <Link
                        to="/tests/$testId/run-across"
                        params={{ testId }}
                        search={{ app: appMapId }}
                      />
                    }
                  >
                    Run with different data or devices…
                  </DropdownMenuItem>
                ) : null}
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
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </>
      }
    />
  );
}
