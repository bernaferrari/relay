import { primaryDestinations } from "./primary-destinations";
/** @jsxImportSource react */
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useRouteContext } from "@tanstack/react-router";
import {
  AppWindow,
  Box,
  CircleDot,
  FlaskConical,
  History,
  Plus,
  KeyRound,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { recordingQueryKeys } from "../data/recording-queries";
import { readWorkflowPointer } from "../data/workflow-pointer";

type Command = {
  id: string;
  label: string;
  detail: string;
  href: string;
  icon: LucideIcon;
  keywords?: string;
};

const workspaceCommands: readonly Command[] = [
  ...primaryDestinations.map((destination) => ({
    id: destination.to.slice(1),
    label: `Open ${destination.label}`,
    detail: destination.detail,
    href: destination.to,
    icon: destination.icon,
    keywords: destination.keywords,
  })),
  {
    id: "apps",
    label: "Manage apps",
    detail: "Builds, accounts, and coverage",
    href: "/apps",
    icon: AppWindow,
  },

  {
    id: "failed-runs",
    label: "Review failed Runs",
    detail: "Open failure-first Run history",
    href: "/runs?view=failed",
    icon: History,
    keywords: "reports failures",
  },

  {
    id: "versions",
    label: "Manage versions",
    detail: "Builds you can run against",
    href: "/versions",
    icon: Box,
  },
  {
    id: "accounts",
    label: "Manage sign-ins",
    detail: "Saved browser sign-ins",
    href: "/accounts",
    icon: KeyRound,
  },
  {
    id: "record-test",
    label: "Record a new Test",
    detail: "Start from a device or browser",
    href: "/tests/new",
    icon: Plus,
  },
];

export function commandMatches(
  command: Pick<Command, "label" | "detail" | "keywords">,
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return `${command.label} ${command.detail} ${command.keywords ?? ""}`
    .toLocaleLowerCase()
    .includes(normalized);
}

export function CommandPalette({
  open,
  onOpenChange,
  returnFocus,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const router = useRouter();
  const { platform, productService, catalogService } = useRouteContext({ from: "__root__" });
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const apps = useQuery({
    queryKey: recordingQueryKeys.apps,
    queryFn: () => productService.listApps(),
    enabled: open,
    staleTime: 30_000,
  });
  const tests = useQuery({
    queryKey: ["command-palette", "tests"] as const,
    queryFn: () => catalogService.listTests(),
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const recording = useQuery({
    queryKey: recordingQueryKeys.pointer,
    queryFn: async () => (await readWorkflowPointer(platform)) ?? null,
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLocaleLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      onOpenChange(!open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const commands = useMemo(() => {
    const contextual: Command[] = [];
    if (recording.data) {
      contextual.push({
        id: "continue-recording",
        label: "Continue recording",
        detail: "Return to the active recording",
        href: `/recordings/${encodeURIComponent(recording.data)}`,
        icon: CircleDot,
      });
    }
    for (const app of apps.data ?? []) {
      contextual.push({
        id: `app:${app.id}`,
        label: `Open ${app.name}`,
        detail: "App overview",
        href: `/apps/${encodeURIComponent(app.id)}`,
        icon: AppWindow,
        keywords: "application",
      });
    }
    // Search the complete catalog before rendering results. Limiting the
    // source list first makes exact searches fail for the 31st test onward.
    for (const test of tests.data ?? []) {
      contextual.push({
        id: `test:${test.appMapId}:${test.id}`,
        label: `Open ${test.name}`,
        detail: `${test.appName} · ${test.stepCount} ${test.stepCount === 1 ? "step" : "steps"}`,
        href: `/tests/${encodeURIComponent(test.id)}`,
        icon: FlaskConical,
        keywords: "run test",
      });
    }
    return [...contextual, ...workspaceCommands].filter((command) =>
      commandMatches(command, query),
    );
  }, [apps.data, query, recording.data, tests.data]);

  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    const activeId = commands[activeIndex]?.id;
    if (!activeId) return;
    const active = document.getElementById(`${activeId}`);
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, commands]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!commands.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % commands.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + commands.length) % commands.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(commands[activeIndex] ?? commands[0]!);
    }
  }

  function choose(command: Command) {
    onOpenChange(false);
    router.history.push(command.href);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        finalFocus={returnFocus}
        showCloseButton={false}
        className="w-[min(560px,calc(100vw-32px))] max-h-[min(620px,calc(100dvh-48px))] gap-0 overflow-hidden rounded-xl p-0 shadow-[var(--shadow-lg)]"
      >
        <DialogTitle className="sr-only">Relay commands</DialogTitle>
        <DialogDescription className="sr-only">
          Search destinations and common product actions.
        </DialogDescription>
        <div className="flex min-h-14 items-center gap-3 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            aria-label="Search commands"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="command-results"
            aria-expanded={commands.length > 0}
            placeholder="Search Relay…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            aria-activedescendant={
              commands[activeIndex] ? `${commands[activeIndex].id}` : undefined
            }
            className="h-14 min-w-0 flex-1 bg-transparent text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded-sm border border-border px-1.5 py-0.5 text-xs leading-snug text-muted-foreground">
            Esc
          </kbd>
        </div>
        <ScrollArea className="max-h-[min(480px,calc(100dvh-150px))] p-2">
          <div
            id="command-results"
            role="listbox"
            aria-label="Commands"
            className="flex flex-col gap-0.5"
          >
            {tests.isError ? (
              <div
                className="grid gap-2 p-6 text-center text-sm text-muted-foreground"
                role="alert"
              >
                <p>
                  Test search is unavailable. Try again or use the available workspace commands.
                </p>
                <button
                  className="mx-auto min-h-10 rounded-md border border-input px-3 font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                  type="button"
                  onClick={() => void tests.refetch()}
                >
                  Try again
                </button>
              </div>
            ) : null}
            {commands.length ? (
              commands.map((command, index) => (
                <button
                  role="option"
                  type="button"
                  className={`flex min-h-11 w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm${index === activeIndex ? "bg-accent" : ""}`}
                  key={command.id}
                  id={`${command.id}`}
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(command)}
                >
                  <command.icon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <strong className="overflow-hidden text-ellipsis whitespace-nowrap font-medium">
                      {command.label}
                    </strong>
                    <small className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">
                      {command.detail}
                    </small>
                  </span>
                </button>
              ))
            ) : tests.isError ? null : (
              <p className="p-6 text-center text-sm text-muted-foreground">No matching commands</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
