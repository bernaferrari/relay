/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useEffect, useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import type { DesktopUpdateState } from "../platform/types";
import { errorMessage } from "./settings-support";
import { SettingRow, SettingsFrame } from "./settings-frame";

function updateDescription(state: DesktopUpdateState | null): string {
  if (!state) return "Relay will report update availability when the desktop app supports it.";
  if (state.phase === "checking") return "Checking for a signed update…";
  if (state.phase === "available")
    return `${state.releaseName ?? state.version ?? "An update"} is available.`;
  if (state.phase === "downloaded")
    return `${state.releaseName ?? state.version ?? "An update"} is ready to install.`;
  if (state.phase === "error") return state.error ?? "Relay could not check for updates right now.";
  if (state.phase === "disabled") return "Automatic updates are disabled for this build.";
  if (state.phase === "unsupported") return "Updates are managed outside this app.";
  return "Relay checks for signed updates while the desktop app is running.";
}

export function AboutSettings() {
  const { platform } = useRouteContext({ from: "__root__" });
  const [update, setUpdate] = useState<DesktopUpdateState | null>(null);
  const [checking, setChecking] = useState(false);
  const [updateError, setUpdateError] = useState<string>();

  useEffect(() => {
    if (!platform.updates) return;
    let active = true;
    void platform.updates
      .getState()
      .then((state) => {
        if (active) setUpdate(state);
      })
      .catch((error: unknown) => {
        if (active) setUpdateError(errorMessage(error));
      });
    const unsubscribe = platform.updates.subscribe((state) => {
      if (active) setUpdate(state);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [platform]);

  async function checkForUpdates() {
    if (!platform.updates || checking) return;
    setChecking(true);
    setUpdateError(undefined);
    try {
      await platform.updates.check();
      setUpdate(await platform.updates.getState());
    } catch (error) {
      setUpdateError(errorMessage(error));
    } finally {
      setChecking(false);
    }
  }

  return (
    <SettingsFrame category="about">
      <section
        className="grid gap-3 rounded-xl border border-border bg-card p-5"
        aria-labelledby="about-product-title"
      >
        <header>
          <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
            Product
          </p>
          <h2 id="about-product-title">Relay</h2>
          <p>Proof that software works on real apps, browsers, and devices.</p>
        </header>
        <SettingRow title="Version" description="The build currently running on this computer.">
          <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-foreground">
            {platform.version ? `v${platform.version}` : "Development build"}
          </span>
        </SettingRow>
        <SettingRow title="Host" description="Where this Relay interface is running.">
          <span className="whitespace-nowrap text-xs font-semibold text-foreground">
            {platform.platform === "desktop" ? "Desktop app" : "Web browser"}
          </span>
        </SettingRow>
        {platform.updates ? (
          <SettingRow title="Updates" description={updateDescription(update)}>
            {update?.phase === "downloaded" ? (
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  setUpdateError(undefined);
                  void platform.updates
                    ?.install()
                    .catch((error: unknown) => setUpdateError(errorMessage(error)));
                }}
              >
                Install update
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void checkForUpdates()}
                disabled={checking || update?.phase === "checking"}
              >
                {checking || update?.phase === "checking" ? "Checking…" : "Check now"}
              </Button>
            )}
          </SettingRow>
        ) : null}
        {updateError ? (
          <p role="alert">Could not complete the update action. {updateError}</p>
        ) : null}
        <SettingRow
          title="Support"
          description="Read the project guide for setup, workflows, and troubleshooting."
        >
          {platform.openExternal ? (
            <Button
              size="sm"
              onClick={() => void platform.openExternal?.("https://github.com/bernaferrari/relay")}
            >
              Open project guide
            </Button>
          ) : (
            <span className="whitespace-nowrap text-xs font-semibold text-foreground">
              Available in the desktop app
            </span>
          )}
        </SettingRow>
      </section>
    </SettingsFrame>
  );
}
