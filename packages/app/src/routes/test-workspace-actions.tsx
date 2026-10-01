/** @jsxImportSource react */
import { TestWorkspaceHeader } from "../components/test-workspace";
import { Button } from "@relay/ui-react/components/button";
import { Popover, PopoverContent } from "@relay/ui-react/components/popover";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@relay/ui-react/components/dropdown-menu";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Circle, MoreHorizontal, Play, SlidersHorizontal } from "lucide-react";
import type { MouseEvent, ReactNode, RefObject } from "react";

export function TestWorkspaceActions({
  testId,
  appMapId,
  testName,
  testPresent,
  inPlan,
  activeRun,
  attachedRunId,
  recordDisabled,
  recordPending,
  recordStepSelected,
  onRecord,
  startPending,
  configurationLabel,
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
  recordDisabled: boolean;
  recordPending: boolean;
  recordStepSelected: boolean;
  onRecord(): void;
  startPending: boolean;
  configurationLabel: string;
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
          {activeRun && attachedRunId ? (
            <Button
              nativeButton={false}
              render={<Link to="/runs/$runId" params={{ runId: attachedRunId }} />}
              size="sm"
            >
              View live run
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <Button size="sm" onClick={onRun} disabled={startPending} title={configurationLabel}>
                <Play aria-hidden="true" />
                {startPending ? "Starting…" : profileBlocked ? "Fix setup" : "Run"}
              </Button>
            </div>
          )}
          {testPresent || attachedRunId || hasRecentRuns ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                ref={configurationTriggerRef}
                render={<Button variant="ghost" size="icon-sm" />}
                aria-label="More Test actions"
                title={configurationLabel}
              >
                <MoreHorizontal aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {!activeRun && testPresent ? (
                  <>
                    <DropdownMenuItem onClick={() => onSettingsOpen(true)}>
                      <SlidersHorizontal aria-hidden="true" /> Run settings
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      render={
                        <Link
                          to="/tests/$testId/run-across"
                          params={{ testId }}
                          search={{ app: appMapId }}
                        />
                      }
                    >
                      Run across…
                    </DropdownMenuItem>
                  </>
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
          <Popover open={settingsOpen} onOpenChange={onSettingsOpen}>
            <PopoverContent
              anchor={configurationTriggerRef}
              finalFocus={configurationTriggerRef}
              align="end"
              className="max-h-[min(640px,80dvh)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
              aria-label="Run settings"
            >
              {runSettings}
            </PopoverContent>
          </Popover>
        </>
      }
    />
  );
}
