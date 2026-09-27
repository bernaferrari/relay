/** @jsxImportSource react */
import { applyColorScheme, RelayApp, validColorScheme } from "@relay/app";
import "@relay/app/index.css";
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
    <RelayApp platform={createDesktopPlatform()} />
  </StrictMode>,
);
