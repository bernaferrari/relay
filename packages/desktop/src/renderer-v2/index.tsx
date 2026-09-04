/** @jsxImportSource react */
import { RelayV2App } from "@relay/app-v2";
import "@relay/app-v2/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createDesktopPlatform } from "./desktop-platform";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <RelayV2App platform={createDesktopPlatform()} />
  </StrictMode>,
);
