import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@relay/ui-react/components/button";
import type { DeviceProductService } from "../data/device-product-service";
import { SelectField } from "./filter-select";

/** Optional device setup stays next to the task that needs a device. */
export function EmulatorStart({
  service,
  onStarted,
}: {
  service: DeviceProductService;
  onStarted(serial: string): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const client = useQueryClient();
  const inventory = useQuery({
    queryKey: ["android-emulators"],
    queryFn: () => service.listEmulators!(),
    enabled: open && Boolean(service.listEmulators),
    staleTime: 5_000,
    retry: false,
  });
  const boot = useMutation({
    mutationFn: () => service.startEmulator!(name),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ["devices"] });
      await client.invalidateQueries({ queryKey: ["android-emulators"] });
      await onStarted(result.serial);
      setOpen(false);
    },
  });
  if (!service.listEmulators || !service.startEmulator) return null;
  return (
    <div className="grid gap-3">
      <Button
        type="button"
        variant="ghost"
        className="justify-self-start"
        aria-expanded={open}
        disabled={boot.isPending}
        onClick={() => setOpen(!open)}
      >
        Start an emulator
      </Button>
      {open ? (
        <div className="grid gap-3 rounded-lg border border-border bg-background p-3">
          <p className="text-sm text-muted-foreground">
            Use a configured Android emulator when a phone or tablet isn’t connected.
          </p>
          {inventory.isPending ? (
            <p role="status" className="text-sm">
              Finding emulators…
            </p>
          ) : null}
          {inventory.data?.avds.length ? (
            <>
              <SelectField
                label="Android emulator"
                value={name}
                placeholder="Choose an emulator"
                options={inventory.data.avds.map((avd) => ({
                  value: avd.avdName,
                  label: `${avd.name} · ${avd.booted ? "Running" : "Stopped"}`,
                }))}
                onValueChange={setName}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={!name || boot.isPending}
                onClick={() => boot.mutate()}
              >
                {boot.isPending ? "Starting emulator…" : "Use emulator"}
              </Button>
              {boot.isPending ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Waiting for Android to start. This can take a minute.
                </p>
              ) : null}
            </>
          ) : inventory.isSuccess ? (
            <p className="text-sm">
              No configured emulators found. Create one in Android Studio’s Device Manager, then
              check again.
            </p>
          ) : null}
          {inventory.error || boot.error ? (
            <p role="alert" className="text-sm text-destructive">
              {String((inventory.error ?? boot.error)?.message ?? "Could not start the emulator.")}
            </p>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={inventory.isFetching || boot.isPending}
            onClick={() => void inventory.refetch()}
          >
            Check again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
