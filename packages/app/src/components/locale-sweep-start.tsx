import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js";
import { Button } from "@relay/ui/button";
import type { CorpusSession } from "@relay/protocol";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { cn } from "../lib/cn";
import {
  createCorpusSweep,
  listLanguageSwitchers,
  startCorpusSweep,
  type LanguageSwitcherSummary,
} from "../lib/corpus-remote";
import { humanError } from "../lib/human-error";
import { plural } from "../lib/plural";
import { presentTarget, targetIsReady } from "../lib/target-presentation";
import { Icon } from "./icon";

/**
 * Start a sweep: one app, one scanned language picker, and the languages to
 * walk. Everything else — the entry path, the picker path, the row to tap for
 * each language — comes from the scanned profile, because those are the parts
 * nobody should retype and nobody should guess.
 */
export function LocaleSweepStart(props: {
  suggestedName?: string;
  onCancel: () => void;
  onStarted: (session: CorpusSession) => void;
}) {
  const server = useServer();
  const [profiles] = createResource(
    () => (server.health() === "online" ? "online" : null),
    () => listLanguageSwitchers(server.runAction),
  );
  const [profileId, setProfileId] = createSignal("");
  const [locales, setLocales] = createSignal<string[]>([]);
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const profile = createMemo(() => (profiles.latest ?? []).find((item) => item.id === profileId()));
  const device = createMemo(() =>
    server.devices().find((item) => item.serial === server.selectedDevice()),
  );
  const deviceReady = createMemo(() => targetIsReady(device(), server.health() === "online"));

  // Choosing a picker chooses the app, so the name and the language list follow
  // it rather than being typed twice.
  createEffect(() => {
    const list = profiles.latest ?? [];
    if (!list.length || profileId()) return;
    setProfileId(list[0]!.id);
  });
  createEffect(() => {
    const current = profile();
    if (!current) return;
    setLocales(current.options.map((option) => option.id));
    setName(props.suggestedName?.trim() || `${current.name} · every screen`);
  });

  const issue = createMemo(() => {
    if (!deviceReady()) return "Connect a ready device to sweep it.";
    if (!profile()) return "Scan a language picker first.";
    if (locales().length < 2) return "Choose at least two languages to compare.";
    if (!name().trim()) return "Name this sweep.";
    return "";
  });

  async function start() {
    const current = profile();
    const serial = server.selectedDevice();
    if (!current || !serial || issue() || busy()) return;
    setBusy(true);
    try {
      const session = await createCorpusSweep(server.runAction, {
        name: name().trim(),
        targetId: serial,
        switcherProfileId: current.id,
        locales: locales(),
      });
      try {
        props.onStarted(await startCorpusSweep(server.runAction, session.id));
        toast(`Sweeping ${plural(locales().length, "language")}`, "success");
      } catch (error) {
        // The sweep exists and can be started again once the device frees up,
        // so it is handed back rather than lost with the error.
        props.onStarted(session);
        toast(humanError(error, "Saved the sweep, but could not start it"), "warning");
      }
    } catch (error) {
      toast(humanError(error, "Could not create this sweep"), "error");
    } finally {
      setBusy(false);
    }
  }

  const toggleLocale = (id: string) =>
    setLocales((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  return (
    <section
      class="grid gap-4 rounded-2xl bg-[var(--background-base)] p-4 shadow-[0_0_0_1px_var(--border-weak-base)]"
      aria-label="New locale sweep"
    >
      <header class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h3 class="m-0 text-body font-semibold text-[var(--text-strong)]">New locale sweep</h3>
          <p class="m-0 mt-0.5 text-caption/[1.45] text-[var(--text-weak)]">
            Relay maps every screen once, then replays that same tree in each language and compares
            what came back.
          </p>
        </div>
        <Button variant="ghost" size="sm" aria-label="Cancel new sweep" onClick={props.onCancel}>
          <Icon name="x" size={14} />
        </Button>
      </header>

      <Show
        when={(profiles.latest ?? []).length}
        fallback={
          <p class="m-0 flex items-start gap-2 rounded-[var(--radius-control)] bg-[var(--surface-base)] px-2.5 py-2 text-micro/[1.45] text-[var(--text-base)]">
            <Icon name="info" size={12} class="mt-0.5 shrink-0" />
            No language picker has been scanned yet. Scan one from the device with{" "}
            <code class="font-mono">relay switcher-profile scan</code>, then this sweep can replay
            it.
          </p>
        }
      >
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="grid gap-1.5">
            <span class="text-caption font-semibold text-[var(--text-weak)]">Language picker</span>
            <select
              class="h-9 w-full rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 text-caption font-medium text-[var(--text-strong)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
              value={profileId()}
              onChange={(event) => setProfileId(event.currentTarget.value)}
            >
              <For each={profiles.latest ?? []}>
                {(item) => <option value={item.id}>{switcherLabel(item)}</option>}
              </For>
            </select>
          </label>
          <label class="grid gap-1.5">
            <span class="text-caption font-semibold text-[var(--text-weak)]">Sweep name</span>
            <input
              class="h-9 w-full rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 text-caption text-[var(--text-strong)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
              value={name()}
              spellcheck={false}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          </label>
        </div>

        <fieldset class="grid gap-2 border-0 p-0">
          <legend class="flex w-full items-baseline justify-between gap-3">
            <span class="text-caption font-semibold text-[var(--text-weak)]">
              Languages
              <span class="ml-1.5 tabular-nums text-[var(--text-weaker)]">
                {locales().length}/{profile()?.options.length ?? 0}
              </span>
            </span>
            <button
              type="button"
              class="text-micro font-medium text-[var(--text-interactive-base)]"
              onClick={() =>
                setLocales(
                  locales().length === (profile()?.options.length ?? 0)
                    ? []
                    : (profile()?.options ?? []).map((option) => option.id),
                )
              }
            >
              {locales().length === (profile()?.options.length ?? 0) ? "Clear" : "Select all"}
            </button>
          </legend>
          <div class="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto overscroll-contain">
            <For each={profile()?.options ?? []}>
              {(option) => {
                const on = () => locales().includes(option.id);
                return (
                  <button
                    type="button"
                    aria-pressed={on()}
                    class={cn(
                      "inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-micro font-medium transition-[background-color,box-shadow] duration-[var(--duration-hover)] motion-reduce:transition-none",
                      on()
                        ? "bg-[var(--surface-base-hover)] text-[var(--text-strong)] shadow-[inset_0_0_0_1px_var(--border-strong-base)]"
                        : "text-[var(--text-weak)] shadow-[inset_0_0_0_1px_var(--border-weak-base)] hover:text-[var(--text-base)]",
                    )}
                    onClick={() => toggleLocale(option.id)}
                  >
                    <Show when={on()}>
                      <Icon name="check" size={9} />
                    </Show>
                    {option.label}
                  </button>
                );
              }}
            </For>
          </div>
        </fieldset>
      </Show>

      <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-weak-base)] pt-3">
        <span class="min-w-0 text-micro text-[var(--text-weak)]">
          {issue() ||
            `${plural(locales().length, "language")} × every mapped screen on ${
              device() ? presentTarget(device()!).displayName : "this device"
            }`}
        </span>
        <div class="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={Boolean(issue()) || busy()}
            aria-busy={busy()}
            onClick={() => void start()}
          >
            {busy() ? "Starting…" : "Sweep languages"}
          </Button>
        </div>
      </footer>
    </section>
  );
}

function switcherLabel(profile: LanguageSwitcherSummary): string {
  const suffix = profile.scanned === false ? " (seeded)" : "";
  return `${profile.name} · ${plural(profile.options.length, "language")}${suffix}`;
}
