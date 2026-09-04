/** @jsxImportSource react */
import { RadioCard, RadioGroup } from "@relay/ui-react";
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
          value={preference}
          onValueChange={(next) => void choose(next)}
          aria-labelledby="appearance-title"
        >
          {(["system", "light", "dark"] as const).map((value) => (
            <RadioCard
              key={value}
              value={value}
              className="relay-appearance-option"
              title={value[0]!.toUpperCase() + value.slice(1)}
              description={
                value === "system"
                  ? "Follow this computer"
                  : value === "light"
                    ? "Light surfaces"
                    : "Low-light surfaces"
              }
              leading={
                <span className={`relay-appearance-preview relay-appearance-preview--${value}`}>
                  <span />
                  <span />
                </span>
              }
            />
          ))}
        </RadioGroup>
      </section>
    </SettingsFrame>
  );
}
