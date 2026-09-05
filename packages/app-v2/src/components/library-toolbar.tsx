/** @jsxImportSource react */
import { Input } from "@relay/ui-react/components/input";
import { Search } from "lucide-react";
import type { ReactNode } from "react";

export function LibraryToolbar({
  tabs,
  search,
  filters,
  label,
}: {
  tabs?: ReactNode;
  search?: ReactNode;
  filters?: ReactNode;
  label: string;
}) {
  return (
    <div className="grid gap-5 border-b border-border pb-5">
      {tabs}
      {search || filters ? (
        <div className="flex flex-wrap items-center gap-2" aria-label={label}>
          {search}
          {filters}
        </div>
      ) : null}
    </div>
  );
}

export function LibrarySearch({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder: string;
}) {
  return (
    <div data-slot="library-search-control" className="relative min-w-[16rem] flex-1">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id={id}
        className="h-9 pl-8"
        type="search"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck="false"
      />
    </div>
  );
}
