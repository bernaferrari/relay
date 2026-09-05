/** @jsxImportSource react */
import { FieldLabel } from "@relay/ui-react/components/field";
import { RadioGroup, RadioGroupItem } from "@relay/ui-react/components/radio-group";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@relay/ui-react/components/button";
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
  const [problem, setProblem] = useState<string>();
  const chosen = useRef(false);

  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => platform.storage.get(APPEARANCE_STORAGE_KEY))
      .then((stored) => {
        if (!active || chosen.current) return;
        const next = validColorScheme(stored);
        setPreference(next);
        applyColorScheme(next);
      })
      .catch(() => {
        if (active && !chosen.current)
          setProblem(
            "Could not load your saved appearance. Choose a color scheme to save it again.",
          );
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
    chosen.current = true;
    setPreference(next);
    applyColorScheme(next);
    setSaveState("saving");
    setProblem(undefined);
    try {
      await Promise.resolve(platform.storage.set(APPEARANCE_STORAGE_KEY, next));
      setSaveState("saved");
    } catch {
      setSaveState("failed");
      setProblem("Your color scheme is applied here, but could not be saved for next time.");
    }
  }

  return (
    <SettingsFrame category="appearance" saveState={saveState}>
      <section className="grid gap-3 rounded-xl border border-border bg-card p-5" aria-labelledby="appearance-title">
        <header>
          <h2 id="appearance-title">Color scheme</h2>
          <p>System follows this computer and changes automatically throughout the day.</p>
        </header>
        <RadioGroup
          className="relay-appearance-options"
          name="appearance"
          value={preference}
          disabled={saveState === "saving"}
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
        {problem ? (
          <div role="alert" className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
            <p>{problem}</p>
            {saveState === "failed" ? (
              <Button variant="outline" onClick={() => void choose(preference)}>
                Retry saving
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    </SettingsFrame>
  );
}
