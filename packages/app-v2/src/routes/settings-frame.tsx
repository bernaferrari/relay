/** @jsxImportSource react */
import { Switch } from "@relay/ui-react/components/switch";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { settingsCategories, type SettingsCategory } from "../data/settings-product-service";
import { SelectField } from "../components/filter-select";

export type SaveState = "saved" | "saving" | "failed" | "unavailable";

const SETTINGS_COPY: Record<SettingsCategory, { title: string; description: string }> = {
  general: {
    title: "General",
    description: "Server and preferences for this computer.",
  },
  evidence: {
    title: "Evidence & privacy",
    description: "Control what future Runs may capture before evidence is saved.",
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
    description: "Version, update, and support information for Relay.",
  },
};

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function SaveStatus({ state }: { state: SaveState }) {
  return (
    <span className={`mt-4 flex items-center gap-2`} aria-live="polite">
      <span aria-hidden="true" />
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
    <section className="relay-page mx-auto w-full px-[clamp(20px,3vw,40px)] pt-7 pb-10 max-w-[1080px]">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="relay-eyebrow mb-2 text-[11px] font-semibold tracking-[0.02em] text-[var(--text-weak)]">
            Settings
          </p>
          <h1 className="text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance] text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance]">
            {copy.title}
          </h1>
          <p className="relay-page-description mt-2.5 max-w-[62ch] text-[15px] leading-[1.55] text-[var(--text-weak)]">
            {copy.description}
          </p>
        </div>
        {visibleSaveState ? <SaveStatus state={visibleSaveState} /> : null}
      </header>
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
      <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-8 max-[780px]:grid-cols-1">
        <nav className="grid content-start gap-1" aria-label="Settings sections">
          {settingsCategories.map((item) => (
            <Link
              key={item.id}
              to={item.path}
              className={
                item.id === category
                  ? "relay-settings-nav-link grid content-start gap-1 bg-muted text-foreground"
                  : "relay-settings-nav-link grid content-start gap-1"
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
    <div className="relay-setting-row" id={id}>
      <div className="relay-setting-row-copy">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {children ? <div className="relay-setting-row-control">{children}</div> : null}
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
      className={`relay-setting-row relay-setting-toggle-row${disabled ? " relay-setting-row--disabled" : ""}`}
    >
      <span className="relay-setting-row-copy">
        <strong>{title}</strong>
        <span id={descriptionId}>{description}</span>
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
