import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@relay/ui-react/components/popover";
import { ChevronDown, LoaderCircle, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { ProductInstalledApp } from "../data/device-product-service";

export function IOSInstalledAppPicker({
  apps,
  loading,
  error,
  disabled,
  refresh,
  choose,
}: {
  apps?: readonly ProductInstalledApp[];
  loading: boolean;
  error: boolean;
  disabled: boolean;
  refresh(): void;
  choose(bundleId: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const matches = (apps ?? []).filter((app) =>
    `${app.name} ${app.package}`.toLocaleLowerCase().includes(query),
  );
  const counts = new Map<string, number>();
  for (const app of apps ?? []) counts.set(app.name, (counts.get(app.name) ?? 0) + 1);
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setSearch("");
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="secondary" className="min-h-10 justify-between" disabled={disabled} />
        }
      >
        Choose installed app <ChevronDown aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <Input
          autoFocus
          aria-label="Search installed iOS apps"
          placeholder="Find an app…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="mt-2 max-h-64 overflow-y-auto" aria-label="Installed iOS apps">
          {loading ? (
            <p
              className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"
              role="status"
            >
              <LoaderCircle
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              Reading installed apps…
            </p>
          ) : error ? (
            <div className="grid gap-2 px-2 py-3 text-sm">
              <p>Installed apps could not be loaded.</p>
              <Button variant="secondary" size="sm" onClick={refresh}>
                <RotateCcw aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : matches.length ? (
            matches.map((app) => (
              <Button
                key={app.package}
                variant="ghost"
                className="min-h-11 h-auto w-full justify-start text-left"
                onClick={() => {
                  setOpen(false);
                  setSearch("");
                  choose(app.package);
                }}
              >
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate">{app.name}</span>
                  {(counts.get(app.name) ?? 0) > 1 ? (
                    <span className="truncate text-xs text-muted-foreground">{app.package}</span>
                  ) : null}
                </span>
              </Button>
            ))
          ) : (
            <p className="px-2 py-3 text-sm text-muted-foreground">No matching apps.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
