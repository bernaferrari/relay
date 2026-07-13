import { Show, createSignal, type Accessor, type JSX } from "solid-js";
import { Icon } from "./icon";
import { cn } from "../lib/cn";
import { withRefreshFeedback } from "../lib/refresh-feedback";

type FocusedStep = { index: number; title: string } | null;

export function DeviceConnectState(props: {
  offline: boolean;
  focusedStep: Accessor<FocusedStep>;
  phoneShell: string;
  phoneScreen: string;
  onRefresh: () => void | Promise<void>;
  onSetup: () => void;
}): JSX.Element {
  const [refreshing, setRefreshing] = createSignal(false);
  async function refresh(): Promise<void> {
    if (refreshing()) return;
    setRefreshing(true);
    try {
      await withRefreshFeedback(() => props.onRefresh());
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div class="device-connect-state" data-device-chrome>
      <div class="device-connect-preview" aria-hidden="true">
        <div class={cn(props.phoneShell, "device-connect-preview__phone")}>
          <div class={cn(props.phoneScreen, "device-connect-preview__screen")}>
            <span class="device-connect-preview__speaker" />
            <span class="device-connect-preview__glow">
              <Icon name="smartphone" size={24} />
            </span>
            <div class="device-connect-preview__lines">
              <i />
              <i />
              <i />
            </div>
            <Show when={props.focusedStep()}>
              {(step) => (
                <div class="device-connect-preview__step">
                  <span>{step().index + 1}</span>
                  <strong>{step().title}</strong>
                </div>
              )}
            </Show>
          </div>
        </div>
      </div>
      <div class="device-connect-copy">
        <div class="device-connect-copy__mark" aria-hidden="true">
          <span>
            <Icon name="smartphone" size={24} />
          </span>
          <i />
          <i />
        </div>
        <span class="relay-eyebrow">Live device</span>
        <h3>Connect a device</h3>
        <p>Plug in over USB or join over Wi‑Fi to record, inspect, and replay on the real app.</p>
        <p
          class="device-connect-status"
          data-state={props.offline ? "offline" : "waiting"}
          role="status"
        >
          <span aria-hidden="true" />
          {props.offline ? "Connection unavailable" : "Looking for a device"}
        </p>
        <div class="device-connect-actions">
          <button
            type="button"
            class="relay-primary"
            disabled={refreshing()}
            aria-busy={refreshing()}
            onClick={() => void refresh()}
          >
            <Icon
              name="refresh"
              size={14}
              class={refreshing() ? "relay-refresh-icon is-spinning" : "relay-refresh-icon"}
            />
            Refresh
          </button>
          <button type="button" class="relay-secondary" onClick={props.onSetup}>
            <Icon name="sliders" size={14} />
            Device setup
          </button>
        </div>
        <p class="device-connect-hint">Android: enable USB debugging · iOS: trust this computer</p>
      </div>
    </div>
  );
}
