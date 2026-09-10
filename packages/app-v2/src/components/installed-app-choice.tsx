/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Label } from "@relay/ui-react/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@relay/ui-react/components/popover";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import type { DeviceProductService } from "../data/device-product-service";

export function InstalledAppChoice({
  service,
  serial,
  value,
  onChange,
  onOpened,
}: {
  service: DeviceProductService;
  serial: string;
  value: string;
  onChange(value: string): void;
  onOpened(packageName: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string>();
  const selectionRef = useRef({ serial, value });
  const requestRef = useRef(0);
  selectionRef.current = { serial, value };
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
  async function openSelectedApp() {
    if (!value || !service.launchApp) return;
    const requestId = ++requestRef.current;
    const requested = { serial, value };
    setOpening(true);
    setOpenError(undefined);
    try {
      await service.launchApp(serial, value, true);
      if (
        requestRef.current === requestId &&
        selectionRef.current.serial === requested.serial &&
        selectionRef.current.value === requested.value
      )
        onOpened(value);
    } catch {
      if (
        requestRef.current === requestId &&
        selectionRef.current.serial === requested.serial &&
        selectionRef.current.value === requested.value
      )
        setOpenError("This app could not be opened. Try again or choose Current screen.");
    } finally {
      if (requestRef.current === requestId) setOpening(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor="recording-origin-application">Starting app</Label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch("");
        }}
      >
        <PopoverTrigger
          render={
            <Button
              id="recording-origin-application"
              type="button"
              variant="outline"
              className="min-h-11 w-full justify-between font-normal"
              aria-label="Starting app"
              aria-haspopup="listbox"
            />
          }
        >
          <span className="min-w-0 truncate text-left">
            {selected ? `${selected.name} · ${selected.package}` : "Current screen"}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-2">
          <Input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search installed apps…"
            aria-label="Search installed apps"
          />
          <div className="max-h-64 overflow-y-auto" role="listbox" aria-label="Installed apps">
            <button
              type="button"
              role="option"
              aria-selected={!value}
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              <span>Current screen</span>
              {!value ? <Check className="size-4" aria-hidden="true" /> : null}
            </button>
            {apps.isPending ? (
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
                  onClick={() => void apps.refetch()}
                >
                  <RotateCcw aria-hidden="true" /> Try again
                </Button>
              </div>
            ) : options.length ? (
              options.map((app) => (
                <button
                  key={app.package}
                  type="button"
                  role="option"
                  aria-selected={app.package === value}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => {
                    onChange(app.package);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 truncate">
                    <span className="block truncate">{app.name || app.package}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {app.package}
                    </span>
                  </span>
                  {app.package === value ? (
                    <Check className="size-4 shrink-0" aria-hidden="true" />
                  ) : null}
                </button>
              ))
            ) : (
              <p className="px-2 py-3 text-xs text-muted-foreground">No matching apps.</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {value ? (
        <Button
          type="button"
          variant="secondary"
          className="w-fit"
          disabled={opening || !service.launchApp}
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
