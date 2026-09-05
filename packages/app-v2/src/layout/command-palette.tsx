/** @jsxImportSource react */
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { Input } from "@relay/ui-react/components/input";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useRouteContext } from "@tanstack/react-router";
import {
  AppWindow,
  Box,
  CircleDot,
  FlaskConical,
  GitCompareArrows,
  History,
  House,
  MonitorSmartphone,
  Plus,
  KeyRound,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { catalogQueryKeys } from "../data/catalog-queries";
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
  { id: "home", label: "Open Home", detail: "Workspace overview", href: "/home", icon: House },
  {
    id: "apps",
    label: "Manage apps",
    detail: "Builds, accounts, and coverage",
    href: "/apps",
    icon: AppWindow,
  },
  {
    id: "changes",
    label: "Open Changes",
    detail: "Review verification work",
    href: "/changes",
    icon: GitCompareArrows,
  },
  {
    id: "tests",
    label: "Open Tests",
    detail: "Reviewed journeys",
    href: "/tests",
    icon: FlaskConical,
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
    id: "devices",
    label: "Open Devices",
    detail: "Connected browsers and devices",
    href: "/devices",
    icon: MonitorSmartphone,
  },
  {
    id: "versions",
    label: "Manage versions",
    detail: "Workspace builds and deployments",
    href: "/versions",
    icon: Box,
  },
  {
    id: "accounts",
    label: "Manage browser accounts",
    detail: "Workspace managed-browser sign-ins",
    href: "/accounts",
    icon: KeyRound,
  },
  {
    id: "record-test",
    label: "Record a new Test",
    detail: "Start from a live target",
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
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
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
    queryKey: catalogQueryKeys.tests,
    queryFn: () => catalogService.listTests(),
    enabled: open,
    staleTime: 30_000,
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
    const active = document.getElementById(`relay-command-${activeId}`);
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
        showCloseButton={false}
        className="relay-command-palette w-[min(620px,calc(100vw-32px))] max-h-[min(620px,calc(100dvh-48px))] overflow-hidden rounded-[var(--radius-xl)] p-0 shadow-[var(--shadow-lg)]"
      >
        <DialogTitle className="relay-visually-hidden">Relay commands</DialogTitle>
        <DialogDescription className="relay-visually-hidden">
          Search destinations and common product actions.
        </DialogDescription>
        <div className="relay-command-search grid min-h-[58px] grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-[9px] border-b border-[var(--border-weak-base)] px-4 py-2">
          <Search aria-hidden="true" />
          <Input
            autoFocus
            aria-label="Search commands"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="relay-command-results"
            aria-expanded={commands.length > 0}
            placeholder="Search Relay…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            aria-activedescendant={
              commands[activeIndex] ? `relay-command-${commands[activeIndex].id}` : undefined
            }
            className="relay-input min-h-[42px] border-0 bg-transparent p-0 text-base shadow-none focus-visible:outline-0"
          />
          <kbd className="min-w-7 rounded-[var(--radius-sm)] border border-[var(--border-weak-base)] bg-[var(--background-weak)] px-[5px] py-0.5 text-center text-[10px] leading-[1.4] text-[var(--text-weaker)]">
            Esc
          </kbd>
        </div>
        <ScrollArea className="relay-command-results max-h-[min(480px,calc(100dvh-150px))] p-1.5">
          <div
            id="relay-command-results"
            role="listbox"
            aria-label="Commands"
            className="flex flex-col gap-0.5"
          >
            {commands.length ? (
              commands.map((command, index) => (
                <button
                  role="option"
                  type="button"
                  className={`relay-command-item flex min-h-11 w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-left text-sm${index === activeIndex ? " relay-command-item--active bg-[var(--surface-base-active)]" : ""}`}
                  key={command.id}
                  id={`relay-command-${command.id}`}
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(command)}
                >
                  <command.icon className="h-[17px] w-[17px] shrink-0" aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <strong className="overflow-hidden text-ellipsis whitespace-nowrap font-medium">
                      {command.label}
                    </strong>
                    <small className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--text-weaker)]">
                      {command.detail}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <p className="relay-command-empty p-6 text-center text-sm text-[var(--text-weaker)]">
                No matching commands
              </p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
