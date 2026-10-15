/** @jsxImportSource react */
import { useEffect, useRef, useState, type RefObject } from "react";
import type { BrowserPageTool, BrowserPageToolResult } from "@relay/protocol";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@relay/ui-react/components/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import {
  MoreHorizontal,
  Search,
  History,
  Minus,
  Plus,
  X,
  ChevronUp,
  ChevronDown,
  Camera,
} from "lucide-react";

export function BrowserPageTools({
  scope,
  disabled,
  command,
  navigate,
}: {
  scope: RefObject<HTMLElement | null>;
  disabled: boolean;
  command(input: BrowserPageTool): Promise<BrowserPageToolResult>;
  navigate(url: string): Promise<boolean>;
}) {
  const [finding, setFinding] = useState(false),
    [query, setQuery] = useState("");
  const [find, setFind] = useState<BrowserPageToolResult["find"]>(),
    [zoom, setZoom] = useState(1);
  const [history, setHistory] = useState<BrowserPageToolResult["history"]>(),
    [filter, setFilter] = useState("");
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null),
    latest = useRef(0),
    runRef = useRef(command);
  runRef.current = command;
  async function run(tool: BrowserPageTool) {
    const request = ++latest.current;
    setPending(true);
    setError(undefined);
    try {
      const result = await runRef.current(tool);
      if (request !== latest.current) return;
      if (result.find) setFind(result.find);
      if (result.zoom !== undefined) setZoom(result.zoom);
      if (result.history) {
        setFilter("");
        setHistory(result.history);
      }
    } catch {
      if (request === latest.current) setError("Couldn’t update this browser. Try again.");
    } finally {
      if (request === latest.current) setPending(false);
    }
  }
  function changeZoom(factor: number) {
    void run({
      kind: "browser.zoom",
      factor: Math.max(0.25, Math.min(3, Math.round(factor * 100) / 100)),
    });
  }
  function closeFind() {
    setFinding(false);
    setQuery("");
    setFind(undefined);
    void run({ kind: "browser.find", query: "" });
  }
  useEffect(() => {
    if (finding) input.current?.focus();
  }, [finding]);
  useEffect(() => {
    if (!finding) return;
    const timer = setTimeout(() => void run({ kind: "browser.find", query }), 180);
    return () => clearTimeout(timer);
  }, [finding, query]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!scope.current?.parentElement?.contains(document.activeElement) || disabled) return;
      const modifier = event.metaKey || event.ctrlKey;
      const historyShortcut =
        (event.metaKey && event.key.toLowerCase() === "y") ||
        (event.ctrlKey && event.key.toLowerCase() === "h");
      if ((modifier && ["f", "F", "+", "=", "-", "0"].includes(event.key)) || historyShortcut) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key.toLowerCase() === "f") {
          setFinding(true);
          input.current?.focus();
        } else if (historyShortcut) void run({ kind: "browser.history" });
        else changeZoom(event.key === "0" ? 1 : zoom + (event.key === "-" ? -0.1 : 0.1));
      }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [scope, disabled, zoom]);
  function screenshot() {
    const canvas = scope.current?.parentElement?.querySelector("canvas");
    if (!canvas?.width) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `relay-browser-${new Date().toISOString().replace(/[:.]/gu, "-")}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }
  const matches = history?.filter((row) =>
    `${row.title} ${row.url}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) void run({ kind: "browser.zoom" });
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              disabled={disabled || pending}
              aria-label="Browser menu"
            />
          }
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem onClick={() => setFinding(true)}>
            <Search aria-hidden="true" /> Find on page
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void run({ kind: "browser.history" })}>
            <History aria-hidden="true" /> History
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <div role="group" aria-label="Page zoom" className="flex items-center gap-1 px-2 py-1">
            <span className="mr-auto text-sm">Zoom</span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Zoom out"
              disabled={pending || zoom <= 0.25}
              onClick={() => changeZoom(zoom - 0.1)}
            >
              <Minus aria-hidden="true" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="w-14"
              aria-label="Reset zoom"
              disabled={pending}
              onClick={() => changeZoom(1)}
            >
              <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Zoom in"
              disabled={pending || zoom >= 3}
              onClick={() => changeZoom(zoom + 0.1)}
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={screenshot}>
            <Camera aria-hidden="true" /> Save screenshot
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {finding ? (
        <div
          role="search"
          aria-label="Find in browser"
          className="absolute top-full right-0 left-0 z-20 flex items-center gap-1 border-b border-border bg-popover px-3 py-2 shadow-sm"
        >
          <Input
            ref={input}
            aria-label="Find on page"
            className="h-8 min-w-0 flex-1"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeFind();
              }
              if (event.key === "Enter") {
                event.preventDefault();
                void run({
                  kind: "browser.find",
                  query,
                  direction: event.shiftKey ? "previous" : "next",
                });
              }
            }}
          />
          <span
            aria-live="polite"
            className="min-w-8 text-center text-xs text-muted-foreground tabular-nums"
          >
            {find?.query === query && query
              ? `${find.current}/${find.total}${find.truncated ? "+" : ""}`
              : ""}
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Previous match"
            disabled={pending || !find?.total}
            onClick={() => void run({ kind: "browser.find", query, direction: "previous" })}
          >
            <ChevronUp aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Next match"
            disabled={pending || !find?.total}
            onClick={() => void run({ kind: "browser.find", query, direction: "next" })}
          >
            <ChevronDown aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Close find"
            onClick={closeFind}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      {error ? (
        <p
          role="status"
          className="absolute top-full inset-x-3 z-30 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-destructive shadow-sm"
        >
          {error}
        </p>
      ) : null}
      <Dialog
        open={history !== undefined}
        onOpenChange={(open) => {
          if (!open) setHistory(undefined);
        }}
      >
        <DialogContent>
          <DialogTitle>History</DialogTitle>
          <DialogDescription>Pages visited in this browser’s current tab.</DialogDescription>
          <Input
            aria-label="Search history"
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
            placeholder="Search history"
          />
          <div className="max-h-80 overflow-y-auto">
            {matches?.length ? (
              matches.map((row, index) => (
                <Button
                  key={`${row.url}:${index}`}
                  variant="ghost"
                  className="h-auto w-full justify-start text-left"
                  onClick={() => {
                    void navigate(row.url).then((sent) => {
                      if (sent) setHistory(undefined);
                    });
                  }}
                >
                  <span className="min-w-0 py-1">
                    <span className="block truncate">{row.title || row.url}</span>
                    <span className="block truncate text-xs text-muted-foreground">{row.url}</span>
                  </span>
                </Button>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {filter ? "No matching pages" : "No history yet"}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
