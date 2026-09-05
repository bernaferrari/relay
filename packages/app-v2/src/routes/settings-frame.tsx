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
    description: "This computer’s connection and notifications.",
  },
  evidence: {
    title: "Evidence",
    description: "What future Runs may capture.",
  },
  integrations: {
    title: "Integrations",
    description: "This workspace and any connected services.",
  },
  appearance: {
    title: "Appearance",
    description: "How Relay looks on this computer.",
  },
  advanced: {
    title: "Advanced",
    description: "Relay address and local device support.",
  },
  about: {
    title: "About",
    description: "Version, updates, and support.",
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
      <div className="mt-6 grid grid-cols-[168px_minmax(0,1fr)] items-start gap-12 max-[780px]:mt-5 max-[780px]:grid-cols-1 max-[780px]:gap-6">
        <nav
          className="sticky top-6 grid content-start gap-0.5 max-[780px]:static"
          aria-label="Settings sections"
        >
          {settingsCategories.map((item) => (
            <Link
              key={item.id}
              to={item.path}
              className={
                item.id === category
                  ? "grid min-h-9 content-center rounded-md bg-muted px-2.5 text-[13px] font-medium text-foreground transition-colors"
                  : "grid min-h-9 content-center rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              }
              aria-current={item.id === category ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <section
          className="grid min-w-0 max-w-[36rem] gap-6 pb-6"
          aria-label={`${copy.title} settings`}
        >
          {children}
        </section>
      </div>
    </LibraryPage>
  );
}

export function SettingsGroup({
  title,
  id,
  action,
  children,
}: {
  title?: string;
  id?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className="scroll-mt-6"
      id={id}
      aria-labelledby={title && id ? `${id}-title` : undefined}
    >
      {title || action ? (
        <div className="mb-2 flex min-h-6 items-center justify-between gap-3">
          {title ? (
            <h2
              className="text-[11px] font-medium tracking-wide text-muted-foreground"
              id={id ? `${id}-title` : undefined}
            >
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      <div className="grid">{children}</div>
    </section>
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
      className="flex min-h-14 items-center justify-between gap-6 border-b border-border py-3 last:border-b-0 scroll-mt-6"
      id={id}
    >
      <div className="grid min-w-0 gap-0.5">
        <h3 className="text-[13px] font-medium text-foreground">{title}</h3>
        <p className="max-w-[52ch] text-[13px] leading-5 text-muted-foreground">{description}</p>
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-2 text-[13px] text-muted-foreground">
          {children}
        </div>
      ) : null}
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
  const titleId = `${id}-title`;
  return (
    <div
      role="switch"
      aria-checked={checked}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={disabled ? -1 : 0}
      className={`flex min-h-14 cursor-pointer items-center justify-between gap-6 border-b border-border py-3 text-left last:border-b-0 scroll-mt-6 ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      onKeyDown={(event) => {
        if (disabled || (event.key !== " " && event.key !== "Enter")) return;
        event.preventDefault();
        onChange(!checked);
      }}
    >
      <span className="grid min-w-0 gap-0.5">
        <span id={titleId} className="text-[13px] font-medium text-foreground">
          {title}
        </span>
        <span
          id={descriptionId}
          className="max-w-[52ch] text-[13px] leading-5 text-muted-foreground"
        >
          {description}
        </span>
      </span>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-label={title}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="pointer-events-none"
      />
    </div>
  );
}
