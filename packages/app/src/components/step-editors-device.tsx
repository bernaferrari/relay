import { For, Show, type JSX } from "solid-js";
import { useServer, type RecipeStep } from "../context/server";
import { cn } from "../lib/cn";
import {
  fieldInput,
  fieldLabel,
  mono,
  propertySeg,
  propertySegBtn,
  propertySegBtnOn,
  propRow,
} from "../lib/ui";
import { Icon } from "./icon";
import type { StepEditorFamilyProps } from "./step-editor-types";

const valueCls = cn(fieldInput, "min-w-0 flex-1");

export function DeviceStepEditors(props: StepEditorFamilyProps): JSX.Element {
  const server = useServer();
  const kind = () => props.step().kind;
  const onEdit = (next: RecipeStep) => props.onChange(next);
  return (
    <>
      <Show when={kind() === "clipboard"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "clipboard") return null;
          const value = s.action === "write" ? (s.text ?? "") : (s.expect ?? "");
          return (
            <>
              <div class={propRow}>
                <span class={fieldLabel}>Action</span>
                <div class={propertySeg}>
                  {(
                    [
                      ["write", "Write"],
                      ["read", "Read & check"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      type="button"
                      class={s.action === id ? propertySegBtnOn : propertySegBtn}
                      onClick={() =>
                        onEdit(
                          id === "write"
                            ? { kind: "clipboard", action: "write", text: value }
                            : {
                                kind: "clipboard",
                                action: "read",
                                expect: value,
                                match: "exact",
                              },
                        )
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>{s.action === "write" ? "Text" : "Expected"}</span>
                <input
                  class={cn(valueCls, mono)}
                  value={value}
                  placeholder="clipboard text"
                  onInput={(e) =>
                    onEdit(
                      s.action === "write"
                        ? { ...s, text: e.currentTarget.value }
                        : { ...s, expect: e.currentTarget.value },
                    )
                  }
                />
              </div>
              <Show when={s.action === "read"}>
                <div class={propRow}>
                  <span class={fieldLabel}>Match</span>
                  <div class={propertySeg}>
                    {(
                      [
                        ["exact", "Exact"],
                        ["contains", "Contains"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        type="button"
                        class={
                          (s.match !== "contains" && id === "exact") || s.match === id
                            ? propertySegBtnOn
                            : propertySegBtn
                        }
                        onClick={() => onEdit({ ...s, match: id })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </Show>
            </>
          );
        })()}
      </Show>

      <Show when={kind() === "app"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "app") return null;
          return (
            <>
              <div class={propRow}>
                <span class={fieldLabel}>Action</span>
                <select
                  class={valueCls}
                  value={s.action}
                  onChange={(e) =>
                    onEdit({
                      kind: "app",
                      action: e.currentTarget.value as typeof s.action,
                      ...(e.currentTarget.value !== "switcher" ? { app: s.app ?? "" } : {}),
                    })
                  }
                >
                  <option value="open">Open app / deep link</option>
                  <option value="close">Close / force-stop app</option>
                  <option value="switcher">Open app switcher</option>
                  <option value="inspect">Record installed version</option>
                  <option value="assert-installed">Check app is installed</option>
                  <option value="assert-not-installed">Check app is not installed</option>
                  <option value="install">Install local APK</option>
                  <option value="update">Update from local APK</option>
                  <option value="uninstall">Uninstall app</option>
                </select>
              </div>
              <Show when={s.action !== "switcher"}>
                <div class={propRow}>
                  <span class={fieldLabel}>
                    {s.action === "open" ? "App or link" : "Package / bundle ID"}
                  </span>
                  <input
                    class={cn(valueCls, mono)}
                    value={s.app ?? s.url ?? ""}
                    placeholder={
                      s.action === "open" ? "package, app name, or URL" : "com.example.app"
                    }
                    onInput={(e) => {
                      const v = e.currentTarget.value;
                      onEdit(
                        v.includes("://")
                          ? { ...s, app: undefined, url: v }
                          : { ...s, app: v, url: undefined },
                      );
                    }}
                  />
                </div>
              </Show>
              <Show when={s.action === "install" || s.action === "update"}>
                <div class={propRow}>
                  <span class={fieldLabel}>Local APK</span>
                  <input
                    class={cn(valueCls, mono)}
                    value={s.artifact ?? ""}
                    placeholder="/path/to/build.apk"
                    onInput={(e) => onEdit({ ...s, artifact: e.currentTarget.value })}
                  />
                </div>
                <p class="mt-1 text-[11px] leading-[1.45] text-[var(--text-weak)]">
                  Android only. Relay runs the selected local APK directly and freezes the observed
                  installed version into the report.
                </p>
              </Show>
              <Show
                when={
                  s.action === "inspect" ||
                  s.action === "assert-installed" ||
                  s.action === "assert-not-installed"
                }
              >
                <Show when={s.action !== "assert-not-installed"}>
                  <div class={propRow}>
                    <span class={fieldLabel}>Expected version</span>
                    <input
                      class={cn(valueCls, mono)}
                      value={s.version ?? ""}
                      placeholder="Optional, e.g. 1.24.0"
                      onInput={(e) => onEdit({ ...s, version: e.currentTarget.value || undefined })}
                    />
                  </div>
                </Show>
                <Show when={s.action === "inspect"}>
                  <div class={propRow}>
                    <span class={fieldLabel}>Save as</span>
                    <input
                      class={cn(valueCls, mono)}
                      value={s.as ?? "app_version"}
                      placeholder="app_version"
                      onInput={(e) => onEdit({ ...s, as: e.currentTarget.value || undefined })}
                    />
                  </div>
                </Show>
                <Show when={s.version}>
                  <div class={propRow}>
                    <span class={fieldLabel}>Version match</span>
                    <select
                      class={valueCls}
                      value={s.versionMatch ?? "exact"}
                      onChange={(e) =>
                        onEdit({
                          ...s,
                          versionMatch: e.currentTarget.value as "exact" | "contains",
                        })
                      }
                    >
                      <option value="exact">Exact</option>
                      <option value="contains">Contains</option>
                    </select>
                  </div>
                </Show>
                <p class="mt-1 text-[11px] leading-[1.45] text-[var(--text-weak)]">
                  Relay records the installed version with the result. Credentials and app files
                  stay on your machine.
                </p>
              </Show>
            </>
          );
        })()}
      </Show>

      <Show when={kind() === "device"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "device") return null;
          const targetPlatform =
            server.devices().find((device) => device.serial === server.selectedDevice())
              ?.platform ?? "android";
          return (
            <>
              <div class={propRow}>
                <span class={fieldLabel}>Action</span>
                <select
                  class={valueCls}
                  value={s.action}
                  onChange={(e) =>
                    onEdit({ kind: "device", action: e.currentTarget.value as typeof s.action })
                  }
                >
                  <option value="lock">Lock screen</option>
                  <option value="unlock">Wake & unlock</option>
                  <option value="keyboard-dismiss">Dismiss keyboard</option>
                  <option value="keyboard-enter">Keyboard Enter</option>
                </select>
              </div>
              <Show
                when={targetPlatform === "ios" && (s.action === "lock" || s.action === "unlock")}
              >
                <p class="mt-1 text-[11px] leading-[1.45] text-[var(--text-weak)]">
                  Lock-screen control is unavailable on this iOS runner. Relay will report a
                  capability failure instead of guessing.
                </p>
              </Show>
            </>
          );
        })()}
      </Show>

      <Show when={kind() === "rotate"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "rotate") return null;
          return (
            <div class={propRow}>
              <span class={fieldLabel}>Orientation</span>
              <select
                class={valueCls}
                value={s.orientation}
                onChange={(e) =>
                  onEdit({ ...s, orientation: e.currentTarget.value as typeof s.orientation })
                }
              >
                <option value="portrait">Portrait</option>
                <option value="portrait-upside-down">Portrait upside down</option>
                <option value="landscape-left">Landscape left</option>
                <option value="landscape-right">Landscape right</option>
              </select>
            </div>
          );
        })()}
      </Show>

      <Show when={kind() === "settings"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "settings") return null;
          const appearance = s.setting === "appearance";
          return (
            <>
              <div class={propRow}>
                <span class={fieldLabel}>Setting</span>
                <select
                  class={valueCls}
                  value={s.setting}
                  onChange={(e) => {
                    const setting = e.currentTarget.value as typeof s.setting;
                    onEdit({
                      kind: "settings",
                      setting,
                      state: setting === "appearance" ? "light" : "on",
                    });
                  }}
                >
                  <option value="wifi">Wi-Fi</option>
                  <option value="airplane">Airplane mode</option>
                  <option value="location">Location services</option>
                  <option value="animations">Animations</option>
                  <option value="appearance">Appearance</option>
                </select>
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>State</span>
                <select
                  class={valueCls}
                  value={s.state}
                  onChange={(e) => onEdit({ ...s, state: e.currentTarget.value as typeof s.state })}
                >
                  {appearance ? (
                    <>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                      <option value="toggle">Toggle</option>
                    </>
                  ) : (
                    <>
                      <option value="on">On</option>
                      <option value="off">Off</option>
                    </>
                  )}
                </select>
              </div>
            </>
          );
        })()}
      </Show>

      <Show when={kind() === "location"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "location") return null;
          return (
            <>
              <div class={propRow}>
                <span class={fieldLabel}>Latitude</span>
                <input
                  class={cn(valueCls, mono)}
                  type="number"
                  step="any"
                  value={s.latitude}
                  onInput={(e) => onEdit({ ...s, latitude: Number(e.currentTarget.value) })}
                />
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Longitude</span>
                <input
                  class={cn(valueCls, mono)}
                  type="number"
                  step="any"
                  value={s.longitude}
                  onInput={(e) => onEdit({ ...s, longitude: Number(e.currentTarget.value) })}
                />
              </div>
            </>
          );
        })()}
      </Show>

      <Show when={kind() === "permission"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "permission") return null;
          const permissions = [
            "camera",
            "microphone",
            "photos",
            "contacts",
            "notifications",
            "calendar",
            "location",
            "location-always",
            "media-library",
            "motion",
            "reminders",
            "siri",
          ] as const;
          return (
            <>
              <div class={propRow}>
                <span class={fieldLabel}>Action</span>
                <select
                  class={valueCls}
                  value={s.action}
                  onChange={(e) =>
                    onEdit({ ...s, action: e.currentTarget.value as typeof s.action })
                  }
                >
                  <option value="grant">Grant</option>
                  <option value="deny">Deny</option>
                  <option value="reset">Reset</option>
                </select>
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Permission</span>
                <select
                  class={valueCls}
                  value={s.permission}
                  onChange={(e) =>
                    onEdit({ ...s, permission: e.currentTarget.value as typeof s.permission })
                  }
                >
                  <For each={permissions}>
                    {(p) => <option value={p}>{p.replaceAll("-", " ")}</option>}
                  </For>
                </select>
              </div>
            </>
          );
        })()}
      </Show>

      <Show when={kind() === "alert"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "alert") return null;
          return (
            <div class={propRow}>
              <span class={fieldLabel}>Action</span>
              <select
                class={valueCls}
                value={s.action}
                onChange={(e) => onEdit({ ...s, action: e.currentTarget.value as typeof s.action })}
              >
                <option value="accept">Accept</option>
                <option value="dismiss">Dismiss</option>
                <option value="wait">Wait for alert</option>
                <option value="get">Inspect alert</option>
              </select>
            </div>
          );
        })()}
      </Show>

      <Show when={kind() === "network"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "network") return null;
          return (
            <>
              <div class={propRow}>
                <span class={fieldLabel}>Evidence</span>
                <span class="relative min-w-0 flex-1">
                  <select
                    class={cn(valueCls, "appearance-none pr-9")}
                    value={s.include ?? "summary"}
                    onChange={(e) =>
                      onEdit({
                        ...s,
                        include: e.currentTarget.value as NonNullable<typeof s.include>,
                      })
                    }
                  >
                    <option value="summary">Summary</option>
                    <option value="headers">Headers</option>
                    <option value="body">Bodies</option>
                    <option value="all">Everything</option>
                  </select>
                  <Icon
                    name="chevron-down"
                    size={14}
                    class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[var(--text-weak)]"
                    aria-hidden
                  />
                </span>
              </div>
              <div class={propRow}>
                <span class={fieldLabel}>Limit</span>
                <input
                  class={cn(valueCls, mono)}
                  type="number"
                  min={1}
                  max={1000}
                  value={s.limit ?? 100}
                  onInput={(e) => onEdit({ ...s, limit: Number(e.currentTarget.value) })}
                />
              </div>
            </>
          );
        })()}
      </Show>

      <Show when={kind() === "logs"}>
        {(() => {
          const s = props.step();
          if (s.kind !== "logs") return null;
          return (
            <>
              <div class={propRow}>
                <span class={fieldLabel}>Action</span>
                <select
                  class={valueCls}
                  value={s.action}
                  onChange={(e) =>
                    onEdit({ ...s, action: e.currentTarget.value as typeof s.action })
                  }
                >
                  <option value="mark">Add marker</option>
                  <option value="start">Start capture</option>
                  <option value="stop">Stop capture</option>
                  <option value="clear">Clear logs</option>
                </select>
              </div>
              <Show when={s.action === "mark"}>
                <div class={propRow}>
                  <span class={fieldLabel}>Marker</span>
                  <input
                    class={valueCls}
                    value={s.message ?? ""}
                    onInput={(e) => onEdit({ ...s, message: e.currentTarget.value })}
                  />
                </div>
              </Show>
            </>
          );
        })()}
      </Show>
    </>
  );
}
