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
import { IOSStartingAppChoice } from "./ios-starting-app-choice";
import type { RecordingSetupAdmission } from "../data/recording-setup-admission";
import { BrowserSetup } from "./new-test-browser-setup";
import { LiveTargetCanvas } from "./live-target-canvas";
import { Button } from "@relay/ui-react/components/button";
import { CircleDot, Compass, Play, RotateCcw, Smartphone, Plus } from "lucide-react";
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
  admission,
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
  admission: RecordingSetupAdmission;
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
  const selectedChoice = choices.find((target) => target.targetId === targetId);
  const deviceChoice = (
    <div className="grid gap-1">
      <RecordingDeviceChoice
        admission={admission}
        service={deviceService}
        loading={targetFetching}
        deviceOnly={deviceOnly}
        onStarted={async (serial) => {
          if (!admission.mayEdit()) return;
          await onRefreshTargets();
          if (admission.mayEdit()) chooseTarget(serial);
        }}
        value={targetId}
        // Names only, so the closed menu never truncates mid-word; the chosen
        // target's detail sits beneath it.
        options={choices.map((target) => ({
          value: target.targetId,
          label: targetLabel(target).title,
        }))}
        onChange={(value) => {
          if (!admission.mayEdit()) return;
          onNewBrowserOpen(false);
          chooseTarget(value);
        }}
      />
      {selectedChoice ? (
        <p className="truncate text-xs text-muted-foreground">
          {targetLabel(selectedChoice).detail}
        </p>
      ) : null}
    </div>
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
            disabled={targetFetching || admission.busy}
            onClick={() => {
              if (admission.mayEdit()) void onRefreshTargets();
            }}
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
            admission={admission}
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
              variant="ghost"
              size="sm"
              className="-mt-2 w-fit"
              disabled={admission.busy}
              onClick={() => {
                if (!admission.mayEdit()) return;
                chooseTarget("");
                onNewBrowserOpen(true);
              }}
            >
              <Plus aria-hidden="true" /> New browser
            </Button>
          ) : null}
          {selectedTarget?.kind === "device" && selectedTarget.platform === "ios" ? (
            <IOSStartingAppChoice
              admission={admission}
              service={deviceService}
              serial={selectedTarget.targetId}
              value={originApplication}
              onChange={(value) => {
                if (!admission.mayEdit()) return;
                onOriginChange(value);
                onOpened("");
              }}
              onOpened={(value) => {
                if (admission.mayEdit()) onOpened(value);
              }}
            />
          ) : selectedTarget?.kind === "device" ? (
            <InstalledAppChoice
              admission={admission}
              service={deviceService}
              serial={selectedTarget.targetId}
              value={originApplication}
              onChange={(value) => {
                if (!admission.mayEdit()) return;
                onOriginChange(value);
                onOpened("");
              }}
              onOpened={(value) => {
                if (admission.mayEdit()) onOpened(value);
              }}
            />
          ) : null}
          <Button
            type="submit"
            disabled={!formReady}
            aria-describedby="recording-readiness"
            className="w-full"
          >
            <Play aria-hidden="true" />
            {admission.busy && !reconnecting ? "Starting…" : "Start recording"}
          </Button>
          {/* The reason sits under the disabled button it explains. */}
          {!formReady ? (
            <p
              id="recording-readiness"
              role="status"
              className="-mt-1 text-center text-xs leading-5 text-muted-foreground"
            >
              {startHint}
            </p>
          ) : null}
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
                    disabled={admission.busy}
                    onClick={() => {
                      if (admission.mayEdit()) onExploreUrl(browserContext.pageUrl!);
                    }}
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
                    disabled={reconnecting || admission.busy}
                    onClick={() => {
                      if (!admission.mayEdit()) return;
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
                busy={previewBusy || admission.busy}
                targetTitle={targetLabel(selectedTarget).title}
                targetDetail={targetLabel(selectedTarget).detail}
                browserContext={browserContext}
                directBrowser={selectedTarget.kind === "browser"}
                send={(input) =>
                  admission.mayEdit() ? sendPreview(input) : Promise.resolve(false)
                }
                recording={false}
                showTargetDetails={false}
                targetPlatform={selectedTarget?.platform}
                helpText=""
              />
              {inputFailure ? (
                <RecordingInputRecovery
                  failure={inputFailure}
                  busy={inputRecoveryBusy || admission.busy}
                  issue={
                    previewIssue ??
                    "Relay lost confirmation of the last interaction. Check the live screen before continuing."
                  }
                  onObserve={(observed) =>
                    admission.mayEdit() ? onObserveInput(observed) : Promise.resolve()
                  }
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
                  disabled={targetFetching || admission.busy}
                  onClick={() => {
                    if (admission.mayEdit()) void onRefreshTargets();
                  }}
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
                <Button
                  type="button"
                  variant="outline"
                  disabled={admission.busy}
                  onClick={() => {
                    if (admission.mayEdit()) onRetryBrowsers();
                  }}
                >
                  Retry browser lookup
                </Button>
              </div>
            </div>
          ) : noTargets || newBrowserOpen ? (
            <BrowserSetup
              browsers={savedBrowsers}
              browserUrl={browserUrl}
              newBrowserOpen={newBrowserOpen || !savedBrowsers.length}
              pending={browserStarting || admission.busy}
              checking={targetFetching}
              error={browserStartError}
              onBrowserUrlChange={(value) => {
                if (admission.mayEdit()) onBrowserUrlChange(value);
              }}
              onToggleNewBrowser={() => {
                if (admission.mayEdit()) onToggleNewBrowser();
              }}
              onStart={(browser) => {
                if (admission.mayEdit()) onBrowserStart(browser);
              }}
              onCheckAgain={() => {
                if (admission.mayEdit()) void onRefreshTargets();
              }}
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
