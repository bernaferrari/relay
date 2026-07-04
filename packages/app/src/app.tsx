import { type ParentProps, createSignal, Show } from "solid-js";
import { ThemeProvider } from "@grok-device/ui/theme/context";
import { PlatformProvider, type Platform } from "./context/platform";
import { ServerProvider } from "./context/server";
import { Layout, type AppView } from "./components/layout";
import { HomePage } from "./pages/home";
import { SettingsPage } from "./pages/settings";

/** Root providers for web and desktop shells. */
export function AppBaseProviders(
  props: ParentProps<{
    platform: Platform;
    defaultTheme?: string;
  }>,
) {
  return (
    <PlatformProvider value={props.platform}>
      <ThemeProvider defaultTheme={props.defaultTheme ?? "grok"} defaultColorScheme="system">
        <ServerProvider>{props.children}</ServerProvider>
      </ThemeProvider>
    </PlatformProvider>
  );
}

/** Main product UI (home + settings). */
export function AppInterface() {
  const [view, setView] = createSignal<AppView>("home");

  return (
    <Layout view={view()} onNavigate={setView}>
      <Show when={view() === "home"} fallback={<SettingsPage />}>
        <HomePage />
      </Show>
    </Layout>
  );
}
