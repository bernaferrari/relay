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
import {
  ACCESSIBILITY_LABELS_STORAGE_KEY,
  ACCESSIBILITY_LABEL_MODE_OPTIONS,
  validAccessibilityLabelMode,
  type AccessibilityLabelMode,
} from "../data/talkback-overlay";
import { SettingsFrame, SettingsGroup, type SaveState } from "./settings-frame";

const schemes = [
  { value: "system", title: "System", description: "Follow this computer" },
  { value: "light", title: "Light", description: "Light surfaces" },
  { value: "dark", title: "Dark", description: "Low-light surfaces" },
] as const;

const radioCardClassName =
  "relative grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_20px] gap-2 rounded-lg border border-border bg-card p-1.5 pb-3 text-card-foreground outline-none transition-[border-color,background-color,box-shadow,transform] duration-150 ease-out hover:bg-muted/50 active:scale-[0.96] has-data-checked:border-foreground has-data-checked:bg-muted has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 max-[620px]:grid-cols-[minmax(0,1fr)_20px]";

function SchemePreview({ value }: { value: ColorSchemePreference }) {
  const pane = (tone: "light" | "dark") =>
    tone === "dark"
      ? "bg-[var(--relay-preview-dark-canvas)]"
      : "bg-[var(--relay-preview-light-canvas)]";
  const rail = (tone: "light" | "dark") =>
    tone === "dark"
      ? "bg-[var(--relay-preview-dark-panel)]"
      : "bg-[var(--relay-preview-light-panel)]";
  const line = (tone: "light" | "dark") =>
    tone === "dark"
      ? "bg-[var(--relay-preview-dark-line)]"
      : "bg-[var(--relay-preview-light-line)]";
  return (
    <span
      className="relative block h-[86px] w-full overflow-hidden rounded-[10px] border border-border"
      aria-hidden="true"
    >
      {value === "system" ? (
        <>
          <span className={`absolute inset-y-0 left-0 w-1/2 ${pane("light")}`} />
          <span className={`absolute inset-y-0 right-0 w-1/2 ${pane("dark")}`} />
          <span className={`absolute inset-y-0 left-0 w-[18%] ${rail("light")}`} />
          <span className={`absolute inset-y-0 left-1/2 w-[18%] ${rail("dark")}`} />
          <span className={`absolute left-[22%] top-5 h-2 w-[22%] rounded-full ${line("light")}`} />
          <span className={`absolute right-[8%] top-5 h-2 w-[22%] rounded-full ${line("dark")}`} />
        </>
      ) : (
        <>
          <span className={`absolute inset-0 ${pane(value)}`} />
          <span className={`absolute inset-y-0 left-0 w-[30%] ${rail(value)}`} />
          <span className={`absolute right-3 top-5 h-2 w-[48%] rounded-full ${line(value)}`} />
          <span
            className={`absolute right-3 top-9 h-[26px] w-[58%] rounded-[5px] ${rail(value)}`}
          />
        </>
      )}
    </span>
  );
}

export function AppearanceSettings() {
  const { platform } = useRouteContext({ from: "__root__" });
  const [preference, setPreference] = useState<ColorSchemePreference>(() =>
    validColorScheme(document.documentElement.dataset.colorSchemePreference ?? null),
  );
  const [labelMode, setLabelMode] = useState<AccessibilityLabelMode>("off");
  const [saveState, setSaveState] = useState<SaveState | undefined>();
  const [problem, setProblem] = useState<string>();
  const [failedKind, setFailedKind] = useState<"color" | "names">();
  const colorChosen = useRef(false);
  const namesChosen = useRef(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      Promise.resolve(platform.storage.get(APPEARANCE_STORAGE_KEY)),
      Promise.resolve(platform.storage.get(ACCESSIBILITY_LABELS_STORAGE_KEY)),
    ])
      .then(([storedColor, storedNames]) => {
        if (!active) return;
        if (!colorChosen.current) {
          const next = validColorScheme(storedColor);
          setPreference(next);
          applyColorScheme(next);
        }
        if (!namesChosen.current) setLabelMode(validAccessibilityLabelMode(storedNames));
      })
      .catch(() => {
        if (active && !colorChosen.current)
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

  async function chooseColor(next: ColorSchemePreference) {
    colorChosen.current = true;
    setPreference(next);
    applyColorScheme(next);
    setSaveState("saving");
    setProblem(undefined);
    setFailedKind(undefined);
    try {
      await Promise.resolve(platform.storage.set(APPEARANCE_STORAGE_KEY, next));
      setSaveState("saved");
    } catch {
      setSaveState("failed");
      setFailedKind("color");
      setProblem("Your color scheme is applied here, but could not be saved for next time.");
    }
  }

  async function chooseNames(next: AccessibilityLabelMode) {
    namesChosen.current = true;
    setLabelMode(next);
    setSaveState("saving");
    setProblem(undefined);
    setFailedKind(undefined);
    try {
      await Promise.resolve(platform.storage.set(ACCESSIBILITY_LABELS_STORAGE_KEY, next));
      setSaveState("saved");
    } catch {
      setSaveState("failed");
      setFailedKind("names");
      setProblem("Accessibility names are applied here, but could not be saved for next time.");
    }
  }

  return (
    <SettingsFrame category="appearance" saveState={saveState}>
      <div className="grid gap-8">
        <RadioGroup
          className="grid grid-cols-3 gap-3 p-0 max-[620px]:grid-cols-1"
          name="appearance"
          value={preference}
          disabled={saveState === "saving"}
          onValueChange={(next) => {
            if (next === "system" || next === "light" || next === "dark") void chooseColor(next);
          }}
          aria-label="Color scheme"
        >
          {schemes.map((scheme) => (
            <FieldLabel key={scheme.value} className={radioCardClassName}>
              <span className="col-span-2 flex w-full items-center justify-center rounded-md bg-transparent">
                <SchemePreview value={scheme.value} />
              </span>
              <span className="grid min-w-0 gap-0.5 px-1">
                <span className="truncate font-medium text-foreground">{scheme.title}</span>
                <span className="truncate text-muted-foreground">{scheme.description}</span>
              </span>
              <RadioGroupItem value={scheme.value} />
            </FieldLabel>
          ))}
        </RadioGroup>

        <SettingsGroup title="Live view" id="accessibility-names">
          <p className="mb-3 max-w-[52ch] text-[13px] leading-5 text-muted-foreground">
            Show the accessibility name of each control on the live view. TalkBack and VoiceOver
            stay off.
          </p>
          <RadioGroup
            className="grid grid-cols-3 gap-3 p-0 max-[620px]:grid-cols-1"
            name="accessibility-names"
            value={labelMode}
            disabled={saveState === "saving"}
            onValueChange={(next) => void chooseNames(validAccessibilityLabelMode(next))}
            aria-label="Accessibility names"
          >
            {ACCESSIBILITY_LABEL_MODE_OPTIONS.map((option) => (
              <FieldLabel key={option.value} className={radioCardClassName}>
                <span className="col-span-2 grid min-h-[86px] content-center gap-1 px-1 py-3">
                  <span className="font-medium text-foreground">{option.label}</span>
                  <span className="text-muted-foreground">{option.description}</span>
                </span>
                <RadioGroupItem value={option.value} />
              </FieldLabel>
            ))}
          </RadioGroup>
        </SettingsGroup>

        {problem ? (
          <div role="alert" className="grid gap-2 text-[13px] text-muted-foreground">
            <p>{problem}</p>
            {saveState === "failed" ? (
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() =>
                  void (failedKind === "names" ? chooseNames(labelMode) : chooseColor(preference))
                }
              >
                Retry saving
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </SettingsFrame>
  );
}
