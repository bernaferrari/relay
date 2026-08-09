import { Show, createSignal, onMount } from "solid-js";
import { Switch } from "@relay/ui/switch";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { SensitiveEvidenceControls } from "./sensitive-evidence-controls";

export function PrivacySettingsPanel() {
  const server = useServer();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  onMount(() => {
    void Promise.all([
      server.refreshRedactionPolicy(),
      server.refreshEvidenceCollectionPolicy(),
    ]).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  });

  async function toggle(enabled: boolean): Promise<void> {
    const policy = server.redactionPolicy();
    if (!policy || policy.locked || busy()) return;
    setBusy(true);
    setError("");
    try {
      await server.setRedactionEnabled(enabled);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const sourceLabel = () => {
    const source = server.redactionPolicy()?.source;
    if (source === "environment") return "Controlled by RELAY_REDACTION_MODE";
    if (source === "workspace") return "Saved for this workspace";
    return "Default: raw evidence";
  };

  return (
    <section aria-labelledby="redaction-title">
      <div class="flex items-center justify-between gap-5 border-b border-border-weak-base py-3">
        <div class="flex min-w-0 flex-col gap-0.5">
          <span id="redaction-title" class="text-12-medium text-text-strong">
            Redact sensitive evidence
          </span>
          <span class="max-w-[520px] text-12-regular leading-snug text-text-weak">
            Removes credentials, cookies, clipboard contents, typed secrets, and URL query values
            before Relay exposes or saves new evidence.
          </span>
        </div>
        <Switch
          checked={server.redactionPolicy()?.enabled ?? false}
          aria-label="Redact sensitive evidence"
          disabled={!server.redactionPolicy() || server.redactionPolicy()?.locked || busy()}
          onCheckedChange={(enabled) => void toggle(enabled)}
        />
      </div>

      <div class="flex items-center justify-between gap-3 py-3 text-12-regular">
        <span class="text-text-weak">{sourceLabel()}</span>
        <span
          class={cn(
            "text-12-medium",
            !server.redactionPolicy()
              ? "text-text-weak"
              : server.redactionPolicy()?.enabled
                ? "text-icon-success-base"
                : "text-icon-critical-base",
          )}
        >
          {busy()
            ? "Saving…"
            : !server.redactionPolicy()
              ? "Loading…"
              : server.redactionPolicy()?.enabled
                ? "Protected"
                : "Raw evidence enabled"}
        </span>
      </div>

      <Show when={server.redactionPolicy()?.enabled === false}>
        <div
          class="rounded-md border border-border-critical-base bg-surface-critical-weak px-3 py-2.5 text-12-regular leading-snug text-icon-critical-base"
          role="alert"
        >
          New runs may store typed text, variables, headers, URLs, clipboard contents, and logs
          without masking. Relay will refuse to start on a non-local network interface in this mode.
        </div>
      </Show>

      <Show when={error()}>
        <p class="mt-3 text-12-regular text-icon-critical-base" role="alert">
          {error()}
        </p>
      </Show>

      <p class="mt-3 text-11-regular leading-snug text-text-weak">
        This setting applies to future collection and responses. Finalized run artifacts are
        immutable and are not rewritten.
      </p>
      <SensitiveEvidenceControls />
    </section>
  );
}
