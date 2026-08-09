import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { CorpusScope, CorpusSession, CorpusScreen } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { deviceReadiness } from "../lib/device-readiness";
import { cn } from "../lib/cn";
import { eyebrow, mono } from "../lib/ui";
import { EmptyState } from "./empty-state";
import { Icon } from "./icon";
import { StatusChip } from "./status-chip";

function statusChip(status: CorpusSession["status"]): {
  label: string;
  tone: "pass" | "attention" | "fail" | "run" | "idle";
} {
  switch (status) {
    case "running":
      return { label: "Running", tone: "run" };
    case "complete":
      return { label: "Complete", tone: "pass" };
    case "failed":
      return { label: "Failed", tone: "fail" };
    case "stopped":
      return { label: "Stopped", tone: "attention" };
    case "paused":
      return { label: "Paused", tone: "attention" };
    default:
      return { label: "Draft", tone: "idle" };
  }
}

export function CorpusWorkspace() {
  const server = useServer();

  const [selectedId, setSelectedId] = createSignal<string | null>(server.activeCorpusSessionId());
  const [creating, setCreating] = createSignal(false);
  const [starting, setStarting] = createSignal(false);
  const [scanning, setScanning] = createSignal(false);
  const [name, setName] = createSignal("Grok settings corpus");
  const [app, setApp] = createSignal("ai.x.GrokApp");
  const [profileId, setProfileId] = createSignal("grok-ios");
  const [selectedOptions, setSelectedOptions] = createSignal<string[]>(["en", "pt-BR", "it"]);
  const [maxDepth, setMaxDepth] = createSignal(3);
  const [localeFilter, setLocaleFilter] = createSignal<string | "all">("all");
  const [compareKey, setCompareKey] = createSignal<string | null>(null);
  const sessions = createMemo(() => server.corpusSessions());
  const selected = createMemo(
    () => sessions().find((session) => session.id === selectedId()) ?? null,
  );

  createEffect(() => {
    const active = server.activeCorpusSessionId();
    if (active) setSelectedId(active);
  });

  // Live refresh while a crawl is running.
  createEffect(() => {
    const session = selected();
    if (!session || session.status !== "running") return;
    const timer = setInterval(() => {
      void server.refreshCorpusSessions();
    }, 1500);
    onCleanup(() => clearInterval(timer));
  });

  createEffect(() => {
    void server.refreshCorpusSessions();
  });

  const devices = createMemo(() =>
    server.devices().filter((device) => device.platform === "ios" || device.platform === "android"),
  );
  const selectedDeviceSerial = createMemo(() => server.selectedDevice() ?? devices()[0]?.serial);

  const selectedDevice = createMemo(
    () => server.devices().find((device) => device.serial === selectedDeviceSerial()) ?? null,
  );
  const crawlReadiness = createMemo(() =>
    deviceReadiness(selectedDevice(), server.health() === "online", {
      ...(selectedDevice()?.platform === "ios" ? { appleSetup: server.appleDeviceSetup() } : {}),
      liveCaptureIssue: server.liveCaptureIssue(),
    }),
  );
  const crawlBlockedReason = createMemo(() => {
    const readiness = crawlReadiness();
    if (readiness.kind === "ready" || readiness.kind === "checking-ios") return null;
    if (readiness.kind === "choose-device") return "Connect an iPad or phone first";
    if ("title" in readiness && "detail" in readiness) {
      return `${readiness.title}. ${readiness.detail}`;
    }
    return "Device is not ready for control";
  });

  const activeProfile = createMemo(
    () => server.languageProfiles().find((profile) => profile.id === profileId()) ?? null,
  );

  createEffect(() => {
    void server.refreshLanguageProfiles?.();
  });

  const screens = createMemo(() => {
    const session = selected();
    if (!session) return [] as CorpusScreen[];
    const locale = localeFilter();
    const rows =
      locale === "all"
        ? session.screens
        : session.screens.filter((screen) => screen.locale === locale);
    return [...rows].sort((left, right) => {
      if (left.depth !== right.depth) return left.depth - right.depth;
      return left.path.join("/").localeCompare(right.path.join("/"));
    });
  });

  const compareGroup = createMemo(() => {
    const session = selected();
    const key = compareKey();
    if (!session || !key) return [] as CorpusScreen[];
    return session.screens
      .filter((screen) => screen.canonicalKey === key)
      .sort((left, right) => left.locale.localeCompare(right.locale));
  });

  const coverageSummary = createMemo(() => {
    const session = selected();
    if (!session) return null;
    const keys = new Set(session.screens.map((screen) => screen.canonicalKey));
    let complete = 0;
    for (const key of keys) {
      const locales = new Set(
        session.screens
          .filter((screen) => screen.canonicalKey === key)
          .map((screen) => screen.locale),
      );
      if (session.scope.locales.every((locale) => locales.has(locale))) complete += 1;
    }
    return {
      logical: keys.size,
      complete,
      partial: keys.size - complete,
      shots: session.screens.length,
    };
  });

  async function createAndMaybeStart(start: boolean) {
    const targetId = selectedDeviceSerial();
    if (!targetId) {
      toast("Connect an iPad or phone first", "error");
      return;
    }
    const blocked = crawlBlockedReason();
    if (blocked && start) {
      toast(blocked, "error");
      return;
    }
    const locales = selectedOptions();
    if (!locales.length) {
      toast("Select at least one option", "error");
      return;
    }
    if (!profileId()) {
      toast("Choose a switcher profile", "error");
      return;
    }
    const depth = Math.max(0, Math.min(6, Number(maxDepth()) || 0));
    const baseline =
      activeProfile()?.defaultLocale && locales.includes(activeProfile()!.defaultLocale!)
        ? activeProfile()!.defaultLocale!
        : locales.includes("en")
          ? "en"
          : locales[0]!;
    // Server expands switcher/language profile id → paths + real row labels.
    const scope: Partial<CorpusScope> & {
      languageProfileId?: string;
      switcherProfileId?: string;
    } = {
      maxDepth: depth,
      locales,
      mapLocale: baseline,
      strategy: "map-once-replay",
      app: app().trim() || activeProfile()?.app || undefined,
      maxScreens: 800,
      maxTransitions: 2_400,
      maxDurationMs: 90 * 60_000,
      languageProfileId: profileId(),
      switcherProfileId: profileId(),
    };
    setCreating(true);
    try {
      // Same actor must own the lease before start/scan control.
      await server.setSelectedDevice?.(targetId);
      const session = await server.createCorpusSession({
        name: name().trim() || "Screenshot crawl",
        targetId,
        scope,
      });
      if (!session) return;
      setSelectedId(session.id);
      toast("Screenshot pack created", "success");
      if (start) {
        setStarting(true);
        const started = await server.startCorpusSession(session.id);
        if (started)
          toast("Screenshot crawl started — keep the iPad unlocked and on the Ask tab", "success");
        else
          toast("Could not start screenshot crawl — check device readiness and signing", "error");
      }
    } finally {
      setCreating(false);
      setStarting(false);
    }
  }

  async function scanOptionsOnDevice() {
    const targetId = selectedDeviceSerial();
    const profile = activeProfile();
    if (!targetId) {
      toast("Connect an iPad or phone first", "error");
      return;
    }
    if (!profile) {
      toast("Choose a switcher profile first", "error");
      return;
    }
    setScanning(true);
    try {
      // Selecting the device claims/refreshes the exclusive control lease.
      await server.setSelectedDevice?.(targetId);
      const scanned = await server.scanLanguageProfile?.({
        serial: targetId,
        app: profile.app || app().trim() || "ai.x.GrokApp",
        profileId: profile.id,
        name: profile.name,
      });
      if (!scanned) return;
      setProfileId(scanned.id);
      setApp(scanned.app);
      setSelectedOptions(scanned.languages.map((row) => row.tag));
      setName(`${scanned.name} corpus`);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div class="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] bg-background-weak">
      <header class="flex flex-wrap items-end justify-between gap-3 border-b border-border-weak-base px-[clamp(18px,3vw,36px)] py-4">
        <div class="min-w-0">
          <p class={cn(eyebrow, "mb-1")}>Runs</p>
          <h1 class="text-[22px] font-semibold tracking-[-0.03em] text-text-strong">
            Screenshot crawl
          </h1>
          <p class="mt-1 max-w-[62ch] text-[12.5px] leading-[1.45] text-text-weak">
            Pick a saved switcher (language, account, environment, …). Capture the full settings
            walk once on the first option, then repeat it across the languages or accounts you
            select.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="md" onClick={() => void server.refreshCorpusSessions()}>
            <Icon name="refresh" size={13} /> Refresh
          </Button>
          <Show when={selected()?.status === "running"}>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                const id = selected()?.id;
                if (id) void server.cancelCorpusSession(id);
              }}
            >
              <Icon name="square" size={13} /> Stop
            </Button>
          </Show>
          <Show when={selected() && selected()!.status !== "running"}>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                const id = selected()?.id;
                if (id) void server.exportCorpusPack(id);
              }}
            >
              <Icon name="download" size={13} /> Export pack
            </Button>
          </Show>
        </div>
      </header>

      <div class="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <aside class="min-h-0 overflow-y-auto border-b border-border-weak-base lg:border-r lg:border-b-0">
          <section class="border-b border-border-weak-base p-4">
            <div class="grid gap-3">
              <div class="rounded-[10px] bg-[var(--surface-base)] px-3 py-2.5 text-[11.5px] leading-[1.45] text-text-weak">
                <p class="font-medium text-text-strong">Mouse path</p>
                <ol class="mt-1 list-decimal space-y-0.5 pl-4">
                  <li>Unlock iPad and open the app (Grok)</li>
                  <li>
                    Pick profile → <span class="text-text-strong">Scan options</span>
                  </li>
                  <li>
                    Toggle chips → <span class="text-text-strong">Start crawl</span>
                  </li>
                </ol>
                <p class="mt-1.5 text-[10.5px] text-text-weaker">
                  Scan does not relaunch the app — leave it open so the iOS runner stays healthy.
                </p>
              </div>
              <label class="grid gap-1">
                <span class="text-[11px] font-medium text-text-weak">Name</span>
                <input
                  class="h-9 rounded-[9px] border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 text-[12.5px] text-text-strong outline-none focus-visible:border-border-strong-focus"
                  value={name()}
                  onInput={(event) => setName(event.currentTarget.value)}
                />
              </label>
              <label class="grid gap-1">
                <span class="text-[11px] font-medium text-text-weak">Switcher profile</span>
                <select
                  class="h-9 rounded-[9px] border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 text-[12.5px] text-text-strong outline-none focus-visible:border-border-strong-focus"
                  value={profileId()}
                  onChange={(event) => {
                    const id = event.currentTarget.value;
                    setProfileId(id);
                    const profile = server.languageProfiles().find((item) => item.id === id);
                    if (profile) {
                      setApp(profile.app);
                      setSelectedOptions(profile.languages.map((row) => row.tag));
                      setName(`${profile.name} corpus`);
                    }
                  }}
                >
                  <For
                    each={server.languageProfiles()}
                    fallback={<option value="grok-ios">Grok · App Language (seed)</option>}
                  >
                    {(profile) => (
                      <option value={profile.id}>
                        {profile.name}
                        {profile.scanned ? " · scanned" : ""}
                      </option>
                    )}
                  </For>
                </select>
              </label>
              <div class="grid gap-1.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[11px] font-medium text-text-weak">Options</span>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="text-[10.5px] font-medium text-text-interactive-base hover:underline disabled:opacity-50"
                      disabled={scanning() || !selectedDeviceSerial() || !activeProfile()}
                      onClick={() => void scanOptionsOnDevice()}
                    >
                      {scanning() ? "Scanning…" : "Scan options on device"}
                    </button>
                    <button
                      type="button"
                      class="text-[10.5px] font-medium text-text-interactive-base hover:underline"
                      onClick={() => {
                        const profile = activeProfile();
                        if (!profile) return;
                        const all = profile.languages.map((row) => row.tag);
                        setSelectedOptions(
                          selectedOptions().length === all.length ? [all[0]!].filter(Boolean) : all,
                        );
                      }}
                    >
                      {activeProfile() &&
                      selectedOptions().length === activeProfile()!.languages.length
                        ? "Select first option only"
                        : "Select all"}
                    </button>
                  </div>
                </div>
                <div class="flex flex-wrap gap-1.5">
                  <For
                    each={activeProfile()?.languages ?? []}
                    fallback={
                      <span class="text-[11px] text-text-weaker">
                        No options yet — click Scan options on device.
                      </span>
                    }
                  >
                    {(row) => {
                      const on = () => selectedOptions().includes(row.tag);
                      return (
                        <button
                          type="button"
                          class={cn(
                            "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                            on()
                              ? "bg-surface-base-active text-text-strong"
                              : "bg-[var(--surface-base)] text-text-weak hover:text-text-strong",
                          )}
                          aria-pressed={on()}
                          title={row.label}
                          onClick={() => {
                            setSelectedOptions((current) => {
                              if (current.includes(row.tag)) {
                                const next = current.filter((tag) => tag !== row.tag);
                                return next.length ? next : current;
                              }
                              return [...current, row.tag];
                            });
                          }}
                        >
                          <span class={mono}>{row.tag}</span>
                          <span class="text-text-weaker"> · {row.label}</span>
                        </button>
                      );
                    }}
                  </For>
                </div>
                <Show when={activeProfile()?.scanned}>
                  <p class="text-[10.5px] text-text-weaker">
                    Live list from device
                    {activeProfile()?.verifiedAt ? ` · ${activeProfile()!.verifiedAt}` : ""}.
                  </p>
                </Show>
              </div>
              <label class="grid gap-1">
                <span class="text-[11px] font-medium text-text-weak">Max depth</span>
                <input
                  type="number"
                  min="0"
                  max="6"
                  class="h-9 w-24 rounded-[9px] border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 text-[12.5px] text-text-strong outline-none focus-visible:border-border-strong-focus"
                  value={maxDepth()}
                  onInput={(event) => setMaxDepth(Number(event.currentTarget.value) || 0)}
                />
              </label>
              <p class={cn(mono, "text-[10.5px] text-text-weaker")}>
                Device: {selectedDeviceSerial() ?? "none selected"}
                {activeProfile() ? ` · ${activeProfile()!.app}` : ""}
              </p>
              <div class="flex flex-wrap gap-2 pt-1">
                <Button
                  variant="secondary"
                  size="md"
                  disabled={creating() || starting() || scanning() || !selectedDeviceSerial()}
                  onClick={() => void createAndMaybeStart(false)}
                >
                  Create
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  disabled={
                    Boolean(crawlBlockedReason()) ||
                    creating() ||
                    starting() ||
                    scanning() ||
                    !selectedDeviceSerial()
                  }
                  onClick={() => void createAndMaybeStart(true)}
                >
                  <Icon name="play" size={13} />
                  {crawlBlockedReason()
                    ? "Device not ready"
                    : starting()
                      ? "Starting…"
                      : "Start crawl"}
                </Button>
              </div>
              <p class="text-[11px] leading-[1.45] text-text-weaker">
                Scan lists every option as chips. Start captures the walk once, then switches and
                screenshots each selected option.
              </p>
            </div>
          </section>

          <section class="p-3">
            <h2 class={cn(eyebrow, "mb-2 px-1")}>Sessions</h2>
            <Show
              when={sessions().length}
              fallback={
                <EmptyState
                  size="sm"
                  align="start"
                  icon="scan"
                  title="No screenshot packs yet"
                  description="Create a pack to walk settings pages and capture every screen across languages."
                />
              }
            >
              <ul class="grid gap-1">
                <For each={sessions()}>
                  {(session) => {
                    const chip = () => statusChip(session.status);
                    return (
                      <li>
                        <button
                          type="button"
                          class={cn(
                            "grid w-full gap-1 rounded-[10px] px-2.5 py-2 text-left transition-colors",
                            selectedId() === session.id
                              ? "bg-surface-base-active"
                              : "hover:bg-surface-raised-base-hover",
                          )}
                          onClick={() => {
                            setSelectedId(session.id);
                            server.setActiveCorpusSessionId(session.id);
                            setCompareKey(null);
                            setLocaleFilter("all");
                          }}
                        >
                          <span class="flex items-center justify-between gap-2">
                            <span class="truncate text-[12.5px] font-medium text-text-strong">
                              {session.name}
                            </span>
                            <StatusChip label={chip().label} tone={chip().tone} />
                          </span>
                          <span class="flex items-center gap-2 text-[10.5px] text-text-weaker">
                            <span>{session.scope.locales.join(" · ")}</span>
                            <span>·</span>
                            <span>
                              {session.screens.length} shot
                              {session.screens.length === 1 ? "" : "s"}
                            </span>
                          </span>
                          <Show when={session.progress.message}>
                            <span class="truncate text-[10.5px] text-text-weak">
                              {session.progress.message}
                            </span>
                          </Show>
                        </button>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </section>
        </aside>

        <main class="min-h-0 overflow-y-auto">
          <Show
            when={selected()}
            fallback={
              <EmptyState
                class="min-h-[50vh]"
                icon="camera"
                title="Start a screenshot crawl"
                description="Relay opens each settings page, captures it, switches languages, and saves a labeled pack you can compare later."
              />
            }
          >
            {(session) => (
              <div class="grid gap-5 px-[clamp(16px,2.5vw,28px)] py-4">
                <section class="grid gap-3 rounded-[14px] bg-[var(--surface-base)] p-4">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                      <h2 class="truncate text-[16px] font-semibold tracking-[-0.02em] text-text-strong">
                        {session().name}
                      </h2>
                      <p class="mt-1 text-[12px] text-text-weak">
                        Depth {session().scope.maxDepth} · {session().scope.locales.join(", ")} ·{" "}
                        {session().targetProfile?.name ?? session().targetId}
                      </p>
                    </div>
                    <StatusChip
                      label={statusChip(session().status).label}
                      tone={statusChip(session().status).tone}
                    />
                  </div>

                  <Show
                    when={session().status === "running" || session().progress.phase !== "idle"}
                  >
                    <div class="grid gap-2">
                      <div class="flex items-center justify-between gap-3 text-[11.5px]">
                        <span class="font-medium text-text-strong">
                          {session().progress.message ?? session().progress.phase}
                        </span>
                        <span class={cn(mono, "text-text-weaker")}>
                          {session().progress.screensCaptured} screens ·{" "}
                          {session().progress.transitionsCaptured} paths
                        </span>
                      </div>
                      <div class="h-1.5 overflow-hidden rounded-full bg-surface-base-active">
                        <div
                          class="h-full rounded-full bg-text-interactive-base transition-[width] duration-300"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round(
                                (session().screens.length /
                                  Math.max(1, session().scope.maxScreens * 0.25)) *
                                  100,
                              ),
                            )}%`,
                          }}
                        />
                      </div>
                      <Show when={session().progress.path?.length}>
                        <p class="text-[11px] text-text-weak">
                          {session().progress.locale ? `${session().progress.locale} · ` : ""}
                          {(session().progress.path ?? []).join(" › ")}
                        </p>
                      </Show>
                    </div>
                  </Show>

                  <Show when={session().error}>
                    <p class="rounded-[9px] bg-[color-mix(in_oklch,var(--text-danger)_10%,transparent)] px-3 py-2 text-[12px] text-text-strong">
                      {session().error}
                    </p>
                  </Show>

                  <Show when={coverageSummary()}>
                    {(summary) => (
                      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Metric label="Logical screens" value={String(summary().logical)} />
                        <Metric label="Complete locales" value={String(summary().complete)} />
                        <Metric label="Partial" value={String(summary().partial)} />
                        <Metric label="Shots" value={String(summary().shots)} />
                      </div>
                    )}
                  </Show>

                  <Show when={session().mapPlan}>
                    {(plan) => (
                      <p class="text-[11.5px] text-text-weak">
                        Map ({plan().mappedLocale}):{" "}
                        {plan().actions.filter((action) => action.kind === "open").length} opens ·{" "}
                        {plan().actions.filter((action) => action.kind === "back").length} backs —
                        replayed for every other locale
                      </p>
                    )}
                  </Show>

                  <Show when={session().status === "draft" || session().status === "failed"}>
                    <div>
                      <Button
                        variant="primary"
                        size="md"
                        disabled={starting()}
                        onClick={async () => {
                          setStarting(true);
                          try {
                            await server.startCorpusSession(session().id);
                          } finally {
                            setStarting(false);
                          }
                        }}
                      >
                        <Icon name="play" size={13} />
                        {session().status === "failed" ? "Retry crawl" : "Start crawl"}
                      </Button>
                    </div>
                  </Show>

                  <Show when={session().packRoot}>
                    <p class={cn(mono, "text-[10.5px] text-text-weaker")}>
                      Pack: .relay/corpus/{session().id}/{session().packRoot}
                    </p>
                  </Show>
                </section>

                <Show when={compareGroup().length > 1}>
                  <section class="grid gap-3">
                    <div class="flex items-center justify-between gap-2">
                      <h3 class="text-[12px] font-semibold tracking-[0.04em] text-text-weak uppercase">
                        Locale compare
                      </h3>
                      <Button variant="ghost" size="sm" onClick={() => setCompareKey(null)}>
                        Clear
                      </Button>
                    </div>
                    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <For each={compareGroup()}>
                        {(screen) => (
                          <figure class="overflow-hidden rounded-[12px] border border-border-weak-base bg-surface-raised-stronger-non-alpha">
                            <figcaption class="flex items-center justify-between gap-2 border-b border-border-weak-base px-3 py-2">
                              <span class="text-[12px] font-medium text-text-strong">
                                {screen.locale}
                              </span>
                              <span class={cn(mono, "text-[10px] text-text-weaker")}>
                                d{screen.depth}
                              </span>
                            </figcaption>
                            <img
                              src={server.corpusScreenUrl(session().id, screen.id)}
                              alt={`${screen.locale} ${screen.path.join(" / ") || "root"}`}
                              class="aspect-[3/4] w-full object-cover object-top bg-[var(--background-deep)]"
                            />
                            <p class="truncate px-3 py-2 text-[11px] text-text-weak">
                              {screen.path.join(" › ") || screen.title || "Root"}
                            </p>
                          </figure>
                        )}
                      </For>
                    </div>
                  </section>
                </Show>

                <section class="grid gap-3">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="text-[12px] font-semibold tracking-[0.04em] text-text-weak uppercase">
                      Captured pages
                    </h3>
                    <div class="flex flex-wrap gap-1">
                      <FilterChip
                        active={localeFilter() === "all"}
                        label="All"
                        onClick={() => setLocaleFilter("all")}
                      />
                      <For each={session().scope.locales}>
                        {(locale) => (
                          <FilterChip
                            active={localeFilter() === locale}
                            label={locale}
                            onClick={() => setLocaleFilter(locale)}
                          />
                        )}
                      </For>
                    </div>
                  </div>

                  <Show
                    when={screens().length}
                    fallback={
                      <EmptyState
                        size="sm"
                        align="start"
                        icon="camera"
                        title="No screens yet"
                        description={
                          session().status === "running"
                            ? "Crawl is in progress — pages appear here as they are captured."
                            : "Start the crawl to fill this grid."
                        }
                      />
                    }
                  >
                    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      <For each={screens()}>
                        {(screen) => (
                          <button
                            type="button"
                            class="group overflow-hidden rounded-[12px] border border-border-weak-base bg-surface-raised-stronger-non-alpha text-left transition-colors hover:border-border-strong-base"
                            onClick={() => setCompareKey(screen.canonicalKey)}
                          >
                            <div class="flex items-center justify-between gap-2 border-b border-border-weak-base px-3 py-2">
                              <span class="truncate text-[11.5px] font-medium text-text-strong">
                                {screen.path.join(" › ") || screen.title || "Root"}
                              </span>
                              <span class={cn(mono, "shrink-0 text-[10px] text-text-weaker")}>
                                {screen.locale} · d{screen.depth}
                              </span>
                            </div>
                            <img
                              src={server.corpusScreenUrl(session().id, screen.id)}
                              alt=""
                              class="aspect-[3/4] w-full object-cover object-top bg-[var(--background-deep)] transition-opacity group-hover:opacity-95"
                            />
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </section>
              </div>
            )}
          </Show>
        </main>
      </div>
    </div>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div class="rounded-[10px] bg-surface-raised-stronger-non-alpha px-3 py-2">
      <div class={cn(mono, "text-[15px] font-semibold tabular-nums text-text-strong")}>
        {props.value}
      </div>
      <div class="mt-0.5 text-[10.5px] text-text-weaker">{props.label}</div>
    </div>
  );
}

function FilterChip(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      class={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
        props.active
          ? "bg-surface-base-active text-text-strong"
          : "text-text-weak hover:bg-surface-raised-base-hover hover:text-text-strong",
      )}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}
