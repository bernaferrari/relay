import { type ParentProps, createSignal, Show } from "solid-js";
import { ThemeProvider, type ThemeAppliedDetail } from "@grok-device/ui/theme/context";
import { PlatformProvider, type Platform } from "./context/platform";
import { ServerProvider } from "./context/server";
import { CommandProvider } from "./context/command";
import { ToastProvider } from "./context/toast";
import { RecorderProvider } from "./context/recorder";
import { Layout } from "./components/layout";
import { HomePage } from "./pages/home";
import { SettingsPage } from "./pages/settings";
/* Product chrome — must load for every host (web + desktop Electron). */
import "./index.css";

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
        defaultTheme={props.defaultTheme ?? "grok"}
        defaultColorScheme={props.defaultColorScheme ?? "system"}
        onThemeApplied={props.onThemeApplied}
      >
        <ServerProvider>
          <ToastProvider>
            <RecorderProvider>
              <CommandProvider>{props.children}</CommandProvider>
            </RecorderProvider>
          </ToastProvider>
        </ServerProvider>
      </ThemeProvider>
    </PlatformProvider>
  );
}

/** Main product UI — Stage testing workspace. */
export function AppInterface() {
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  return (
    <Layout onOpenSettings={() => setSettingsOpen(true)}>
      <HomePage />
      <Show when={settingsOpen()}>
        <SettingsPage onClose={() => setSettingsOpen(false)} />
      </Show>
    </Layout>
  );
}
