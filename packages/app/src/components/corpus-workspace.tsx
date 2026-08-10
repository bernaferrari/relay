import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type {
  CorpusAnalysisReport,
  CorpusFinding,
  CorpusScope,
  CorpusSession,
  CorpusScreen,
} from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { deviceReadiness } from "../lib/device-readiness";
import { cn } from "../lib/cn";
import { buildCorpusReviewModel } from "../lib/corpus-review-model";
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

export function CorpusWorkspace(props: { onBack?: () => void }) {
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
  const [analysis, setAnalysis] = createSignal<CorpusAnalysisReport | null>(null);
  const [setupOpen, setSetupOpen] = createSignal(false);
  const [optionsOpen, setOptionsOpen] = createSignal(false);
  const [optionQuery, setOptionQuery] = createSignal("");
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

  createEffect(() => {
    const session = selected();
    const revision = session ? `${session.id}:${session.updatedAt}:${session.screens.length}` : "";
    if (!session || !revision || server.health() !== "online") {
      setAnalysis(null);
      return;
    }
    const sessionId = session.id;
    void server
      .getCorpusAnalysis(sessionId)
      .then((report) => {
        if (selected()?.id === sessionId) setAnalysis(report);
      })
      .catch(() => {
        if (selected()?.id === sessionId) setAnalysis(null);
      });
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
  const visibleOptions = createMemo(() => {
    const query = optionQuery().trim().toLocaleLowerCase();
    const rows = activeProfile()?.languages ?? [];
    if (!query) return rows;
    return rows.filter((row) => `${row.tag} ${row.label}`.toLocaleLowerCase().includes(query));
  });

  createEffect(() => {
    void server.refreshLanguageProfiles?.();
  });

  createEffect(() => {
    if (sessions().length === 0) setSetupOpen(true);
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

  const reviewModel = createMemo(() => {
    const session = selected();
    return session ? buildCorpusReviewModel(session) : null;
  });
  const screenGroups = createMemo(() => reviewModel()?.groups ?? []);

  const compareGroup = createMemo(() => {
    const session = selected();
    const key = compareKey();
    if (!session || !key) return [] as CorpusScreen[];
    return session.screens
      .filter((screen) => screen.canonicalKey === key)
      .sort((left, right) => left.locale.localeCompare(right.locale));
  });

  const coverageSummary = createMemo(() => reviewModel()?.coverage ?? null);

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
    <div class="grid min-h-0 w-full flex-1 grid-rows-[auto_minmax(0,1fr)] bg-background-weak">
      <header class="flex flex-wrap items-center justify-between gap-3 border-b border-border-weak-base px-[clamp(18px,3vw,36px)] py-3">
        <div class="min-w-0">
          <button
            type="button"
            class="mb-0.5 inline-flex items-center gap-1 text-[11px] text-text-weak transition-colors hover:text-text-strong"
            onClick={props.onBack}
          >
            <Icon name="chevron-left" size={11} /> Runs
          </button>
          <h1 class="text-[19px] font-semibold tracking-[-0.025em] text-text-strong">
            Screenshot crawl
          </h1>
          <p class="mt-0.5 text-[12px] text-text-weak">
            Capture one settings walk across every selected language, account, or environment.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="md" onClick={() => void server.refreshCorpusSessions()}>
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
          <Button
            variant={setupOpen() ? "secondary" : "primary"}
            size="md"
            onClick={() => setSetupOpen((open) => !open)}
          >
            <Icon name={setupOpen() ? "x" : "plus"} size={13} />
            {setupOpen() ? "Close setup" : "New crawl"}
          </Button>
        </div>
      </header>

      <div class="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <aside class="min-h-0 overflow-y-auto border-b border-border-weak-base lg:border-r lg:border-b-0">
          <Show when={setupOpen()}>
            <section class="border-b border-border-weak-base p-4">
              <div class="grid gap-3">
                <div>
                  <h2 class="text-[13px] font-semibold text-text-strong">New crawl</h2>
                  <p class="mt-0.5 text-[11.5px] leading-[1.45] text-text-weak">
                    Choose values once. Relay maps the first, then repeats the same walk for every
                    other value.
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
                    <span class="text-[11px] font-medium text-text-weak">Values</span>
                    <button
                      type="button"
                      class="text-[10.5px] font-medium text-text-interactive-base hover:underline disabled:text-text-disabled"
                      disabled={scanning() || !selectedDeviceSerial() || !activeProfile()}
                      onClick={() => void scanOptionsOnDevice()}
                    >
                      {scanning() ? "Scanning…" : "Scan device"}
                    </button>
                  </div>
                  <button
                    type="button"
                    class="flex h-9 items-center justify-between gap-3 rounded-[9px] border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 text-left text-[12px] text-text-strong transition-colors hover:bg-surface-raised-base-hover"
                    onClick={() => setOptionsOpen((open) => !open)}
                  >
                    <span>
                      {selectedOptions().length} of {activeProfile()?.languages.length ?? 0}{" "}
                      selected
                    </span>
                    <Icon name={optionsOpen() ? "chevron-up" : "chevron-down"} size={12} />
                  </button>
                  <Show when={optionsOpen()}>
                    <div class="overflow-hidden rounded-[10px] border border-border-weak-base bg-surface-raised-stronger-non-alpha">
                      <div class="flex items-center gap-2 border-b border-border-weak-base p-2">
                        <input
                          type="search"
                          aria-label="Search values"
                          placeholder="Search values"
                          class="h-8 min-w-0 flex-1 rounded-[7px] bg-[var(--surface-base)] px-2.5 text-[12px] text-text-strong outline-none focus-visible:ring-1 focus-visible:ring-border-strong-focus"
                          value={optionQuery()}
                          onInput={(event) => setOptionQuery(event.currentTarget.value)}
                        />
                        <button
                          type="button"
                          class="h-8 px-1.5 text-[10.5px] font-medium text-text-interactive-base hover:underline"
                          onClick={() => {
                            const rows = activeProfile()?.languages ?? [];
                            setSelectedOptions(
                              selectedOptions().length === rows.length
                                ? [rows[0]?.tag].filter((tag): tag is string => Boolean(tag))
                                : rows.map((row) => row.tag),
                            );
                          }}
                        >
                          {selectedOptions().length === (activeProfile()?.languages.length ?? 0)
                            ? "First only"
                            : "Select all"}
                        </button>
                      </div>
                      <div class="max-h-56 overflow-y-auto p-1">
                        <For
                          each={visibleOptions()}
                          fallback={
                            <p class="px-2 py-3 text-[11px] text-text-weaker">No values found.</p>
                          }
                        >
                          {(row) => {
                            const on = () => selectedOptions().includes(row.tag);
                            return (
                              <label class="flex min-h-9 cursor-pointer items-center gap-2 rounded-[7px] px-2 text-[11.5px] transition-colors hover:bg-surface-raised-base-hover">
                                <input
                                  type="checkbox"
                                  class="size-4 accent-[var(--text-interactive-base)]"
                                  checked={on()}
                                  onChange={() => {
                                    setSelectedOptions((current) => {
                                      if (current.includes(row.tag)) {
                                        const next = current.filter((tag) => tag !== row.tag);
                                        return next.length ? next : current;
                                      }
                                      return [...current, row.tag];
                                    });
                                  }}
                                />
                                <span class={cn(mono, "w-14 shrink-0 text-text-weaker")}>
                                  {row.tag}
                                </span>
                                <span class="min-w-0 truncate text-text-strong">{row.label}</span>
                              </label>
                            );
                          }}
                        </For>
                      </div>
                    </div>
                  </Show>
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
                <p class="text-[10.5px] text-text-weaker">
                  Device: {selectedDevice()?.name ?? selectedDeviceSerial() ?? "None selected"}
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
                  Start maps the first value, then switches and captures every selected value.
                </p>
              </div>
            </section>
          </Show>

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
                            <span>{corpusValuesLabel(session)}</span>
                            <span>·</span>
                            <span>
                              {session.screens.length} shot
                              {session.screens.length === 1 ? "" : "s"}
                            </span>
                          </span>
                          <Show
                            when={
                              (session.status === "running" || session.status === "failed") &&
                              session.progress.message
                            }
                          >
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
              <div class="grid gap-4 px-[clamp(16px,2.5vw,28px)] py-4">
                <section class="grid gap-3 rounded-[14px] bg-[var(--surface-base)] p-4">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                      <h2 class="truncate text-[16px] font-semibold tracking-[-0.02em] text-text-strong">
                        {session().name}
                      </h2>
                      <p class="mt-0.5 text-[12px] text-text-weak">
                        Depth {session().scope.maxDepth} · {corpusValuesLabel(session())} ·{" "}
                        {session().targetProfile?.name ?? session().targetId}
                      </p>
                    </div>
                    <StatusChip
                      label={statusChip(session().status).label}
                      tone={statusChip(session().status).tone}
                    />
                  </div>

                  <Show when={session().status === "running"}>
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
                      <p class="text-[11.5px] text-text-weak">
                        <span class="font-medium text-text-strong">
                          {summary().shots} screenshot{summary().shots === 1 ? "" : "s"}
                        </span>{" "}
                        · {summary().complete} of {summary().logical} screens covered in every value
                        <Show when={summary().partial > 0}> · {summary().partial} partial</Show>
                        <Show when={analysis()}>
                          {(report) =>
                            report().findings.length > 0
                              ? ` · ${report().findings.length} to review`
                              : " · No deterministic issues"
                          }
                        </Show>
                      </p>
                    )}
                  </Show>

                  <Show when={session().mapPlan}>
                    {(plan) => (
                      <p class="text-[11px] text-text-weaker">
                        Mapped once in {plan().mappedLocale}:{" "}
                        {plan().actions.filter((action) => action.kind === "open").length} opens ·{" "}
                        {plan().actions.filter((action) => action.kind === "back").length} backs —
                        replayed for every other value
                      </p>
                    )}
                  </Show>

                  <Show
                    when={
                      session().status === "draft" ||
                      session().status === "failed" ||
                      session().status === "stopped" ||
                      session().status === "paused"
                    }
                  >
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
                        {session().status === "draft"
                          ? "Start crawl"
                          : session().status === "failed"
                            ? "Retry crawl"
                            : "Resume crawl"}
                      </Button>
                    </div>
                  </Show>
                </section>

                <Show
                  when={
                    session().screens.length > 0 &&
                    session().status !== "running" &&
                    analysis()?.findings.length
                      ? analysis()
                      : null
                  }
                >
                  {(report) => (
                    <section class="overflow-hidden rounded-[14px] border border-border-weak-base bg-[var(--surface-base)]">
                      <div class="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                        <div>
                          <h3 class="text-[13px] font-semibold text-text-strong">
                            Evidence review
                          </h3>
                          <p class="mt-0.5 text-[11.5px] text-text-weak">
                            Deterministic checks only. Possible translation issues still need human
                            review.
                          </p>
                        </div>
                        <span class={cn(mono, "text-[11px] text-text-weaker")}>
                          {report().critical} critical · {report().warnings} warnings
                        </span>
                      </div>
                      <ul class="divide-y divide-border-weak-base border-t border-border-weak-base">
                        <For each={report().findings.slice(0, 20)}>
                          {(finding) => (
                            <li>
                              <button
                                type="button"
                                class="grid w-full grid-cols-[7px_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-raised-base-hover"
                                onClick={() => {
                                  setCompareKey(finding.canonicalKey);
                                  setLocaleFilter(finding.locale);
                                }}
                              >
                                <span
                                  class={cn(
                                    "mt-1.5 size-[7px] rounded-full",
                                    finding.severity === "critical"
                                      ? "bg-text-critical-base"
                                      : "bg-text-warning-base",
                                  )}
                                />
                                <span class="min-w-0">
                                  <span class="block truncate text-[12px] font-medium text-text-strong">
                                    {findingLabel(finding)} · {finding.screenLabel}
                                  </span>
                                  <span class="mt-0.5 block text-[11.5px] leading-[1.45] text-text-weak">
                                    {finding.detail}
                                  </span>
                                </span>
                                <span class={cn(mono, "pt-px text-[10px] text-text-weaker")}>
                                  {finding.locale} · {finding.confidence}
                                </span>
                              </button>
                            </li>
                          )}
                        </For>
                      </ul>
                      <Show when={report().findings.length > 20}>
                        <p class="border-t border-border-weak-base px-4 py-2 text-[11px] text-text-weaker">
                          Showing 20 of {report().findings.length}. Export the pack for the complete
                          analysis.
                        </p>
                      </Show>
                    </section>
                  )}
                </Show>

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
                            <div class="grid h-[320px] place-items-center bg-[var(--background-deep)]">
                              <img
                                loading="lazy"
                                src={server.corpusScreenUrl(session().id, screen.id)}
                                alt={`${screen.locale} ${screen.path.join(" / ") || "root"}`}
                                class="max-h-full max-w-full object-contain"
                              />
                            </div>
                            <p class="truncate px-3 py-2 text-[11px] text-text-weak">
                              {screen.path.join(" › ") || screen.title || "Root"}
                            </p>
                          </figure>
                        )}
                      </For>
                    </div>
                  </section>
                </Show>

                <section class="grid gap-3 pb-4">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="text-[12px] font-semibold tracking-[0.04em] text-text-weak uppercase">
                      Screens
                    </h3>
                    <select
                      aria-label="Filter screenshots by value"
                      class="h-8 rounded-[8px] border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 text-[11.5px] text-text-strong outline-none focus-visible:ring-1 focus-visible:ring-border-strong-focus"
                      value={localeFilter()}
                      onChange={(event) =>
                        setLocaleFilter(event.currentTarget.value as string | "all")
                      }
                    >
                      <option value="all">All values</option>
                      <For each={session().scope.locales}>
                        {(locale) => <option value={locale}>{locale}</option>}
                      </For>
                    </select>
                  </div>

                  <Show
                    when={session().screens.length}
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
                    <Show
                      when={localeFilter() === "all"}
                      fallback={
                        <Show
                          when={screens().length}
                          fallback={
                            <p class="rounded-[12px] bg-[var(--surface-base)] px-4 py-5 text-[12px] text-text-weak">
                              No screenshots captured for this value.
                            </p>
                          }
                        >
                          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                            <For each={screens()}>
                              {(screen) => (
                                <CorpusScreenCard
                                  screen={screen}
                                  session={session()}
                                  imageUrl={server.corpusScreenUrl(session().id, screen.id)}
                                  meta={`${screen.locale} · d${screen.depth}`}
                                  onClick={() => setCompareKey(screen.canonicalKey)}
                                />
                              )}
                            </For>
                          </div>
                        </Show>
                      }
                    >
                      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                        <For each={screenGroups()}>
                          {(group) => (
                            <CorpusScreenCard
                              screen={group.representative}
                              session={session()}
                              imageUrl={server.corpusScreenUrl(
                                session().id,
                                group.representative.id,
                              )}
                              meta={`${group.coveredValues} of ${group.expectedValues} values`}
                              onClick={() => setCompareKey(group.canonicalKey)}
                            />
                          )}
                        </For>
                      </div>
                    </Show>
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

function findingLabel(finding: CorpusFinding): string {
  switch (finding.code) {
    case "SCREEN_MISSING":
      return "Screen missing";
    case "POSSIBLE_LOCALE_NOT_APPLIED":
      return "Language may not have changed";
    case "CONTROL_MISSING":
      return "Control missing";
    case "POSSIBLE_UNTRANSLATED_TEXT":
      return "Possible untranslated text";
  }
}

function corpusValuesLabel(session: CorpusSession): string {
  const count = session.scope.locales.length;
  if (count <= 3) return session.scope.locales.join(" · ");
  return `${count} values`;
}

function CorpusScreenCard(props: {
  screen: CorpusScreen;
  session: CorpusSession;
  imageUrl: string;
  meta: string;
  onClick: () => void;
}) {
  const title = () => props.screen.path.join(" › ") || props.screen.title || "Root";
  return (
    <button
      type="button"
      class="group overflow-hidden rounded-[12px] border border-border-weak-base bg-surface-raised-stronger-non-alpha text-left transition-colors hover:border-border-strong-base"
      onClick={props.onClick}
    >
      <div class="flex items-center justify-between gap-2 border-b border-border-weak-base px-3 py-2">
        <span class="truncate text-[11.5px] font-medium text-text-strong">{title()}</span>
        <span class={cn(mono, "shrink-0 text-[10px] text-text-weaker")}>{props.meta}</span>
      </div>
      <div class="grid h-[240px] place-items-center bg-[var(--background-deep)]">
        <img
          loading="lazy"
          src={props.imageUrl}
          alt={`${props.session.name} · ${title()}`}
          class="max-h-full max-w-full object-contain transition-opacity group-hover:opacity-95"
        />
      </div>
    </button>
  );
}
