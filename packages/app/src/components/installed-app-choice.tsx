/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Label } from "@relay/ui-react/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@relay/ui-react/components/popover";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { DeviceProductService } from "../data/device-product-service";
import type { RecordingSetupAdmission } from "../data/recording-setup-admission";

export function InstalledAppChoice({
  service,
  serial,
  value,
  onChange,
  onOpened,
  label = "Starting app",
  admission,
}: {
  service: DeviceProductService;
  serial: string;
  value: string;
  onChange(value: string): void;
  onOpened(packageName: string): void;
  label?: string;
  admission?: RecordingSetupAdmission;
}) {
  const controlId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string>();
  const selectionRef = useRef({ service, serial, value, admission });
  const requestRef = useRef(0);
  selectionRef.current = { service, serial, value, admission };
  const apps = useQuery({
    queryKey: ["installed-apps", serial],
    queryFn: () => service.listInstalledApps!(serial),
    enabled: Boolean(serial && service.listInstalledApps),
    staleTime: 30_000,
    retry: false,
  });
  const query = search.trim().toLocaleLowerCase();
  const options = (apps.data ?? []).filter(
    (app) => !query || `${app.name} ${app.package}`.toLocaleLowerCase().includes(query),
  );
  const selected = apps.data?.find((app) => app.package === value);
  const nameCounts = new Map<string, number>();
  for (const app of apps.data ?? []) {
    const name = app.name.trim().toLocaleLowerCase();
    if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  useEffect(() => {
    requestRef.current += 1;
    setOpening(false);
    setOpenError(undefined);
  }, [service, serial, value]);
  async function openSelectedApp() {
    if (admission?.mayEdit() === false || opening || !value || !service.launchApp) return;
    const requestId = ++requestRef.current;
    const requested = { serial, value };
    setOpening(true);
    setOpenError(undefined);
    try {
      await service.launchApp(serial, value, true);
      if (
        requestRef.current === requestId &&
        selectionRef.current.admission?.mayEdit() !== false &&
        selectionRef.current.service === service &&
        selectionRef.current.serial === requested.serial &&
        selectionRef.current.value === requested.value
      )
        onOpened(value);
    } catch (error) {
      if (
        requestRef.current === requestId &&
        selectionRef.current.admission?.mayEdit() !== false &&
        selectionRef.current.service === service &&
        selectionRef.current.serial === requested.serial &&
        selectionRef.current.value === requested.value
      )
        setOpenError(appOpenIssue(error));
    } finally {
      if (requestRef.current === requestId) setOpening(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={controlId}>{label}</Label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (admission?.mayEdit() === false) return;
          setOpen(next);
          if (!next) setSearch("");
        }}
      >
        <PopoverTrigger
          render={
            <Button
              id={controlId}
              type="button"
              variant="outline"
              className="min-h-11 w-full justify-between"
              aria-label={label}
              aria-haspopup="listbox"
              disabled={admission?.busy}
            />
          }
        >
          <span className="min-w-0 truncate text-left">
            {selected?.name.trim() || value || "Current screen"}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-2">
          <Input
            autoFocus
            value={search}
            onChange={(event) => {
              if (admission?.mayEdit() !== false) setSearch(event.target.value);
            }}
            disabled={admission?.busy}
            placeholder="Search installed apps…"
            aria-label="Search installed apps"
          />
          <div className="max-h-64 overflow-y-auto" role="listbox" aria-label="Installed apps">
            <button
              type="button"
              role="option"
              aria-selected={!value}
              disabled={admission?.busy}
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => {
                if (admission?.mayEdit() === false) return;
                onChange("");
                setOpen(false);
              }}
            >
              <span>Current screen</span>
              {!value ? <Check className="size-4" aria-hidden="true" /> : null}
            </button>
            {!service.listInstalledApps ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                Installed apps are unavailable. Use the current screen.
              </p>
            ) : apps.isPending ? (
              <p className="px-2 py-3 text-xs text-muted-foreground" role="status">
                Loading installed apps…
              </p>
            ) : apps.isError ? (
              <div className="grid gap-2 px-2 py-3 text-xs text-muted-foreground">
                <p>Installed apps could not be loaded.</p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="w-fit"
                  disabled={admission?.busy}
                  onClick={() => {
                    if (admission?.mayEdit() !== false) void apps.refetch();
                  }}
                >
                  <RotateCcw aria-hidden="true" /> Try again
                </Button>
              </div>
            ) : options.length ? (
              options.map((app) => {
                const name = app.name.trim();
                const showPackage = Boolean(
                  name &&
                  name !== app.package &&
                  ((nameCounts.get(name.toLocaleLowerCase()) ?? 0) > 1 ||
                    (query && !name.toLocaleLowerCase().includes(query))),
                );
                return (
                  <button
                    key={app.package}
                    type="button"
                    role="option"
                    aria-selected={app.package === value}
                    disabled={admission?.busy}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => {
                      if (admission?.mayEdit() === false) return;
                      onChange(app.package);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 truncate">
                      <span className="block truncate">{name || app.package}</span>
                      {showPackage ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {app.package}
                        </span>
                      ) : null}
                    </span>
                    {app.package === value ? (
                      <Check className="size-4 shrink-0" aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })
            ) : (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                {query ? "No matching apps." : "No installed apps are available."}
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {value ? (
        <Button
          type="button"
          variant="secondary"
          className="w-fit"
          disabled={opening || admission?.busy || !service.launchApp}
          onClick={() => void openSelectedApp()}
        >
          {opening ? "Opening app…" : "Open app"}
        </Button>
      ) : null}
      {openError ? (
        <p role="alert" className="text-xs text-destructive">
          {openError}
        </p>
      ) : null}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Use the current screen, or choose an app to open.
      </p>
    </div>
  );
}

function appOpenIssue(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (
    /not installed|unknown package|invalid (?:app|package|identifier)|package .*not found/iu.test(
      message,
    )
  ) {
    return "This app is unavailable. Choose another app or use the current screen.";
  }
  if (
    /permission denied|forbidden|unauthorized|lease.*(?:denied|held|owned|required)/iu.test(message)
  ) {
    return "Relay does not have permission to open this app.";
  }
  return "Couldn’t confirm the app opened. Check the live view before trying again.";
}
