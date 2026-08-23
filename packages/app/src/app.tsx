import { type ParentProps, createSignal, Show } from "solid-js";
import { ThemeProvider, type ThemeAppliedDetail } from "@relay/ui/theme/context";
import { PlatformProvider, type Platform } from "./context/platform";
import { ServerProvider } from "./context/server";
import { CommandProvider } from "./context/command";
import { AppMapExecutionProvider } from "./context/app-map-execution";
import { WorkbenchProvider } from "./context/workbench";
import { RecorderProvider } from "./context/recorder";
import { Layout } from "./components/layout";
import { StudioShell } from "./components/studio-shell";
import { SettingsPage, type SettingsSection } from "./pages/settings";
import { DesktopUpdateDialog } from "./components/desktop-update";
import { ConfirmDialogHost } from "./components/confirm-dialog";
/* Product chrome — must load for every host (web + desktop Electron). */
import "./styles/app.css";

/** Root providers for web and desktop shells. */
export function AppBaseProviders(
  props: ParentProps<{
    platform: Platform;
    defaultTheme?: string;
    defaultColorScheme?: "light" | "dark" | "system";
    onThemeApplied?: (detail: ThemeAppliedDetail) => void;
  }>,
) {
  return (
    <PlatformProvider value={props.platform}>
      <ThemeProvider
        defaultTheme={props.defaultTheme ?? "relay"}
        defaultColorScheme={props.defaultColorScheme ?? "light"}
        onThemeApplied={props.onThemeApplied}
      >
        <ServerProvider>
          <AppMapExecutionProvider>
            <WorkbenchProvider>
              <RecorderProvider>
                <CommandProvider>{props.children}</CommandProvider>
              </RecorderProvider>
            </WorkbenchProvider>
          </AppMapExecutionProvider>
        </ServerProvider>
      </ThemeProvider>
    </PlatformProvider>
  );
}

/** Main product UI — App Map workspace. */
export function AppInterface() {
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [settingsSection, setSettingsSection] = createSignal<SettingsSection>("appearance");
  const openSettings = (section: SettingsSection = "appearance") => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };

  return (
    <Layout onOpenSettings={() => openSettings()}>
      <StudioShell onOpenSettings={openSettings} />
      <Show when={settingsOpen()}>
        <SettingsPage initialSection={settingsSection()} onClose={() => setSettingsOpen(false)} />
      </Show>
      <DesktopUpdateDialog />
      <ConfirmDialogHost />
    </Layout>
  );
}
