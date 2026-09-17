/** @jsxImportSource react */
import { applyColorScheme, RelayV2App, validColorScheme } from "@relay/app-v2";
import "@relay/app-v2/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createDesktopPlatform } from "./desktop-platform";
import "./globals.css";

try {
  const stored =
    localStorage.getItem("relay-color-scheme") ??
    localStorage.getItem("relay:appearance.colorScheme");
  applyColorScheme(validColorScheme(stored));
} catch {
  applyColorScheme("system");
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <RelayV2App platform={createDesktopPlatform()} />
  </StrictMode>,
);
