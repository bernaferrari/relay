import { For, Show, createSignal, onMount } from "solid-js";
import { Button } from "@relay/ui/button";
import { usePlatform } from "../context/platform";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { humanError } from "../lib/human-error";
import { copyDescription, copyStack, copyTitle } from "../lib/ui";

const labelClass = "text-caption font-medium text-text-strong";
const inputClass =
  "h-11 w-full rounded-md border border-border-weak-base bg-surface-raised-stronger-non-alpha px-3 text-caption text-text-strong focus:border-border-focus focus:outline-none";

export function DeviceSettingsPanel() {
  const server = useServer();
  const platform = usePlatform();
  const [appleTeamId, setAppleTeamId] = createSignal("");
  const [appleBundleId, setAppleBundleId] = createSignal("");
  const [appleSigningIdentity, setAppleSigningIdentity] = createSignal("");
  const [appleProvisioningProfile, setAppleProvisioningProfile] = createSignal("");
  const [appleSetupBusy, setAppleSetupBusy] = createSignal(false);
  const [appleSetupError, setAppleSetupError] = createSignal("");
  const [appleSetupSaved, setAppleSetupSaved] = createSignal(false);
  const [appleAdvancedOpen, setAppleAdvancedOpen] = createSignal(false);

  onMount(() => {
    void server
      .refreshAppleDeviceSetup()
      .then((status) => {
        const setup = status.setup.ios ?? status.suggestion;
        if (!setup) return;
        setAppleTeamId(setup.teamId);
        setAppleBundleId(setup.bundleId);
        setAppleSigningIdentity(setup.signingIdentity ?? "");
        setAppleProvisioningProfile(setup.provisioningProfile ?? "");
      })
      .catch(() => undefined);
    void server.refreshAndroidDeviceSetup().catch(() => undefined);
  });

  async function saveAppleSetup(event?: SubmitEvent): Promise<void> {
    event?.preventDefault();
    setAppleSetupBusy(true);
    setAppleSetupError("");
    try {
      await server.saveAppleDeviceSetup({
        teamId: appleTeamId(),
        bundleId: appleBundleId(),
        signingIdentity: appleSigningIdentity(),
        provisioningProfile: appleProvisioningProfile(),
      });
      setAppleSetupSaved(true);
      window.setTimeout(() => setAppleSetupSaved(false), 1_500);
    } catch (error) {
      setAppleSetupError(error instanceof Error ? error.message : String(error));
    } finally {
      setAppleSetupBusy(false);
    }
  }

  return (
    <section class="flex max-w-[36rem] flex-col gap-4">
      <header>
        <h3 class="m-0 text-body font-medium text-text-strong">Mobile devices</h3>
        <p class="mt-1 mb-0 text-caption leading-relaxed text-text-weak">
          Relay connects automatically. These checks appear only when a device needs attention.
        </p>
      </header>

      <div class="rounded-lg border border-border-weak-base bg-background-base p-3">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h4 class="m-0 text-caption font-medium text-text-strong">Android devices</h4>
            <p class="mt-1 mb-0 text-caption leading-snug text-text-weak">
              Relay bundles streaming. Android Platform Tools provides the local adb connection.
            </p>
          </div>
          <Show when={server.androidDeviceSetup()?.checks[0]}>
            {(check) => (
              <span
                class={cn(
                  "shrink-0 rounded-full px-2 py-1 text-micro font-medium",
                  check().status === "ready"
                    ? "bg-surface-success-weak text-icon-success-base"
                    : "bg-surface-warning-weak text-icon-warning-base",
                )}
              >
                {check().status === "ready" ? "Ready" : "Needs setup"}
              </span>
            )}
          </Show>
        </div>
        <Show when={server.androidDeviceSetup()?.checks[0]}>
          {(check) => (
            <p class="mt-2 mb-0 text-caption leading-snug text-text-weak">{check().detail}</p>
          )}
        </Show>
        <Show when={server.androidDeviceSetup()?.checks[0]?.status === "needs-attention"}>
          <p class="mt-3 mb-0 text-caption leading-snug text-text-weak">
            In Android Studio, open SDK Manager → SDK Tools and install Android SDK Platform-Tools.
            Then reopen Relay.
          </p>
          <div class="mt-3 flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() =>
                void platform.openExternal?.(
                  "https://developer.android.com/tools/releases/platform-tools",
                )
              }
            >
              Get Platform Tools
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => void server.refreshAndroidDeviceSetup()}
            >
              Check again
            </Button>
          </div>
        </Show>
      </div>

      <div class="border-t border-border-weak-base pt-4">
        <h4 class="m-0 text-caption font-medium text-text-strong">Apple devices</h4>
        <p class="mt-1 mb-0 text-caption leading-snug text-text-weak">
          Relay connects to iPhones and iPads through the Apple device support already on this Mac.
          You only need to intervene when a permission is missing.
        </p>
      </div>

      <Show
        when={server.appleDeviceSetup()}
        fallback={
          <div class="flex min-h-[104px] items-start rounded-lg border border-border-weak-base bg-background-base px-3 py-3">
            <div class="flex items-start gap-2.5">
              <span
                class="mt-0.5 size-3.5 shrink-0 animate-spin rounded-full border-2 border-text-weak border-t-transparent motion-reduce:animate-none"
                role="status"
                aria-label="Checking Apple device setup"
              />
              <div>
                <p class="m-0 text-caption font-medium text-text-strong">Checking Apple devices</p>
                <p class="mt-1 mb-0 text-caption leading-snug text-text-weak">
                  Looking for an Apple account already connected to Xcode.
                </p>
              </div>
            </div>
          </div>
        }
      >
        {(appleStatus) => {
          const accountReady = () =>
            appleStatus().checks.some(
              (check) => check.id === "account" && check.status === "ready",
            );
          return (
            <>
              <Show
                when={accountReady() ? appleStatus().setup.ios : undefined}
                fallback={
                  <Show
                    when={accountReady() ? appleStatus().suggestion : undefined}
                    fallback={
                      <div class="rounded-lg border border-border-weak-base bg-background-base p-3">
                        <div class="flex items-start gap-2.5">
                          <span class="mt-1 size-1.5 shrink-0 rounded-full bg-icon-warning-base" />
                          <div class={copyStack}>
                            <p class={`m-0 text-caption font-medium ${copyTitle}`}>
                              Apple device access needs attention
                            </p>
                            <p class={`m-0 text-caption ${copyDescription}`}>
                              Open Xcode once and add an Apple account. Relay will use that local
                              permission for this device.
                            </p>
                          </div>
                        </div>
                        <div class="mt-3 flex flex-wrap items-center gap-2">
                          <Show when={platform.openXcode}>
                            <Button
                              variant="primary"
                              size="sm"
                              type="button"
                              onClick={() => void platform.openXcode?.()}
                            >
                              Open Xcode
                            </Button>
                          </Show>
                          <Button
                            variant={platform.openXcode ? "secondary" : "primary"}
                            size="sm"
                            type="button"
                            onClick={() => void server.refreshAppleDeviceSetup()}
                          >
                            Check again
                          </Button>
                          <button
                            class="text-caption font-medium text-text-weak transition-colors duration-hover hover:text-text-strong"
                            type="button"
                            onClick={() => setAppleAdvancedOpen((open) => !open)}
                          >
                            Enter details manually
                          </button>
                        </div>
                      </div>
                    }
                  >
                    {(suggestion) => (
                      <div class="rounded-lg border border-border-weak-base bg-background-base px-3 py-3 shadow-xs-border-base">
                        <div class="flex items-start gap-2.5">
                          <span class="mt-1 size-1.5 shrink-0 rounded-full bg-icon-success-base" />
                          <div class={copyStack}>
                            <p class={`m-0 text-caption font-medium ${copyTitle}`}>
                              Use this Xcode account
                            </p>
                            <p class={`m-0 text-caption ${copyDescription}`}>
                              Relay found {suggestion().label} on this Mac.
                            </p>
                          </div>
                        </div>
                        <div class="mt-3 flex items-center gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            type="button"
                            disabled={appleSetupBusy()}
                            onClick={() => {
                              setAppleTeamId(suggestion().teamId);
                              setAppleBundleId(suggestion().bundleId);
                              setAppleSigningIdentity("");
                              setAppleProvisioningProfile("");
                              void saveAppleSetup();
                            }}
                          >
                            {appleSetupBusy() ? "Setting up…" : "Use this account"}
                          </Button>
                          <button
                            class="text-caption font-medium text-text-weak transition-colors duration-hover hover:text-text-strong"
                            type="button"
                            onClick={() => setAppleAdvancedOpen((open) => !open)}
                          >
                            Change details
                          </button>
                        </div>
                      </div>
                    )}
                  </Show>
                }
              >
                <div class="rounded-lg border border-border-weak-base bg-background-base px-3 py-3">
                  <div class="flex min-w-0 items-start gap-2.5">
                    <span class="mt-1 size-1.5 shrink-0 rounded-full bg-icon-success-base" />
                    <div class={copyStack}>
                      <p class={`m-0 text-caption font-medium ${copyTitle}`}>
                        Ready to control Apple devices
                      </p>
                      <p class={`m-0 text-caption ${copyDescription}`}>
                        Relay will connect automatically when you choose an iPhone or iPad.
                      </p>
                    </div>
                  </div>
                  <div class="mt-2 flex justify-end">
                    <button
                      class="min-h-8 shrink-0 rounded-lg px-2 text-caption font-medium text-text-weak transition-colors duration-hover hover:bg-surface-base-hover hover:text-text-strong"
                      type="button"
                      onClick={() => setAppleAdvancedOpen((open) => !open)}
                    >
                      Change setup
                    </button>
                  </div>
                </div>
              </Show>

              <div class="rounded-lg border border-border-weak-base bg-background-base px-3 py-3">
                <div class="flex flex-col gap-1.5">
                  <div class={copyStack}>
                    <span class={`${labelClass} ${copyTitle}`}>iOS live preview</span>
                    <p class={`m-0 text-caption ${copyDescription}`}>
                      Live preview defaults to a go-ios video/MJPEG stream. Screenshots stay for
                      evidence. Switch to PNG only if the stream is unavailable.
                    </p>
                  </div>
                  <select
                    class={inputClass}
                    value={
                      server.appleDeviceSetup()?.setup.iosLivePreview?.backend ?? "go-ios-auto"
                    }
                    disabled={appleSetupBusy()}
                    onChange={(event) => {
                      const backend = event.currentTarget.value as
                        | "agent-device-png"
                        | "go-ios-auto"
                        | "go-ios-mjpeg";
                      setAppleSetupBusy(true);
                      void server
                        .saveIosLivePreview(backend)
                        .then(() => {
                          setAppleSetupSaved(true);
                          setTimeout(() => setAppleSetupSaved(false), 1500);
                        })
                        .catch((error) => {
                          setAppleSetupError(
                            humanError(error, "Could not save live preview setting."),
                          );
                        })
                        .finally(() => setAppleSetupBusy(false));
                    }}
                  >
                    <option value="go-ios-auto">Live stream (default)</option>
                    <option value="agent-device-png">PNG preview fallback</option>
                    <option value="go-ios-mjpeg">go-ios Instruments MJPEG</option>
                  </select>
                </div>
              </div>

              <Show when={appleAdvancedOpen()}>
                <form class="flex flex-col gap-3" onSubmit={saveAppleSetup}>
                  <div class="grid grid-cols-2 gap-3 max-[680px]:grid-cols-1">
                    <label class="flex flex-col gap-1.5">
                      <span class={labelClass}>Apple Team ID</span>
                      <input
                        class={inputClass}
                        value={appleTeamId()}
                        placeholder="ABCDE12345"
                        autocomplete="off"
                        spellcheck={false}
                        onInput={(event) => setAppleTeamId(event.currentTarget.value)}
                        required
                      />
                    </label>
                    <label class="flex flex-col gap-1.5">
                      <span class={labelClass}>Local runner ID</span>
                      <input
                        class={inputClass}
                        value={appleBundleId()}
                        placeholder="com.yourteam.relay.runner"
                        autocomplete="off"
                        spellcheck={false}
                        onInput={(event) => setAppleBundleId(event.currentTarget.value)}
                        required
                      />
                    </label>
                  </div>
                  <details class="rounded-lg border border-border-weak-base bg-background-base px-3 py-2.5">
                    <summary class="cursor-pointer text-caption font-medium text-text-strong">
                      More signing options
                    </summary>
                    <div class="mt-3 grid grid-cols-2 gap-3 max-[680px]:grid-cols-1">
                      <label class="flex flex-col gap-1.5">
                        <span class={labelClass}>Signing identity</span>
                        <input
                          class={inputClass}
                          value={appleSigningIdentity()}
                          placeholder="Use Xcode automatically"
                          autocomplete="off"
                          onInput={(event) => setAppleSigningIdentity(event.currentTarget.value)}
                        />
                      </label>
                      <label class="flex flex-col gap-1.5">
                        <span class={labelClass}>Provisioning profile</span>
                        <input
                          class={inputClass}
                          value={appleProvisioningProfile()}
                          placeholder="Use Xcode automatically"
                          autocomplete="off"
                          onInput={(event) =>
                            setAppleProvisioningProfile(event.currentTarget.value)
                          }
                        />
                      </label>
                    </div>
                  </details>
                  <div class="flex items-center gap-2.5">
                    <Button variant="primary" size="sm" type="submit" disabled={appleSetupBusy()}>
                      {appleSetupBusy() ? "Saving…" : "Save changes"}
                    </Button>
                    <Show when={appleSetupSaved()}>
                      <span class="text-caption text-icon-success-base">Saved</span>
                    </Show>
                    <Show when={appleSetupError()}>
                      <span class="text-caption text-icon-critical-base" role="alert">
                        {appleSetupError()}
                      </span>
                    </Show>
                  </div>
                </form>
              </Show>

              <details class="border-t border-border-weak-base pt-3">
                <summary class="cursor-pointer text-caption font-medium text-text-weak">
                  Setup details
                </summary>
                <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 max-[680px]:grid-cols-1">
                  <For each={appleStatus().checks}>
                    {(check) => (
                      <div class="flex min-w-0 items-center gap-1.5 text-caption text-text-weak">
                        <span
                          class={cn(
                            "size-1.5 shrink-0 rounded-full",
                            check.status === "ready"
                              ? "bg-icon-success-base"
                              : "bg-icon-warning-base",
                          )}
                        />
                        <span class="truncate">{check.label}</span>
                      </div>
                    )}
                  </For>
                </div>
              </details>
            </>
          );
        }}
      </Show>
    </section>
  );
}
