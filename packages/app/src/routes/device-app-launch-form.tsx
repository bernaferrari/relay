/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import type { ProductLaunchedApp } from "../data/device-product-service";
import { errorMessage } from "./recording-shared";

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
  onLaunch(): void;
}) {
  return (
    <section className="grid gap-4" aria-label="App launch">
      <div className="grid max-w-xl gap-4">
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="device-app-identifier">
          App name or bundle identifier
          <input
            id="device-app-identifier"
            className="min-h-11 rounded-md border border-input bg-background px-3 text-base font-normal focus-visible:outline-2 focus-visible:outline-ring"
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
            placeholder="e.g. Grok"
            disabled={pending || disabled}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={relaunch}
            onChange={(event) => onRelaunchChange(event.target.checked)}
            disabled={pending || disabled}
          />
          Relaunch if the app is already open
        </label>
        <Button
          type="button"
          onClick={onLaunch}
          className="w-fit"
          disabled={pending || disabled || !identifier.trim()}
        >
          {pending ? "Launching…" : "Launch app"}
        </Button>
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
  if (/device|target|serial|offline|disconnected|unauthorized|not found/iu.test(rawMessage)) {
    return "Relay could not launch the app. Keep the device connected and try again.";
  }
  const message = errorMessage(error);
  if (/not available|attached Android and iOS/iu.test(message)) return message;
  return "Relay could not launch the app. Check the identifier and try again.";
}
