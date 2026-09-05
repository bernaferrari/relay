/** @jsxImportSource react */
import { Switch } from "@relay/ui-react/components/switch";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { settingsCategories, type SettingsCategory } from "../data/settings-product-service";
import { SelectField } from "../components/filter-select";
import { LibraryPage, PageHeader } from "../components/page-layout";

export type SaveState = "saved" | "saving" | "failed" | "unavailable";

const SETTINGS_COPY: Record<SettingsCategory, { title: string; description: string }> = {
  general: {
    title: "General",
    description: "Server and preferences for this computer.",
  },
  evidence: {
    title: "Evidence & privacy",
    description: "Workspace policy for what future Runs may capture.",
  },
  integrations: {
    title: "Integrations",
    description: "Services available to your workspace.",
  },
  appearance: {
    title: "Appearance",
    description: "Choose how Relay looks on this computer.",
  },
  advanced: {
    title: "Advanced",
    description: "Review the local connection and device-support checks used by Relay.",
  },
  about: {
    title: "About",
    description: "Version, updates, and support for this Relay installation.",
  },
};

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function SaveStatus({ state }: { state: SaveState }) {
  return (
    <span
      className={`mt-0.5 inline-flex min-h-7 items-center gap-2 rounded-full bg-muted px-2.5 text-[11px] font-semibold text-muted-foreground ${
        state === "saved"
          ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
          : state === "failed" || state === "unavailable"
            ? "bg-red-500/10 text-red-700 dark:text-red-300"
            : ""
      }`}
      aria-live="polite"
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {state === "saving"
        ? "Saving…"
        : state === "failed"
          ? "Could not save"
          : state === "unavailable"
            ? "Unavailable"
            : "Saved"}
    </span>
  );
}

export function SettingsFrame({
  category,
  saveState,
  children,
}: {
  category: SettingsCategory;
  saveState?: SaveState;
  children: ReactNode;
}) {
  const rawSearch = useLocation({ select: (state) => state.search });
  const section = recordValue(rawSearch)?.section;
  const navigate = useNavigate();
  const copy = SETTINGS_COPY[category];
  const [visibleSaveState, setVisibleSaveState] = useState<SaveState | undefined>(saveState);

  useEffect(() => {
    setVisibleSaveState(saveState);
    if (saveState !== "saved") return;
    const timeout = window.setTimeout(() => setVisibleSaveState(undefined), 1_800);
    return () => window.clearTimeout(timeout);
  }, [saveState]);

  useEffect(() => {
    if (typeof section !== "string" || !section) return;
    document.getElementById(section)?.scrollIntoView?.({ block: "start" });
  }, [category, section]);

  return (
    <LibraryPage className="max-w-[1080px]">
      <PageHeader
        context="Settings"
        title={copy.title}
        description={copy.description}
        actions={visibleSaveState ? <SaveStatus state={visibleSaveState} /> : null}
      />
      <div className="hidden max-[780px]:block">
        <SelectField
          className="w-full"
          label="Settings section"
          value={`/settings/${category}`}
          options={settingsCategories.map((item) => ({ value: item.path, label: item.label }))}
          onValueChange={(value) => {
            void navigate({ to: value });
          }}
        />
      </div>
      <div className="mt-7 grid grid-cols-[180px_minmax(0,1fr)] items-start gap-8 max-[780px]:grid-cols-1">
        <nav
          className="sticky top-6 grid content-start gap-1 max-[780px]:static"
          aria-label="Settings sections"
        >
          {settingsCategories.map((item) => (
            <Link
              key={item.id}
              to={item.path}
              className={
                item.id === category
                  ? "grid min-h-11 content-center rounded-md bg-muted px-2.5 font-medium text-foreground transition-colors"
                  : "grid min-h-11 content-center rounded-md px-2.5 font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              }
              aria-current={item.id === category ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <section className="min-w-0" aria-label={`${copy.title} settings`}>
          {children}
        </section>
      </div>
    </LibraryPage>
  );
}

export function SettingRow({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <div
      className="flex min-h-[76px] items-center justify-between gap-6 border-b border-border py-3.5 last:border-b-0 scroll-mt-6"
      id={id}
    >
      <div className="grid min-w-0 gap-0.5">
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        <p className="max-w-[58ch] text-xs leading-normal text-muted-foreground">{description}</p>
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2.5">{children}</div> : null}
    </div>
  );
}

export function ToggleRow({
  id,
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}) {
  const descriptionId = `${id}-description`;
  return (
    <label
      className={`flex min-h-[76px] cursor-pointer items-center justify-between gap-6 border-b border-border py-3.5 last:border-b-0 scroll-mt-6 ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <span className="grid min-w-0 gap-0.5">
        <strong className="text-[13px] font-semibold text-foreground">{title}</strong>
        <span
          id={descriptionId}
          className="max-w-[58ch] text-xs leading-normal text-muted-foreground"
        >
          {description}
        </span>
      </span>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={descriptionId}
        onCheckedChange={onChange}
      />
    </label>
  );
}
