/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Image as ImageIcon, Radio } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
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

export type StageMode = "recorded" | "live";

/** On narrow windows the page's own switcher picks Screenshot or Live, so the
 * stage drops its second row of tabs instead of nesting one inside the other. */
export const StageModeContext = createContext<{
  mode: StageMode;
  setMode(mode: StageMode): void;
} | null>(null);

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
  const shared = useContext(StageModeContext);
  const [localMode, setLocalMode] = useState<StageMode>("recorded");
  const mode = shared?.mode ?? localMode;
  const setMode = shared?.setMode ?? setLocalMode;
  const [liveOpened, setLiveOpened] = useState(false);
  useEffect(() => {
    if (mode === "live") setLiveOpened(true);
  }, [mode]);
  return (
    <div className="flex h-full min-h-0 flex-col bg-stage">
      {/* The screenshot by default; the live app is one deliberate click away. */}
      <div
        className={`flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5 ${shared ? "max-[1099px]:hidden" : ""}`}
      >
        <span className="text-xs font-medium text-muted-foreground">
          {mode === "live" ? liveLabel : "Screenshot"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={mode === "recorded" && !live}
          onClick={() => setMode(mode === "live" ? "recorded" : "live")}
        >
          {mode === "live" ? (
            <>
              <ImageIcon aria-hidden="true" /> Show screenshot
            </>
          ) : (
            <>
              <Radio aria-hidden="true" /> Open {liveLabel.toLocaleLowerCase()}
            </>
          )}
        </Button>
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
