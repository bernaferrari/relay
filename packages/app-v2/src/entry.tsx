/** @jsxImportSource react */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RelayV2App } from "./app";
import { createWebPlatform } from "./platform/web-platform";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <RelayV2App platform={createWebPlatform()} />
  </StrictMode>,
);
