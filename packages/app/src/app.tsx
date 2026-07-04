import { type ParentProps, createSignal, Show } from "solid-js";
import { ThemeProvider, type ThemeAppliedDetail } from "@grok-device/ui/theme/context";
import { PlatformProvider, type Platform } from "./context/platform";
import { ServerProvider } from "./context/server";
import { CommandProvider } from "./context/command";
import { Layout, type AppView } from "./components/layout";
import { HomePage } from "./pages/home";
import { SettingsPage } from "./pages/settings";

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
          <CommandProvider>{props.children}</CommandProvider>
        </ServerProvider>
      </ThemeProvider>
    </PlatformProvider>
  );
}

/** Main product UI — Stage testing workspace. */
export function AppInterface() {
  const [view, setView] = createSignal<AppView>("workspace");

  return (
    <Layout view={view()} onNavigate={setView}>
      <Show when={view() === "workspace"} fallback={<SettingsPage />}>
        <HomePage />
      </Show>
    </Layout>
  );
}
