import { For, Show, createSignal } from "solid-js";
import type { SensitiveEvidenceChannel } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { Switch } from "@relay/ui/switch";
import { useServer } from "../context/server";
import { copyDescription, copyStack, copyTitle } from "../lib/ui";

const CHANNELS: Array<{
  id: SensitiveEvidenceChannel;
  label: string;
  description: string;
}> = [
  {
    id: "network-body",
    label: "Network bodies",
    description: "Request and response payloads, capped at 256 KB per browser response.",
  },
  {
    id: "audio",
    label: "Audio probe",
    description: "Time-bucketed device audio levels when the target adapter supports probing.",
  },
  {
    id: "crash",
    label: "Crash diagnostics",
    description: "Crash-buffer and fault diagnostics bounded to the duration of each run.",
  },
];

export function SensitiveEvidenceControls() {
  const server = useServer();
  const [pending, setPending] = createSignal<SensitiveEvidenceChannel | null>(null);
  const [busy, setBusy] = createSignal<SensitiveEvidenceChannel | null>(null);
  const [error, setError] = createSignal("");

  const enabled = (channel: SensitiveEvidenceChannel) =>
    Boolean(server.evidenceCollectionPolicy()?.sensitive[channel]);

  async function update(channel: SensitiveEvidenceChannel, next: boolean): Promise<void> {
    setBusy(channel);
    setError("");
    try {
      await server.setSensitiveEvidenceConsent(channel, next);
      setPending(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section class="mt-5" aria-labelledby="sensitive-evidence-title">
      <div class="mb-2">
        <h3 id="sensitive-evidence-title" class="m-0 text-body font-medium text-text-strong">
          Sensitive collectors
        </h3>
        <p class="mt-1 text-caption leading-snug text-text-weak">
          These channels stay off until a local user grants consent. Every run freezes and records
          the exact grant it used.
        </p>
      </div>

      <For each={CHANNELS}>
        {(channel) => (
          <div class="border-b border-border-weak-base py-3 last:border-b-0">
            <div class="flex items-center justify-between gap-5">
              <div class={copyStack}>
                <span class={`block text-caption font-medium ${copyTitle}`}>{channel.label}</span>
                <span class={`block text-caption ${copyDescription}`}>{channel.description}</span>
              </div>
              <Switch
                checked={enabled(channel.id)}
                aria-label={channel.label}
                disabled={!server.evidenceCollectionPolicy() || busy() === channel.id}
                onCheckedChange={(next) => {
                  if (!next) void update(channel.id, false);
                  else setPending(channel.id);
                }}
              />
            </div>

            <Show when={pending() === channel.id}>
              <div class="mt-3 rounded-md border border-border-warning-base bg-surface-warning-weak px-3 py-2.5">
                <p class="m-0 text-caption leading-snug text-text-strong">
                  I consent to collecting {channel.label.toLowerCase()} in future runs for this
                  workspace. Evidence may contain personal or confidential data when redaction is
                  off.
                </p>
                <div class="mt-2.5 flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy() === channel.id}
                    onClick={() => void update(channel.id, true)}
                  >
                    {busy() === channel.id ? "Enabling…" : "Grant consent & enable"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </Show>

            <Show when={server.evidenceCollectionPolicy()?.sensitive[channel.id]}>
              {(grant) => (
                <p class="mt-2 text-caption text-text-weak">
                  Consented by {grant().grantedBy} · {new Date(grant().grantedAt).toLocaleString()}
                </p>
              )}
            </Show>
          </div>
        )}
      </For>

      <Show when={error()}>
        <p class="mt-3 text-caption text-icon-critical-base" role="alert">
          {error()}
        </p>
      </Show>
    </section>
  );
}
