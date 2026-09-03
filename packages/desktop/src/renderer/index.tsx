import { render } from "solid-js/web";
import { AppBaseProviders, AppInterface, type Platform, type ThemeAppliedDetail } from "@relay/app";
/* App CSS pulls AgentBoard-shaped @relay/ui/styles/tailwind + v2 */
import "@relay/app/index.css";
import "./styles.css";
import { createDesktopPlatform } from "./desktop-platform";

function onThemeApplied(detail: ThemeAppliedDetail) {
  void window.api.setBackgroundColor(detail.background);
  // Keep the hidden native titlebar surface in sync with the product canvas.
  document.documentElement.style.setProperty("--desktop-bg", detail.background);
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found");
}

const platform: Platform = createDesktopPlatform();

render(
  () => (
    <AppBaseProviders platform={platform} onThemeApplied={onThemeApplied}>
      <AppInterface />
    </AppBaseProviders>
  ),
  root,
);
