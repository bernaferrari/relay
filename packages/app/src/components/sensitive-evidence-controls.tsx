import { For, Show, createSignal } from "solid-js";
import type { SensitiveEvidenceChannel } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";

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
        <h3 id="sensitive-evidence-title" class="m-0 text-13-medium text-text-strong">
          Sensitive collectors
        </h3>
        <p class="mt-1 text-12-regular leading-snug text-text-weak">
          These channels stay off until a local user grants consent. Every run freezes and records
          the exact grant it used.
        </p>
      </div>

      <For each={CHANNELS}>
        {(channel) => (
          <div class="border-b border-border-weak-base py-3 last:border-b-0">
            <div class="flex items-center justify-between gap-5">
              <div class="min-w-0">
                <span class="block text-12-medium text-text-strong">{channel.label}</span>
                <span class="mt-0.5 block text-12-regular leading-snug text-text-weak">
                  {channel.description}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled(channel.id)}
                aria-label={channel.label}
                disabled={!server.evidenceCollectionPolicy() || busy() === channel.id}
                class={cn(
                  "relative h-5 w-9 shrink-0 rounded-full border border-border-weak-base transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-50",
                  enabled(channel.id)
                    ? "bg-icon-success-base"
                    : "bg-surface-raised-stronger-non-alpha",
                )}
                onClick={() => {
                  if (enabled(channel.id)) void update(channel.id, false);
                  else setPending(channel.id);
                }}
              >
                <span
                  aria-hidden="true"
                  class={cn(
                    "absolute top-0.5 left-0.5 size-3.5 rounded-full bg-text-on-brand-base shadow-sm transition-transform",
                    enabled(channel.id) && "translate-x-4",
                  )}
                />
              </button>
            </div>

            <Show when={pending() === channel.id}>
              <div class="mt-3 rounded-md border border-border-warning-base bg-surface-warning-weak px-3 py-2.5">
                <p class="m-0 text-12-regular leading-snug text-text-strong">
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
                <p class="mt-2 text-11-regular text-text-weak">
                  Consented by {grant().grantedBy} · {new Date(grant().grantedAt).toLocaleString()}
                </p>
              )}
            </Show>
          </div>
        )}
      </For>

      <Show when={error()}>
        <p class="mt-3 text-12-regular text-icon-critical-base" role="alert">
          {error()}
        </p>
      </Show>
    </section>
  );
}
