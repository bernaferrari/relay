import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import type { RunShareSummary } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer, type JobInfo } from "../context/server";
import { toast } from "../context/toast";
import { Icon } from "./icon";

function expiresLabel(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeStyle: "short",
  }).format(new Date(value));
}

export function RunShareMenu(props: { run: JobInfo; batchRunCount: number }) {
  const server = useServer();
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [expiresInHours, setExpiresInHours] = createSignal(24 * 7);
  const [includeBatch, setIncludeBatch] = createSignal(Boolean(props.run.batchId));
  const [shares, setShares] = createSignal<RunShareSummary[]>([]);
  const [createdUrl, setCreatedUrl] = createSignal("");
  const [position, setPosition] = createSignal({ left: 12, top: 12, maxHeight: 480 });
  let root: HTMLDivElement | undefined;
  let menu: HTMLElement | undefined;
  let trigger: HTMLButtonElement | undefined;

  createEffect(() => {
    if (!open()) return;
    setCreatedUrl("");
    const rect = trigger?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(340, window.innerWidth - 24);
      const top = rect.bottom + 8;
      setPosition({
        left: Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width)),
        top,
        maxHeight: Math.max(220, window.innerHeight - top - 12),
      });
    }
    void server
      .listRunShares(props.run.id)
      .then(setShares)
      .catch((error: unknown) =>
        toast(error instanceof Error ? error.message : String(error), "error"),
      );
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root?.contains(target) && !menu?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    onCleanup(() => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    });
  });

  async function copy(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    toast("Share link copied", "success");
  }

  async function createShare(): Promise<void> {
    if (busy()) return;
    setBusy(true);
    try {
      const created = await server.createRunShare(
        props.run.id,
        expiresInHours(),
        Boolean(props.run.batchId && includeBatch()),
      );
      const url = new URL(created.path, server.serverUrl()).toString();
      setCreatedUrl(url);
      setShares((current) => [created.share, ...current]);
      await copy(url);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(share: RunShareSummary): Promise<void> {
    if (busy() || share.status !== "active") return;
    setBusy(true);
    try {
      const updated = await server.revokeRunShare(props.run.id, share.id);
      setShares((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast("Share link revoked", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={(element) => (root = element)} class="relative">
      <Button
        ref={(element) => (trigger = element)}
        variant="secondary"
        size="sm"
        class="text-caption"
        aria-expanded={open()}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="external" size={12} /> Share
      </Button>
      <Show when={open()}>
        <Portal>
          <section
            ref={(element) => (menu = element)}
            role="dialog"
            aria-label="Share results"
            class="fixed z-[100] grid w-[min(340px,calc(100vw-24px))] gap-4 overflow-y-auto rounded-xl border border-[var(--border-weak-base)] bg-[var(--background-base)] p-4 text-left shadow-[0_12px_36px_rgb(0_0_0/0.16)]"
            style={{
              left: `${position().left}px`,
              top: `${position().top}px`,
              "max-height": `${position().maxHeight}px`,
            }}
          >
            <div class="grid gap-1">
              <strong class="text-body font-semibold text-text-strong">Share results</strong>
              <p class="m-0 text-caption/[1.45] text-text-weaker">
                Screenshots and result status are included. Inputs, logs, and device IDs stay
                private.
              </p>
            </div>
            <label class="grid gap-1.5 text-caption font-medium text-text-base">
              Link expires
              <select
                class="h-9 rounded-lg border border-[var(--border-weak-base)] bg-[var(--background-base)] px-2.5 text-caption text-text-strong focus-visible:outline-2 focus-visible:outline-border-strong-focus"
                value={expiresInHours()}
                onInput={(event) => setExpiresInHours(Number(event.currentTarget.value))}
              >
                <option value={24}>In 1 day</option>
                <option value={24 * 7}>In 7 days</option>
                <option value={24 * 30}>In 30 days</option>
              </select>
            </label>
            <Show when={props.run.batchId && props.batchRunCount > 1}>
              <label class="flex items-start gap-2.5 rounded-lg bg-surface-base px-3 py-2.5 text-caption/[1.4] text-text-base">
                <input
                  type="checkbox"
                  class="mt-0.5 size-4 accent-[var(--accent-solid-base)]"
                  checked={includeBatch()}
                  onInput={(event) => setIncludeBatch(event.currentTarget.checked)}
                />
                <span>
                  <strong class="block font-medium text-text-strong">
                    Include all matrix results
                  </strong>
                  {props.batchRunCount} variants, grouped by screen in one report
                </span>
              </label>
            </Show>
            <Show when={createdUrl()}>
              {(url) => (
                <div class="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--border-weak-base)] p-2">
                  <span class="min-w-0 flex-1 truncate text-caption text-text-weaker">{url()}</span>
                  <Button size="sm" variant="secondary" onClick={() => void copy(url())}>
                    Copy
                  </Button>
                </div>
              )}
            </Show>
            <Button
              variant="primary"
              size="sm"
              disabled={busy()}
              onClick={() => void createShare()}
            >
              {busy() ? "Creating…" : "Create link"}
            </Button>
            <Show when={shares().length}>
              <div class="grid gap-1 border-t border-[var(--border-weak-base)] pt-3">
                <span class="mb-1 text-micro font-semibold tracking-[0.08em] text-text-weaker uppercase">
                  Previous links
                </span>
                <For each={shares().slice(0, 4)}>
                  {(share) => (
                    <div class="flex min-w-0 items-center gap-2 py-1.5 text-caption">
                      <span class="min-w-0 flex-1">
                        <strong class="block truncate font-medium text-text-base">
                          {share.runCount > 1 ? `${share.runCount} matrix results` : "This result"}
                        </strong>
                        <span class="text-text-weaker">
                          {share.status === "active"
                            ? `Expires ${expiresLabel(share.expiresAt)}`
                            : share.status}
                        </span>
                      </span>
                      <Show when={share.status === "active"}>
                        <button
                          type="button"
                          class="rounded-md px-2 py-1 text-caption text-text-weaker hover:bg-surface-base-hover hover:text-danger-base focus-visible:outline-2 focus-visible:outline-border-strong-focus"
                          onClick={() => void revoke(share)}
                        >
                          Revoke
                        </button>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </Portal>
      </Show>
    </div>
  );
}
