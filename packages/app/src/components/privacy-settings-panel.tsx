import { Show, createSignal, onMount } from "solid-js";
import { Button } from "@relay/ui/button";
import { Switch } from "@relay/ui/switch";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { copyDescription, copyStack, copyTitle } from "../lib/ui";
import { Icon } from "./icon";
import { SensitiveEvidenceControls } from "./sensitive-evidence-controls";

export function PrivacySettingsPanel() {
  const server = useServer();
  const [busy, setBusy] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);
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

  async function downloadActivity(): Promise<void> {
    if (exporting()) return;
    setExporting(true);
    setError("");
    try {
      const result = await server.runAction("activity.export", {});
      const exported = result.export;
      const date = new Date(exported.manifest.generatedAt).toISOString().slice(0, 10);
      const project = exported.manifest.projectId.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const url = URL.createObjectURL(
        new Blob([`${JSON.stringify(exported)}\n`], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `relay-${project}-activity-${date}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export project activity.");
    } finally {
      setExporting(false);
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
        <div class={copyStack}>
          <span id="redaction-title" class={`text-caption font-medium ${copyTitle}`}>
            Redact sensitive evidence
          </span>
          <span class={`max-w-[520px] text-caption ${copyDescription}`}>
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

      <div class="flex items-center justify-between gap-3 py-3 text-caption">
        <span class="text-text-weak">{sourceLabel()}</span>
        <span
          class={cn(
            "text-caption font-medium",
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
          class="rounded-md border border-border-critical-base bg-surface-critical-weak px-3 py-2.5 text-caption leading-snug text-icon-critical-base"
          role="alert"
        >
          New runs may store typed text, variables, headers, URLs, clipboard contents, and logs
          without masking. Relay will refuse to start on a non-local network interface in this mode.
        </div>
      </Show>

      <Show when={error()}>
        <p class="mt-3 text-caption text-icon-critical-base" role="alert">
          {error()}
        </p>
      </Show>

      <p class="mt-3 text-caption leading-snug text-text-weak">
        This setting applies to future collection and responses. Finalized run artifacts are
        immutable and are not rewritten.
      </p>
      <SensitiveEvidenceControls />

      <div class="mt-4 flex items-center justify-between gap-5 border-t border-border-weak-base py-3">
        <div class={copyStack}>
          <span class={`text-caption font-medium ${copyTitle}`}>Project activity</span>
          <span class={`max-w-[500px] text-caption ${copyDescription}`}>
            Download every attributed operation in this project with a SHA-256 integrity digest.
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={exporting() || server.health() !== "online"}
          onClick={() => void downloadActivity()}
        >
          <span class={exporting() ? "ui-refresh-spin" : ""}>
            <Icon name={exporting() ? "refresh" : "download"} size={13} />
          </span>
          {exporting() ? "Exporting…" : "Export activity"}
        </Button>
      </div>
    </section>
  );
}
