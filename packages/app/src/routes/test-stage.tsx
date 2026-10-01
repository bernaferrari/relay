/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useState, type ComponentProps, type ReactNode } from "react";
import type { ProductTestStep } from "@relay/product/catalog";
import type { ProductTargetOption } from "../data/target-presentation";
import { TestStepEvidencePreview } from "../components/test-step-evidence-preview";
import { TestLastRunStage } from "./test-last-run";
import { TestDevicePane } from "./test-device-pane";
import { TestEditorBrowserPane } from "./test-editor-browser-pane";

/** Keep recorded evidence and the matching live target together in the preview pane. */
export function TestWorkspaceStage({
  step,
  lastRun,
  deviceTest,
  target,
  browser,
  onDeviceBusyChange,
}: {
  step?: ProductTestStep;
  lastRun: ComponentProps<typeof TestLastRunStage>["run"];
  deviceTest: boolean;
  target?: ProductTargetOption;
  browser?: ComponentProps<typeof TestEditorBrowserPane>;
  onDeviceBusyChange(busy: boolean): void;
}) {
  return (
    <TestStage
      key={deviceTest ? "device" : "browser"}
      liveLabel={deviceTest ? "Live device" : "Live browser"}
      recorded={
        step?.recordingFrames?.length ? (
          <TestStepEvidencePreview
            key={step.id}
            step={step}
            report={undefined}
            hasRuns={false}
            loading={false}
          />
        ) : (
          <TestLastRunStage run={lastRun} />
        )
      }
      live={
        deviceTest ? (
          target?.kind === "device" ? (
            <TestDevicePane target={target} onBusyChange={onDeviceBusyChange} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              Connect the recorded device to open its live view.
            </div>
          )
        ) : browser ? (
          <TestEditorBrowserPane {...browser} />
        ) : null
      }
    />
  );
}

/** The app beside the steps: the recorded screenshot, or its live device or browser. */
export function TestStage({
  recorded,
  live,
  liveLabel = "Live browser",
}: {
  recorded: ReactNode;
  live: ReactNode;
  liveLabel?: string;
}) {
  const [mode, setMode] = useState<"recorded" | "live">("recorded");
  const [liveOpened, setLiveOpened] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col bg-stage">
      <div
        className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2"
        role="tablist"
        aria-label="App view"
      >
        {(
          [
            ["recorded", "Screenshot"],
            ["live", liveLabel],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            role="tab"
            size="sm"
            variant={mode === value ? "secondary" : "ghost"}
            aria-selected={mode === value}
            disabled={value === "live" && !live}
            onClick={() => {
              setMode(value);
              if (value === "live") setLiveOpened(true);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className={mode === "recorded" ? "min-h-0 flex-1 overflow-auto" : "hidden"}>
        {recorded}
      </div>
      {liveOpened ? (
        <div className={mode === "live" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>{live}</div>
      ) : null}
    </div>
  );
}
