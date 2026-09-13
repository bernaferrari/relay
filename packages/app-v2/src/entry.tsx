/** @jsxImportSource react */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RelayV2App } from "./app";
import { applyColorScheme, validColorScheme } from "./data/appearance-preference";
import { createWebPlatform } from "./platform/web-platform";
import "./styles/globals.css";

try {
  applyColorScheme(
    validColorScheme(
      localStorage.getItem("relay-color-scheme") ??
        localStorage.getItem("relay:appearance.colorScheme"),
    ),
  );
} catch {
  applyColorScheme("system");
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <RelayV2App platform={createWebPlatform()} />
  </StrictMode>,
);
