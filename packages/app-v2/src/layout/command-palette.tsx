/** @jsxImportSource react */
import { Dialog, Input, ScrollArea } from "@relay/ui-react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useRouteContext } from "@tanstack/react-router";
import {
  AppWindow,
  CircleDot,
  FlaskConical,
  GitCompareArrows,
  History,
  House,
  MonitorSmartphone,
  Plus,
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
    if (!open) setQuery("");
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
    for (const test of (tests.data ?? []).slice(0, 30)) {
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

  function choose(command: Command) {
    onOpenChange(false);
    router.history.push(command.href);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="relay-dialog-backdrop relay-command-backdrop" />
        <Dialog.Viewport className="relay-dialog-viewport relay-command-viewport">
          <Dialog.Popup className="relay-overlay-popup relay-command-palette">
            <Dialog.Title className="relay-visually-hidden">Relay commands</Dialog.Title>
            <Dialog.Description className="relay-visually-hidden">
              Search destinations and common product actions.
            </Dialog.Description>
            <div className="relay-command-search">
              <Search aria-hidden="true" />
              <Input
                autoFocus
                aria-label="Search commands"
                placeholder="Search Relay…"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
              <kbd>Esc</kbd>
            </div>
            <ScrollArea className="relay-command-results">
              {commands.length ? (
                <div role="list" aria-label="Commands">
                  {commands.map((command) => (
                    <button
                      type="button"
                      className="relay-command-item"
                      key={command.id}
                      onClick={() => choose(command)}
                    >
                      <command.icon aria-hidden="true" />
                      <span>
                        <strong>{command.label}</strong>
                        <small>{command.detail}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="relay-command-empty">No matching commands</p>
              )}
            </ScrollArea>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
