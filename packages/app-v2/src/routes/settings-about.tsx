/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useEffect, useState } from "react";
import { Link, useRouteContext } from "@tanstack/react-router";
import type { DesktopUpdateState } from "../platform/types";
import { errorMessage } from "./settings-support";
import { SettingRow, SettingsFrame, SettingsGroup } from "./settings-frame";

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
      <section aria-labelledby="getting-started-title" className="grid gap-4">
        <div className="grid gap-1.5">
          <h2 id="getting-started-title" className="text-lg font-semibold">
            Your first Test
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Record what you do in your app, run those steps again, then review the screenshots.
          </p>
        </div>
        <ol className="m-0 grid list-none gap-5 p-0">
          <li className="flex gap-3">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm"
              aria-hidden="true"
            >
              1
            </span>
            <div className="grid gap-1">
              <h3 className="text-sm font-medium">Record a journey</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Choose your app and a browser or device. Record the steps and capture the screens
                you want to check. Save them as a Test.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm"
              aria-hidden="true"
            >
              2
            </span>
            <div className="grid gap-1">
              <h3 className="text-sm font-medium">Run the saved Test</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Open the Test, choose where to run it, and start. Use Run across when you want to
                try several sets of values.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm"
              aria-hidden="true"
            >
              3
            </span>
            <div className="grid gap-1">
              <h3 className="text-sm font-medium">Review the result</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Open Results to see what happened. A completed run means the steps finished; review
                its screenshots to decide whether the app looks correct.
              </p>
            </div>
          </li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button render={<Link to="/tests/new" />}>Record a Test</Button>
          <Button variant="ghost" render={<Link to="/runs" search={{ view: "needs-review" }} />}>
            Review screenshots
          </Button>
        </div>
      </section>
      <details className="border-t border-border pt-4">
        <summary className="cursor-pointer py-2 text-sm font-medium">
          Tests, Plans, and Results
        </summary>
        <dl className="grid gap-3 pt-2 text-sm leading-relaxed">
          <div>
            <dt className="font-medium">Test</dt>
            <dd className="m-0 text-muted-foreground">A saved journey you can run again.</dd>
          </div>
          <div>
            <dt className="font-medium">Plan</dt>
            <dd className="m-0 text-muted-foreground">
              A group of Tests you want to run together. Find Plans inside Tests.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Result</dt>
            <dd className="m-0 text-muted-foreground">
              What happened during a run, including screenshots and any problems.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Data set</dt>
            <dd className="m-0 text-muted-foreground">
              Values a Test uses, such as a language or a search term.
            </dd>
          </div>
        </dl>
      </details>
      <SettingsGroup title="About Relay">
        <SettingRow title="Version" description="The build running on this computer.">
          <span className="tabular-nums">
            {platform.version ? `v${platform.version}` : "Development build"}
          </span>
        </SettingRow>
        <SettingRow title="Host" description="Where this Relay interface is running.">
          {platform.platform === "desktop" ? "Desktop app" : "Web browser"}
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
                variant="ghost"
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
        <SettingRow title="Support" description="Setup, workflows, and troubleshooting.">
          {platform.openExternal ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void platform.openExternal?.("https://github.com/bernaferrari/relay")}
            >
              Open project guide
            </Button>
          ) : (
            "Available in the desktop app"
          )}
        </SettingRow>
      </SettingsGroup>
    </SettingsFrame>
  );
}
