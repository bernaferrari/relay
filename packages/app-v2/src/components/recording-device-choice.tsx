import { useMutation, useQuery } from "@tanstack/react-query";
import type { DeviceProductService } from "../data/device-product-service";
import { SelectField, type FilterSelectOption } from "./filter-select";

export function RecordingDeviceChoice({
  service,
  value,
  options,
  onChange,
  onStarted,
}: {
  service: DeviceProductService;
  value: string;
  options: readonly FilterSelectOption[];
  onChange(value: string): void;
  onStarted(serial: string): Promise<void>;
}) {
  const inventory = useQuery({
    queryKey: ["android-emulators"],
    queryFn: () => service.listEmulators!(),
    enabled: Boolean(service.listEmulators),
    staleTime: 5_000,
    retry: false,
  });
  const boot = useMutation({
    mutationFn: (name: string) => service.startEmulator!(name),
    onSuccess: async (result) => {
      await onStarted(result.serial);
      await inventory.refetch();
    },
  });
  const stopped = service.startEmulator
    ? (inventory.data?.avds ?? []).filter((avd) => !avd.booted)
    : [];
  return (
    <div className="grid min-w-0 gap-2">
      <SelectField
        label="Record on"
        value={options.some((option) => option.value === value) ? value : ""}
        placeholder={value ? "Selected device unavailable" : "Choose a device or browser"}
        options={[
          ...options,
          ...stopped.map((avd) => ({
            value: `avd:${avd.avdName}`,
            label: `${avd.name} · Start Android emulator`,
          })),
        ]}
        onValueChange={(next) => {
          if (boot.isPending) return;
          if (next.startsWith("avd:")) boot.mutate(next.slice(4));
          else onChange(next);
        }}
      />
      {boot.isPending ? (
        <p role="status" className="text-xs text-muted-foreground">
          Starting {boot.variables}… Waiting for Android.
        </p>
      ) : null}
      {boot.error || inventory.error ? (
        <p role="alert" className="text-xs text-destructive">
          {(boot.error ?? inventory.error)?.message}
        </p>
      ) : null}
    </div>
  );
}
