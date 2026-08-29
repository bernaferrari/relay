import { For, Show, type Accessor } from "solid-js";
import type { BrowserCaseProfile } from "@relay/protocol";

type EnvironmentEntry = readonly [label: string, value: string];

function describe(value: unknown): string {
  if (value === undefined) return "not set";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function entries(profile: BrowserCaseProfile): EnvironmentEntry[] {
  return [
    ["Engine", profile.engine],
    ["Channel", describe(profile.channel)],
    ["Browser revision", describe(profile.revision)],
    ["Viewport", `${profile.viewport.width} × ${profile.viewport.height}`],
    ["Screen", describe(profile.screen)],
    ["Device scale", String(profile.deviceScaleFactor)],
    ["Mobile emulation", describe(profile.mobile)],
    ["Touch emulation", describe(profile.touch)],
    ["User agent", describe(profile.userAgent)],
    ["Locale", profile.locale],
    ["Timezone", profile.timezoneId],
    ["Color scheme", profile.colorScheme],
    ["Reduced motion", profile.reducedMotion],
    ["Geolocation", describe(profile.geolocation)],
    ["Permissions", profile.permissions.length ? profile.permissions.join(", ") : "none"],
    ["Offline", describe(profile.offline)],
    ["Network profile", describe(profile.networkProfile)],
    ["Authentication fixture", describe(profile.authenticationFixtureId)],
    ["Feature flags", describe(profile.featureFlagFixtureId)],
    ["Environment revision", profile.environmentRevision],
  ];
}

function summary(profile: BrowserCaseProfile): string {
  return `${profile.engine} · ${profile.viewport.width}×${profile.viewport.height} · ${profile.locale} · ${profile.timezoneId}`;
}

/** A compact, accessible disclosure for the immutable profile used by the
 * current Browser Device session. The summary is useful at a glance; the
 * details keep every saved field inspectable without exposing browser DOM. */
export function BrowserDeviceEnvironmentSummary(props: {
  profile: Accessor<BrowserCaseProfile | undefined>;
}) {
  return (
    <Show when={props.profile()}>
      {(profile) => (
        <details
          class="relative min-w-0 shrink-0 text-micro text-text-weak"
          data-browser-environment
          title="Frozen browser environment; open to inspect every saved field"
        >
          <summary class="flex min-h-11 max-w-72 cursor-pointer items-center truncate rounded-lg px-2 outline-none focus-visible:ring-2 focus-visible:ring-border-strong-focus">
            {summary(profile())}
          </summary>
          <div class="absolute right-0 top-full z-20 mt-1 max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-border-weak-base bg-surface-raised-stronger-non-alpha p-3 text-caption text-text-base shadow-[var(--map-elevation-control)]">
            <dl class="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1">
              <For each={entries(profile())}>
                {(entry) => (
                  <>
                    <dt class="truncate text-text-weak">{entry[0]}</dt>
                    <dd class="min-w-0 break-words text-right">{entry[1]}</dd>
                  </>
                )}
              </For>
            </dl>
          </div>
        </details>
      )}
    </Show>
  );
}
