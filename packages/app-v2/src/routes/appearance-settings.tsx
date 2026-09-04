/** @jsxImportSource react */
import { FieldLabel } from "@relay/ui-react/components/field";
import { RadioGroup, RadioGroupItem } from "@relay/ui-react/components/radio-group";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  APPEARANCE_STORAGE_KEY,
  applyColorScheme,
  validColorScheme,
  type ColorSchemePreference,
} from "../data/appearance-preference";
import { SettingsFrame, type SaveState } from "./settings-frame";

export function AppearanceSettings() {
  const { platform } = useRouteContext({ from: "__root__" });
  const [preference, setPreference] = useState<ColorSchemePreference>(() =>
    validColorScheme(document.documentElement.dataset.colorSchemePreference ?? null),
  );
  const [saveState, setSaveState] = useState<SaveState | undefined>();

  useEffect(() => {
    let active = true;
    void Promise.resolve(platform.storage.get(APPEARANCE_STORAGE_KEY)).then((stored) => {
      if (!active) return;
      const next = validColorScheme(stored);
      setPreference(next);
      applyColorScheme(next);
    });
    return () => {
      active = false;
    };
  }, [platform]);

  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => applyColorScheme("system");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preference]);

  async function choose(next: ColorSchemePreference) {
    setPreference(next);
    applyColorScheme(next);
    setSaveState("saving");
    try {
      await Promise.resolve(platform.storage.set(APPEARANCE_STORAGE_KEY, next));
      setSaveState("saved");
    } catch {
      setSaveState("failed");
    }
  }

  return (
    <SettingsFrame category="appearance" saveState={saveState}>
      <section className="relay-settings-group" aria-labelledby="appearance-title">
        <header>
          <p className="relay-section-label">Color scheme</p>
          <h2 id="appearance-title">Match the way you work</h2>
          <p>System follows this computer and changes automatically throughout the day.</p>
        </header>
        <RadioGroup
          className="relay-appearance-options"
          name="appearance"
          value={preference}
          onValueChange={(next) => void choose(next)}
          aria-labelledby="appearance-title"
        >
          {(["system", "light", "dark"] as const).map((value) => (
            <FieldLabel
              key={value}
              className="relay-appearance-option grid min-w-0 cursor-pointer rounded-lg border border-border bg-card text-card-foreground transition-colors outline-none hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
            >
              <span
                className="relay-appearance-leading flex w-full items-center justify-center rounded-md bg-transparent [&_svg]:size-4 [&_svg]:shrink-0"
                aria-hidden="true"
              >
                <span className={`relay-appearance-preview relay-appearance-preview--${value}`}>
                  <span />
                  <span />
                </span>
              </span>
              <span className="relay-appearance-copy grid min-w-0 gap-0.5 px-1">
                <span className="relay-appearance-title truncate font-medium text-foreground">
                  {value[0]!.toUpperCase() + value.slice(1)}
                </span>
                <span className="relay-appearance-description truncate text-muted-foreground">
                  {value === "system"
                    ? "Follow this computer"
                    : value === "light"
                      ? "Light surfaces"
                      : "Low-light surfaces"}
                </span>
              </span>
              <RadioGroupItem value={value} />
            </FieldLabel>
          ))}
        </RadioGroup>
      </section>
    </SettingsFrame>
  );
}
