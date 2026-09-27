import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@relay/ui-react/components/button";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { Input } from "@relay/ui-react/components/input";
import { FieldLabel } from "@relay/ui-react/components/field";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@relay/ui-react/components/dialog";
import type { RunConfigurationOption } from "../data/run-configuration";

const groups = ["Browsers", "Android", "iOS", "Other targets"] as const;
function groupName(option: RunConfigurationOption) {
  return option.platform === "browser"
    ? "Browsers"
    : option.platform === "android"
      ? "Android"
      : option.platform === "ios"
        ? "iOS"
        : "Other targets";
}

export function RunTargetPicker({
  options,
  selected,
  disabled,
  onToggle,
}: {
  options: readonly RunConfigurationOption[];
  selected: readonly string[];
  disabled?: boolean;
  onToggle(id: string, checked: boolean): void;
}) {
  const [search, setSearch] = useState("");
  const filtered = options.filter((option) =>
    `${option.label} ${option.detail ?? ""} ${groupName(option)}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return (
    <div className="grid min-w-0 gap-2">
      <span className="text-sm font-medium">Where to run</span>
      <Dialog
        onOpenChange={(open) => {
          if (open) setSearch("");
        }}
      >
        <DialogTrigger
          render={
            <Button
              variant="outline"
              disabled={disabled}
              className="h-auto min-h-11 w-full justify-between whitespace-normal text-left"
            />
          }
        >
          <span>
            {selected.length ? "Add or change browsers and devices" : "Choose browsers or devices"}
          </span>
        </DialogTrigger>
        <DialogContent className="flex max-h-[85dvh] min-w-0 flex-col gap-4 overflow-hidden">
          <div>
            <DialogTitle>Where to run</DialogTitle>
            <DialogDescription>
              Select one or more browsers or devices. This does not start a run.
            </DialogDescription>
          </div>
          <Input
            aria-label="Search browsers and devices"
            placeholder="Search browsers and devices"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="shrink-0 text-base"
          />
          <div
            className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain"
            aria-label="Available run targets"
          >
            {groups.map((group) => {
              const items = filtered.filter((option) => groupName(option) === group);
              if (!items.length) return null;
              return (
                <fieldset key={group} disabled={disabled} className="mb-4 min-w-0 last:mb-0">
                  <legend className="mb-1 text-xs font-medium text-muted-foreground">
                    {group} · {items.length}
                  </legend>
                  {items.map((option) => (
                    <FieldLabel
                      key={option.id}
                      className="flex w-full min-h-12 min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
                    >
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span title={option.label} className="truncate text-sm font-medium">
                          {option.label}
                        </span>
                        {option.detail && option.detail !== option.label ? (
                          <span
                            title={option.detail}
                            className="truncate text-xs font-normal text-muted-foreground"
                          >
                            {option.detail}
                          </span>
                        ) : null}
                      </span>
                      <Checkbox
                        aria-label={option.label}
                        checked={selected.includes(option.id)}
                        onCheckedChange={(value) => onToggle(option.id, value === true)}
                      />
                    </FieldLabel>
                  ))}
                </fieldset>
              );
            })}
            {!filtered.length ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {options.length
                  ? "No matching browsers or devices."
                  : "No browsers or devices available."}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-sm text-muted-foreground">{selected.length} selected</span>
            <DialogClose render={<Button />}>Done</DialogClose>
          </div>
        </DialogContent>
      </Dialog>
      {selected.length ? (
        <ul aria-label="Selected browsers and devices" className="grid min-w-0 gap-1">
          {selected.map((id) => {
            const option = options.find((item) => item.id === id);
            const label = option?.label ?? "Unavailable target";
            return (
              <li
                key={id}
                className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2"
              >
                <div className="grid min-w-0 gap-0.5">
                  <span title={label} className="truncate text-sm font-medium">
                    {label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {option ? groupName(option) : "Choose a replacement"}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={`Remove ${label}`}
                  onClick={() => onToggle(id, false)}
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
