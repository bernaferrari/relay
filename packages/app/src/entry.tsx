/* @refresh reload */
import { render } from "solid-js/web";
import { AppBaseProviders, AppInterface } from "./app";
import { createWebPlatform } from "./context/platform";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

const platform = createWebPlatform({
  defaultServerUrl:
    (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "http://127.0.0.1:8787",
});

render(
  () => (
    <AppBaseProviders
      platform={platform}
      collaboration={(import.meta.env.VITE_COLLABORATION_ENABLED as string | undefined) === "true"}
    >
      <AppInterface />
    </AppBaseProviders>
  ),
  root,
);
