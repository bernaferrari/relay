/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Circle } from "lucide-react";
import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";
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
          <TestEditorBrowserPane {...browser} autoOpen />
        ) : null
      }
    />
  );
}

export type StageMode = "recorded" | "live";

/**
 * The stage shows the selected step's screenshot. Live app is a mode you enter
 * with intent ("Record more steps"), never a toggle without a purpose. On narrow
 * windows the page's own switcher picks the view, so the stage drops its bar.
 */
export const StageModeContext = createContext<{
  mode: StageMode;
  setMode(mode: StageMode): void;
  /** Present while staging new steps: drive the app, then start recording. */
  recording?: { start(): void; ready: boolean; pending: boolean };
} | null>(null);

export function TestStage({
  recorded,
  live,
  liveLabel = "Live browser",
}: {
  recorded: ReactNode;
  live: ReactNode;
  liveLabel?: string;
}) {
  const shared = useContext(StageModeContext);
  const [localMode, setLocalMode] = useState<StageMode>("recorded");
  const mode = shared?.mode ?? localMode;
  const setMode = shared?.setMode ?? setLocalMode;
  const recording = shared?.recording;
  return (
    <div className="flex h-full min-h-0 flex-col bg-stage">
      {mode === "live" ? (
        <div
          role="region"
          aria-label={`${liveLabel}: get ready to record`}
          className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-3 py-2"
        >
          <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
            <span className="absolute size-full animate-ping rounded-full bg-success/50 [animation-duration:2s] motion-reduce:hidden" />
            <span className="relative size-2.5 rounded-full bg-success" />
          </span>
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">Get the app to where the new steps start.</span>{" "}
            <span className="text-muted-foreground">
              {recording && !recording.ready
                ? "Opening the app…"
                : "Nothing is recorded until you press Start."}
            </span>
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setMode("recorded")}>
              Cancel
            </Button>
            {recording ? (
              <Button
                size="sm"
                onClick={recording.start}
                disabled={!recording.ready || recording.pending}
              >
                <Circle className="size-2.5 fill-destructive text-destructive" aria-hidden="true" />
                {recording.pending ? "Starting…" : "Start recording"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className={mode === "recorded" ? "min-h-0 flex-1 overflow-auto" : "hidden"}>
        {recorded}
      </div>
      {/* Mounted only while staging, so the live app opens with intent. */}
      {mode === "live" ? <div className="flex min-h-0 flex-1 flex-col">{live}</div> : null}
    </div>
  );
}
