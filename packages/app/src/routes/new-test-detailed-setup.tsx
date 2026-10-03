/** @jsxImportSource react */
import { RecordingInputRecovery } from "./recording-input-recovery";
import type {
  RecordingInputOutcome,
  RecordingObservedEffect,
} from "../data/recording-input-outcome";
import { AuthoringWorkspace } from "./authoring-workspace";
import { RecordingAppChoice } from "./recording-app-choice";
import { RecordingDeviceChoice } from "../components/recording-device-choice";
import { InstalledAppChoice } from "../components/installed-app-choice";
import { BrowserSetup } from "./new-test-browser-setup";
import { LiveTargetCanvas } from "./live-target-canvas";
import { Button } from "@relay/ui-react/components/button";
import { CircleDot, Compass, Play, RotateCcw, Smartphone } from "lucide-react";
import { EmptyState } from "../components/product-patterns";
import { targetLabel } from "./recording-shared";
import type { ProductTargetOption } from "../data/target-presentation";
import type {
  LiveTargetBrowserContext,
  LiveTargetSession,
  LiveTargetStatus,
} from "../data/live-target-session";
import type { ComponentProps, FormEvent, RefObject } from "react";

type App = ComponentProps<typeof RecordingAppChoice>["apps"][number];
type Browser = ComponentProps<typeof BrowserSetup>["browsers"][number];

export function NewTestDetailedSetup({
  startsFromPath,
  pathSummary,
  apps,
  appId,
  chooseApp,
  onCreatingChange,
  createApp,
  onAppCreated,
  deviceService,
  targetId,
  targetOptions,
  onRefreshTargets,
  chooseTarget,
  onNewBrowserOpen,
  selectedTarget,
  originApplication,
  onOriginChange,
  onOpened,
  formReady,
  startHint,
  beginPending,
  submit,
  browserContext,
  previewIssue,
  reconnecting,
  onReconnect,
  onRetryPreview,
  previewCanvas,
  previewStatus,
  previewBusy,
  sendPreview,
  inputFailure,
  inputRecoveryBusy,
  onObserveInput,
  onExploreUrl,
  targetFetching,
  browsersUnavailable,
  savedBrowsers,
  onRetryBrowsers,
  noTargets,
  newBrowserOpen,
  browserUrl,
  browserStarting,
  browserStartError,
  onBrowserUrlChange,
  onToggleNewBrowser,
  onBrowserStart,
  deviceOnly = false,
}: {
  deviceOnly?: boolean;
  startsFromPath: boolean;
  pathSummary?: { fromTitle: string; toTitle?: string };
  apps: readonly App[];
  appId: string;
  chooseApp(id: string): void;
  onCreatingChange(value: boolean): void;
  createApp: ComponentProps<typeof RecordingAppChoice>["createApp"];
  onAppCreated(app: App): void;
  deviceService: ComponentProps<typeof RecordingDeviceChoice>["service"];
  targetId: string;
  targetOptions: readonly ProductTargetOption[];
  onRefreshTargets(): Promise<void>;
  chooseTarget(id: string): void;
  onNewBrowserOpen(value: boolean): void;
  selectedTarget?: ProductTargetOption;
  originApplication: string;
  onOriginChange(value: string): void;
  onOpened(value: string): void;
  formReady: boolean;
  startHint: string;
  beginPending: boolean;
  submit(event: FormEvent<HTMLFormElement>): void;
  browserContext?: LiveTargetBrowserContext;
  previewIssue?: string;
  reconnecting: boolean;
  onReconnect(id: string): void;
  onRetryPreview(): void;
  previewCanvas: RefObject<HTMLCanvasElement | null>;
  previewStatus: LiveTargetStatus;
  previewBusy: boolean;
  sendPreview: (input: Parameters<LiveTargetSession["input"]>[0]) => Promise<boolean>;
  inputFailure?: RecordingInputOutcome;
  inputRecoveryBusy: boolean;
  onObserveInput(observed: RecordingObservedEffect): Promise<void>;
  onExploreUrl(url: string): void;
  targetFetching: boolean;
  browsersUnavailable: boolean;
  savedBrowsers: readonly Browser[];
  onRetryBrowsers(): void;
  noTargets: boolean;
  newBrowserOpen: boolean;
  browserUrl: string;
  browserStarting: boolean;
  browserStartError: unknown;
  onBrowserUrlChange(value: string): void;
  onToggleNewBrowser(): void;
  onBrowserStart: ComponentProps<typeof BrowserSetup>["onStart"];
}) {
  const choices = deviceOnly
    ? targetOptions.filter((target) => target.kind === "device")
    : targetOptions;
  const deviceChoice = (
    <RecordingDeviceChoice
      service={deviceService}
      deviceOnly={deviceOnly}
      onStarted={async (serial) => {
        await onRefreshTargets();
        chooseTarget(serial);
      }}
      value={targetId}
      options={choices.map((target) => {
        const label = targetLabel(target);
        return {
          value: target.targetId,
          label: label.detail ? `${label.title} · ${label.detail}` : label.title,
        };
      })}
      onChange={(value) => {
        onNewBrowserOpen(false);
        chooseTarget(value);
      }}
    />
  );
  if (deviceOnly && !targetId) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-8">
        <div className="grid w-full max-w-md gap-6">
          <div className="grid gap-3">
            <Smartphone className="size-8 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-2xl font-semibold tracking-tight">
              {choices.length ? "Choose your device" : "Connect your device"}
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Connect your phone or tablet by USB and unlock it, or start an Android emulator below.
            </p>
          </div>
          {deviceChoice}
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            disabled={targetFetching}
            onClick={() => void onRefreshTargets()}
          >
            <RotateCcw aria-hidden="true" />
            {targetFetching ? "Checking…" : "Refresh devices"}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <AuthoringWorkspace
      mobileOrder="setup-first"
      tools={
        <form
          id="new-test-form"
          onSubmit={submit}
          className="grid min-w-0 content-start gap-5 rounded-lg border border-border p-4"
          aria-label="Record setup"
        >
          {startsFromPath ? (
            <p className="text-sm text-muted-foreground">
              Starting from{" "}
              <strong className="font-medium text-foreground">
                {pathSummary
                  ? `${pathSummary.fromTitle} → ${pathSummary.toTitle ?? "Finish"}`
                  : "the selected path"}
              </strong>
            </p>
          ) : null}
          <RecordingAppChoice
            apps={apps}
            value={appId}
            onChange={chooseApp}
            onCreatingChange={onCreatingChange}
            createApp={(name) => createApp(name)}
            onCreated={onAppCreated}
          />
          {deviceChoice}
          {!deviceOnly ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                chooseTarget("");
                onNewBrowserOpen(true);
              }}
            >
              New browser
            </Button>
          ) : null}
          {selectedTarget?.kind === "device" ? (
            <InstalledAppChoice
              service={deviceService}
              serial={selectedTarget.targetId}
              value={originApplication}
              onChange={(value) => {
                onOriginChange(value);
                onOpened("");
              }}
              onOpened={onOpened}
            />
          ) : null}
          {!formReady ? (
            <p
              id="recording-readiness"
              role="status"
              className="text-sm leading-5 text-muted-foreground"
            >
              {startHint}
            </p>
          ) : null}
          <Button
            type="submit"
            disabled={!formReady}
            aria-describedby="recording-readiness"
            className="w-full"
          >
            <Play aria-hidden="true" />
            {beginPending ? "Starting…" : "Start recording"}
          </Button>
        </form>
      }
      stage={
        <div
          className="flex h-full min-h-0 w-full overflow-hidden bg-background/40"
          aria-label="Recording stage"
        >
          {selectedTarget ? (
            <section
              className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto]"
              aria-label="Device preview"
            >
              <div className="flex items-center justify-end gap-1">
                {browserContext?.pageUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onExploreUrl(browserContext.pageUrl!)}
                  >
                    <Compass aria-hidden="true" />
                    Explore URL in a new browser
                  </Button>
                ) : null}
                {previewIssue ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={reconnecting}
                    onClick={() => {
                      if (
                        selectedTarget.platform === "android" ||
                        selectedTarget.platform === "ios"
                      )
                        onReconnect(selectedTarget.targetId);
                      else onRetryPreview();
                    }}
                  >
                    <RotateCcw aria-hidden="true" />
                    {reconnecting
                      ? "Connecting…"
                      : inputFailure
                        ? "Reconnect preview"
                        : "Connect device"}
                  </Button>
                ) : null}
              </div>
              <LiveTargetCanvas
                canvasRef={previewCanvas}
                status={previewStatus}
                issue={previewIssue}
                busy={previewBusy}
                targetTitle={targetLabel(selectedTarget).title}
                targetDetail={targetLabel(selectedTarget).detail}
                browserContext={browserContext}
                directBrowser={selectedTarget.kind === "browser"}
                send={sendPreview}
                recording={false}
                showTargetDetails={false}
                targetPlatform={selectedTarget?.platform}
                helpText=""
              />
              {inputFailure ? (
                <RecordingInputRecovery
                  failure={inputFailure}
                  busy={inputRecoveryBusy}
                  issue={
                    previewIssue ??
                    "Relay lost confirmation of the last interaction. Check the live screen before continuing."
                  }
                  onObserve={onObserveInput}
                />
              ) : null}
            </section>
          ) : targetId ? (
            <div className="grid min-h-0 w-full place-items-center p-6">
              <div className="grid max-w-sm justify-items-center gap-3 text-center">
                <CircleDot className="size-6 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-sm font-medium">
                  {targetFetching
                    ? "Connecting to your device…"
                    : "Your selected device isn’t ready"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {targetFetching
                    ? "Waiting for the device to become available."
                    : "Check that it’s running, or choose another device."}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={targetFetching}
                  onClick={() => void onRefreshTargets()}
                >
                  Check again
                </Button>
              </div>
            </div>
          ) : browsersUnavailable ? (
            <div className="grid min-h-0 w-full place-items-center p-6">
              <div className="grid max-w-sm gap-3 text-center">
                <p role="alert" className="text-sm text-destructive">
                  Saved browsers could not be loaded. Your existing browser choices are unavailable.
                </p>
                <Button type="button" variant="outline" onClick={() => void onRetryBrowsers()}>
                  Retry browser lookup
                </Button>
              </div>
            </div>
          ) : noTargets || newBrowserOpen ? (
            <BrowserSetup
              browsers={savedBrowsers}
              browserUrl={browserUrl}
              newBrowserOpen={newBrowserOpen || !savedBrowsers.length}
              pending={browserStarting}
              checking={targetFetching}
              error={browserStartError}
              onBrowserUrlChange={onBrowserUrlChange}
              onToggleNewBrowser={() => onToggleNewBrowser()}
              onStart={onBrowserStart}
              onCheckAgain={() => void onRefreshTargets()}
            />
          ) : (
            <div className="grid min-h-0 w-full place-items-center p-6">
              <EmptyState
                title="Choose where to record"
                detail="Pick a Device or Browser. The live view opens here."
              />
            </div>
          )}
        </div>
      }
    />
  );
}
