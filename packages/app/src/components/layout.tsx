import { type JSX, Show } from "solid-js";
import { Badge } from "@grok-device/ui/badge";
import { Button } from "@grok-device/ui/button";
import { Logo } from "@grok-device/ui/logo";
import { useServer } from "../context/server";

export type AppView = "home" | "settings";

export function Layout(props: {
  view: AppView;
  onNavigate: (view: AppView) => void;
  children: JSX.Element;
}) {
  const server = useServer();

  const healthVariant = () => {
    const h = server.health();
    if (h === "online") return "success" as const;
    if (h === "offline") return "error" as const;
    return "default" as const;
  };

  const healthLabel = () => {
    const h = server.health();
    if (h === "online") return "Connected";
    if (h === "offline") return "Offline";
    return "Connecting";
  };

  return (
    <div class="app-shell">
      <header class="app-header">
        <div class="app-header__left">
          <button
            type="button"
            onClick={() => props.onNavigate("home")}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              display: "inline-flex",
            }}
            aria-label="Home"
          >
            <Logo />
          </button>
          <Badge variant={healthVariant()}>
            <span class="pill-dot" />
            {healthLabel()}
          </Badge>
          <Show when={server.serverUrl()}>
            <span class="list-item__meta" title={server.serverUrl()}>
              {server.serverUrl().replace(/^https?:\/\//, "")}
            </span>
          </Show>
        </div>
        <div class="app-header__right">
          <Button
            variant="ghost"
            size="sm"
            selected={props.view === "settings"}
            onClick={() => props.onNavigate(props.view === "settings" ? "home" : "settings")}
            aria-label="Settings"
            title="Settings"
          >
            ⚙ Settings
          </Button>
        </div>
      </header>
      <div>{props.children}</div>
    </div>
  );
}
