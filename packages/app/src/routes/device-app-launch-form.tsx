/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import type { ProductLaunchedApp } from "../data/device-product-service";
import { errorMessage } from "./recording-shared";
import { LoaderCircle } from "lucide-react";
import { IOSInstalledAppPicker } from "./ios-installed-app-picker";
import type { ProductInstalledApp } from "../data/device-product-service";

export function IOSAppLaunchForm({
  deviceName,
  identifier,
  relaunch,
  pending,
  disabled = false,
  error,
  launched,
  onIdentifierChange,
  onRelaunchChange,
  onLaunch,
  installedApps,
}: {
  deviceName: string;
  identifier: string;
  relaunch: boolean;
  pending: boolean;
  disabled?: boolean;
  error: unknown;
  launched?: ProductLaunchedApp;
  onIdentifierChange(value: string): void;
  onRelaunchChange(value: boolean): void;
  onLaunch(identifier?: string): void;
  installedApps?: {
    apps?: readonly ProductInstalledApp[];
    loading: boolean;
    error: boolean;
    refresh(): void;
  };
}) {
  return (
    <section className="grid gap-3" aria-label="App launch">
      <div className="grid max-w-xl gap-2">
        {installedApps ? (
          <IOSInstalledAppPicker
            {...installedApps}
            disabled={pending || disabled}
            choose={onLaunch}
          />
        ) : null}
        <details
          open={!installedApps || installedApps.error || Boolean(identifier)}
          className="grid gap-2"
        >
          <summary className="cursor-pointer py-2 text-sm text-muted-foreground">
            Open by name or bundle ID
          </summary>
          <div className="grid gap-3 pt-2">
            {/* The manual field is a fallback to the installed-app picker. */}
            <label className="text-sm font-medium" htmlFor="device-app-identifier">
              App to open
            </label>
            <div className="flex gap-2">
              <input
                id="device-app-identifier"
                className="min-h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm font-normal focus-visible:outline-2 focus-visible:outline-ring"
                value={identifier}
                onChange={(event) => {
                  onIdentifierChange(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (identifier.trim() && !pending && !disabled) onLaunch();
                }}
                autoComplete="off"
                spellCheck={false}
                placeholder="Name or bundle ID"
                disabled={pending || disabled}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => onLaunch()}
                className="min-h-9"
                disabled={pending || disabled || !identifier.trim()}
              >
                {pending ? "Launching…" : "Launch app"}
              </Button>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={relaunch}
                onChange={(event) => onRelaunchChange(event.target.checked)}
                disabled={pending || disabled}
              />
              Relaunch if the app is already open
            </label>
          </div>
        </details>
        {pending ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Opening app…
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {friendlyAppLaunchIssue(error)}
          </p>
        ) : null}
        {launched ? (
          <p className="text-sm text-muted-foreground" role="status">
            Launch requested for {launched.app} on {deviceName}.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function friendlyAppLaunchIssue(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : "";
  if (/not (?:a known iOS app|installed)|More than one installed app/iu.test(rawMessage))
    return rawMessage;
  if (/device|target|serial|offline|disconnected|unauthorized|not found/iu.test(rawMessage)) {
    return "Relay could not launch the app. Keep the device connected and try again.";
  }
  const message = errorMessage(error);
  if (/not available|attached Android and iOS/iu.test(message)) return message;
  return "Relay could not launch the app. Check the identifier and try again.";
}
