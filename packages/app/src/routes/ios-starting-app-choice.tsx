/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { DeviceProductService } from "../data/device-product-service";
import type { RecordingSetupAdmission } from "../data/recording-setup-admission";
import { IOSAppLaunchForm } from "./device-app-launch-form";

/** iOS launch accepts names and bundle identifiers; installed inventory is
 * not a supported capability. Opening is always an explicit person action. */
export function IOSStartingAppChoice({
  service,
  serial,
  value,
  onChange,
  onOpened,
  admission,
}: {
  service: DeviceProductService;
  serial: string;
  value: string;
  onChange(value: string): void;
  onOpened(value: string): void;
  admission?: RecordingSetupAdmission;
}) {
  const [relaunch, setRelaunch] = useState(false);
  const selected = useRef({ service, serial, value, admission });
  selected.current = { service, serial, value, admission };
  const launch = useMutation({
    mutationFn: async (input: {
      service: DeviceProductService;
      serial: string;
      app: string;
      relaunch: boolean;
    }) => {
      if (selected.current.admission?.mayEdit() === false) return;
      if (!input.service.launchApp) throw new TypeError("App launch is unavailable on this host.");
      return input.service.launchApp(input.serial, input.app, input.relaunch);
    },
    onSuccess: (result, input) => {
      if (
        selected.current.admission?.mayEdit() === false ||
        selected.current.service !== input.service ||
        selected.current.serial !== input.serial ||
        selected.current.value.trim() !== input.app
      )
        return;
      if (
        !result ||
        result.serial !== input.serial ||
        result.platform !== "ios" ||
        !result.observed?.matched
      )
        return;
      onChange(result.app);
      onOpened(result.app);
    },
  });
  return (
    <section className="grid gap-2 border-t border-border pt-4" aria-label="Starting app">
      <p className="text-xs text-muted-foreground">
        Open an app on the device first, or record from whatever is on screen.
      </p>
      <IOSAppLaunchForm
        deviceName="this device"
        identifier={value}
        relaunch={relaunch}
        pending={launch.isPending}
        disabled={admission?.busy}
        error={launch.error}
        launched={launch.data}
        onIdentifierChange={(next) => {
          if (launch.isPending || admission?.mayEdit() === false) return;
          onChange(next);
          launch.reset();
        }}
        onRelaunchChange={(next) => {
          if (admission?.mayEdit() !== false) setRelaunch(next);
        }}
        onLaunch={() => {
          if (launch.isPending || admission?.mayEdit() === false || !value.trim()) return;
          onOpened("");
          launch.mutate({ service, serial, app: value.trim(), relaunch });
        }}
      />
      {launch.data && !launch.data.observed?.matched ? (
        <p className="text-sm text-muted-foreground" role="status">
          Relay could not confirm which app is open. Check the preview, or use the current screen.
        </p>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit"
        disabled={launch.isPending || admission?.busy}
        onClick={() => {
          if (admission?.mayEdit() === false) return;
          onChange("");
          onOpened("");
          launch.reset();
        }}
      >
        Use current screen
      </Button>
    </section>
  );
}
