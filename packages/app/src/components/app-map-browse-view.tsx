import { For, Show, createMemo, createSignal } from "solid-js";
import type { AppMap, Screen } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import type { PersistedRun } from "../context/server";
import { cn } from "../lib/cn";
import { appMapIdForJob } from "../lib/run-presentation";
import {
  browseOutcomeLabel,
  deriveAppMapAreas,
  type BrowseRunOutcome,
} from "../lib/app-map-browse";
import { Icon } from "./icon";
import { OrientedScreenshot, type ScreenshotOrientationEvidence } from "./oriented-screenshot";

export type AppMapBrowseMode = "screens" | "coverage";

type ScreenState = "idle" | "running" | "passed" | "failed" | "healed" | "blocked" | "unknown";

export function AppMapBrowseView(props: {
  mode: AppMapBrowseMode;
  appMap: AppMap;
  runs: readonly PersistedRun[];
  recipeId: string;
  targetNameForId: (targetId: string) => string | undefined;
  deviceOpen: boolean;
  imageForScreen: (screenId: string) => string;
  orientationEvidenceForScreen: (screenId: string) => ScreenshotOrientationEvidence | undefined;
  stateForScreen: (screenId: string) => ScreenState | undefined;
  onOpenScreen: (screenId: string) => void;
  onOpenRun: (runId: string) => void;
  onToggleDevice: () => void;
  onCaptureScreen: () => void;
  onOpenAgent: () => void;
  onRefreshScreenshots: () => void;
  refreshScreenshotsHint?: string;
}) {
  const [screenQuery, setScreenQuery] = createSignal("");
  const [coverageQuery, setCoverageQuery] = createSignal("");
  const query = () => (props.mode === "screens" ? screenQuery() : coverageQuery());
  const setQuery = (value: string) =>
    props.mode === "screens" ? setScreenQuery(value) : setCoverageQuery(value);
  const [platform, setPlatform] = createSignal<"all" | "android" | "ios" | "browser">("all");
  const [outcome, setOutcome] = createSignal<"all" | BrowseRunOutcome>("all");
  const [screenPlatform, setScreenPlatform] = createSignal<"all" | "android" | "ios" | "browser">(
    "all",
  );
  const [baseline, setBaseline] = createSignal<"all" | "approved" | "missing">("all");
  const areas = createMemo(() => deriveAppMapAreas(props.appMap));
  const explicitGroupCount = () => Object.keys(props.appMap.groups).length;
  const filteredAreas = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase();
    return areas()
      .map((area) => ({
        ...area,
        screenIds: area.screenIds.filter((id) => {
          const screen = props.appMap.screens[id];
          const variants = screen?.variantIds.flatMap((variantId) => {
            const variant = props.appMap.screenVariants[variantId];
            return variant ? [variant] : [];
          });
          const matchesQuery = !needle || screen?.title.toLocaleLowerCase().includes(needle);
          const matchesPlatform =
            screenPlatform() === "all" ||
            variants?.some((variant) => variant.targetProfile.platform === screenPlatform());
          const matchesBaseline =
            baseline() === "all" ||
            (baseline() === "approved"
              ? variants?.some((variant) => variant.baseline)
              : !variants?.some((variant) => variant.baseline));
          return matchesQuery && matchesPlatform && matchesBaseline;
        }),
      }))
      .filter((area) => area.screenIds.length > 0);
  });
  const rows = createMemo(() =>
    coverageRows(props.appMap, props.runs, props.recipeId, props.targetNameForId),
  );
  const screenFiltersActive = () =>
    Boolean(query().trim()) || screenPlatform() !== "all" || baseline() !== "all";
  const clearScreenFilters = () => {
    setScreenQuery("");
    setScreenPlatform("all");
    setBaseline("all");
  };
  const coverageFiltersActive = () =>
    Boolean(coverageQuery().trim()) || platform() !== "all" || outcome() !== "all";
  const clearCoverageFilters = () => {
    setCoverageQuery("");
    setPlatform("all");
    setOutcome("all");
  };
  const filteredRows = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase();
    return rows().filter(
      (row) =>
        (platform() === "all" || row.platform === platform()) &&
        (outcome() === "all" || row.outcome === outcome()) &&
        (!needle ||
          row.label.toLocaleLowerCase().includes(needle) ||
          row.target.toLocaleLowerCase().includes(needle) ||
          row.actor.toLocaleLowerCase().includes(needle)),
    );
  });

  return (
    <div
      class={cn(
        "absolute inset-0 min-h-0 overflow-y-auto bg-[var(--map-canvas)] pt-[72px] pb-24 transition-[padding] duration-150",
        // The live companion grows to 548px for landscape tablets. Reserve
        // its largest desktop footprint so search, filters, and primary
        // actions never render underneath a perfectly visible device.
        props.deviceOpen && "pr-[564px] max-[900px]:pr-0",
      )}
    >
      <div class="mx-auto w-full max-w-[1440px] px-[clamp(18px,3vw,44px)]">
        <header class="mb-4 flex items-center justify-between gap-5 max-[720px]:items-start max-[720px]:flex-col">
          <div class="min-w-0">
            <h2 class="text-[21px]/[1.15] font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
              {props.mode === "screens" ? "Screens" : "Coverage"}
            </h2>
            <p class="mt-1 max-w-[680px] text-[12px]/[1.5] text-[var(--text-weak)]">
              {props.mode === "screens"
                ? explicitGroupCount()
                  ? `${Object.keys(props.appMap.screens).length} ${Object.keys(props.appMap.screens).length === 1 ? "screen" : "screens"} · ${explicitGroupCount()} ${explicitGroupCount() === 1 ? "Group" : "Groups"}`
                  : `${Object.keys(props.appMap.screens).length} ${Object.keys(props.appMap.screens).length === 1 ? "screen" : "screens"}, organized by path.`
                : `${rows().length} ${rows().length === 1 ? "result" : "results"}. Every device and actor stays independently inspectable.`}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Show when={props.mode === "screens"}>
              <Button
                variant="secondary"
                size="md"
                data-tip={
                  props.refreshScreenshotsHint ??
                  "Replay the flow and compare fresh captures with approved baselines"
                }
                onClick={props.onRefreshScreenshots}
              >
                <Icon name="camera" size={13} /> Refresh screenshots
              </Button>
            </Show>
            <Button variant="secondary" size="md" onClick={props.onOpenAgent}>
              <Icon name="scan" size={13} /> Explore with Relay
            </Button>
          </div>
        </header>

        <div
          class={cn(
            "sticky top-[64px] z-10 mb-5 flex min-h-12 items-center gap-2 rounded-[11px] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_94%,transparent)] p-1 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted),0_6px_18px_rgb(0_0_0/6%)] backdrop-blur-[14px] max-[680px]:flex-wrap",
            props.mode === "screens" && "max-w-[760px]",
          )}
        >
          <label class="relative min-w-[180px] flex-1">
            <span class="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-[var(--text-weak)]">
              <Icon name="search" size={14} />
            </span>
            <span class="sr-only">Search {props.mode}</span>
            <input
              class="h-10 w-full rounded-[9px] border border-transparent bg-transparent pr-3 pl-9 text-[16px] text-[var(--text-strong)] outline-none transition-[background-color,border-color] duration-150 placeholder:text-[var(--text-weak)] hover:bg-[var(--v2-background-bg-layer-01)] focus:border-[var(--v2-border-border-strong)] focus:bg-[var(--v2-background-bg-base)] min-[681px]:text-[12.5px]"
              value={query()}
              placeholder={
                props.mode === "screens" ? "Search screens" : "Search results, people, or devices"
              }
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <Show when={props.mode === "screens"}>
            <FilterSelect
              label="Target platform"
              value={screenPlatform()}
              onChange={(value) => setScreenPlatform(value as ReturnType<typeof screenPlatform>)}
              options={[
                ["all", "All targets"],
                ["android", "Android"],
                ["ios", "iOS"],
                ["browser", "Browser"],
              ]}
            />
            <FilterSelect
              label="Screenshot baseline"
              value={baseline()}
              onChange={(value) => setBaseline(value as ReturnType<typeof baseline>)}
              options={[
                ["all", "All baselines"],
                ["approved", "Approved"],
                ["missing", "Needs baseline"],
              ]}
            />
          </Show>
          <Show when={props.mode === "coverage"}>
            <FilterSelect
              label="Platform"
              value={platform()}
              onChange={(value) => setPlatform(value as ReturnType<typeof platform>)}
              options={[
                ["all", "All platforms"],
                ["android", "Android"],
                ["ios", "iOS"],
                ["browser", "Browser"],
              ]}
            />
            <FilterSelect
              label="Result"
              value={outcome()}
              onChange={(value) => setOutcome(value as ReturnType<typeof outcome>)}
              options={[
                ["all", "All results"],
                ["passed", "Passed"],
                ["product-failure", "Product issue"],
                ["harness-failure", "Setup issue"],
                ["uncertain", "Needs review"],
                ["running", "Running"],
                ["cancelled", "Cancelled"],
              ]}
            />
          </Show>
        </div>

        <Show
          when={props.mode === "screens"}
          fallback={
            <CoverageTable
              rows={filteredRows()}
              hasAnyRuns={rows().length > 0}
              filtersActive={coverageFiltersActive()}
              onClearFilters={clearCoverageFilters}
              onOpenRun={props.onOpenRun}
            />
          }
        >
          <div class="grid items-start gap-y-9">
            <For
              each={filteredAreas()}
              fallback={
                <BrowseEmpty
                  icon="search"
                  title={screenFiltersActive() ? "No screens match" : "No screens yet"}
                  body={
                    screenFiltersActive()
                      ? "Try broader filters."
                      : props.deviceOpen
                        ? "Capture the screen already visible on the device, or let Relay explore the app."
                        : "Open the device or let Relay explore the app."
                  }
                  actionLabel={
                    screenFiltersActive()
                      ? "Clear filters"
                      : props.deviceOpen
                        ? "Capture current screen"
                        : "Open device"
                  }
                  onAction={() =>
                    screenFiltersActive()
                      ? clearScreenFilters()
                      : props.deviceOpen
                        ? props.onCaptureScreen()
                        : props.onToggleDevice()
                  }
                />
              }
            >
              {(area) => (
                <section
                  aria-labelledby={`area-${area.id}`}
                  class="min-w-0 [content-visibility:auto] [contain-intrinsic-size:auto_320px]"
                >
                  <header class="mb-3 flex items-baseline gap-2.5">
                    <h3
                      id={`area-${area.id}`}
                      class="text-[15px] font-semibold tracking-[-0.015em] text-[var(--text-strong)]"
                    >
                      {area.title}
                    </h3>
                    <span class="text-[10.5px] tabular-nums text-[var(--text-weak)]">
                      {area.screenIds.length} {area.screenIds.length === 1 ? "screen" : "screens"}
                    </span>
                  </header>
                  <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,210px),1fr))] items-start gap-5">
                    <For each={area.screenIds}>
                      {(screenId) => {
                        const screen = () => props.appMap.screens[screenId]!;
                        return (
                          <ScreenTile
                            screen={screen()}
                            image={props.imageForScreen(screenId)}
                            orientationEvidence={props.orientationEvidenceForScreen(screenId)}
                            state={props.stateForScreen(screenId)}
                            incoming={incomingCount(props.appMap, screenId)}
                            outgoing={outgoingCount(props.appMap, screenId)}
                            targets={screenTargetNames(props.appMap, screen())}
                            approvedTargets={screenApprovedTargetCount(props.appMap, screen())}
                            onOpen={() => props.onOpenScreen(screenId)}
                          />
                        );
                      }}
                    </For>
                  </div>
                </section>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

function ScreenTile(props: {
  screen: Screen;
  image: string;
  orientationEvidence?: ScreenshotOrientationEvidence;
  state?: ScreenState;
  incoming: number;
  outgoing: number;
  targets: string[];
  approvedTargets: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      class="group min-w-0 rounded-[10px] bg-transparent p-0 text-left outline-none transition-transform duration-150 hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] focus-visible:ring-offset-3 focus-visible:ring-offset-[var(--map-canvas)] motion-reduce:hover:translate-y-0"
      onClick={props.onOpen}
    >
      <div class="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-[9px] bg-[var(--v2-background-bg-base)] shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)] transition-shadow duration-150 group-hover:shadow-[inset_0_0_0_1px_var(--v2-border-border-strong),0_8px_20px_rgb(0_0_0/7%)]">
        <Show
          when={props.image}
          fallback={
            <div class="grid max-w-[170px] justify-items-center gap-2 px-4 text-center text-[var(--text-weak)] transition-colors duration-150 group-hover:text-[var(--text-base)]">
              <span class="grid size-9 place-items-center rounded-[10px] bg-[var(--v2-background-bg-layer-02)]">
                <Icon name="camera" size={15} />
              </span>
              <span class="text-[11px] font-medium text-[var(--text-base)]">
                Preview not captured
              </span>
              <span class="text-[9.5px]/[1.35]">Open this screen to capture it</span>
            </div>
          }
        >
          <OrientedScreenshot
            src={props.image}
            alt=""
            loading="lazy"
            class="block size-full object-contain"
            evidence={props.orientationEvidence}
          />
        </Show>
        <Show when={props.state && props.state !== "idle"}>
          <span class={cn("absolute top-2 right-2", statePill(props.state!))}>
            <i class="size-1.5 rounded-full bg-current" /> {stateLabel(props.state!)}
          </span>
        </Show>
        <Show when={props.targets.length > 0}>
          <span class="absolute bottom-2 left-2 inline-flex min-h-6 items-center rounded-full bg-[color-mix(in_srgb,var(--v2-background-bg-base)_92%,transparent)] px-2 text-[9px] font-medium text-[var(--text-base)] shadow-[0_1px_5px_rgb(0_0_0/12%)] backdrop-blur">
            {baselineCoverageLabel(props.approvedTargets, props.targets.length)}
          </span>
        </Show>
      </div>
      <div class="grid gap-2 px-1 pt-2.5 pb-1">
        <div class="flex min-w-0 items-start justify-between gap-2">
          <strong class="truncate text-[12.5px] font-semibold text-[var(--text-strong)]">
            {props.screen.title}
          </strong>
          <Icon
            name="arrow-right"
            size={12}
            class="mt-0.5 shrink-0 text-[var(--text-weak)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </div>
        <div class="flex min-w-0 items-center gap-2 text-[10px] text-[var(--text-weak)]">
          <span class="tabular-nums">
            {props.incoming
              ? `${props.incoming} ${props.incoming === 1 ? "path" : "paths"} in`
              : "Entry screen"}
          </span>
          <i class="size-0.5 rounded-full bg-[var(--text-weak)] opacity-60" />
          <span class="tabular-nums">
            {props.outgoing
              ? `${props.outgoing} ${props.outgoing === 1 ? "path" : "paths"} out`
              : "End"}
          </span>
          <Show when={props.targets.length}>
            <i class="size-0.5 rounded-full bg-[var(--text-weak)] opacity-60" />
            <span class="truncate">
              {props.targets.length} {props.targets.length === 1 ? "target" : "targets"}
            </span>
          </Show>
        </div>
      </div>
    </button>
  );
}

type CoverageRow = {
  id: string;
  label: string;
  actor: string;
  target: string;
  platform: "android" | "ios" | "browser";
  outcome: BrowseRunOutcome;
  finishedAt: number;
  durationMs?: number;
};

function coverageRows(
  appMap: AppMap,
  runs: readonly PersistedRun[],
  appMapId: string,
  targetNameForId: (targetId: string) => string | undefined,
): CoverageRow[] {
  const canonical = Object.values(appMap.targetResults).map((result) => {
    const connection = result.connectionId ? appMap.connections[result.connectionId] : undefined;
    const run = appMap.runs[result.runId];
    const persistedRun = runs.find((candidate) => candidate.id === result.runId);
    return {
      id: result.runId,
      label:
        connection?.label ?? (connection ? connectionLabel(appMap, connection.id) : "App Map run"),
      actor: persistedRun ? actorForRun(persistedRun) : "Relay",
      target: result.targetProfile.name,
      platform: result.targetProfile.platform,
      outcome: result.outcome,
      finishedAt: result.finishedAt ?? run?.finishedAt ?? result.updatedAt,
      ...(persistedRun?.durationMs !== undefined ? { durationMs: persistedRun.durationMs } : {}),
    } satisfies CoverageRow;
  });
  const canonicalIds = new Set(canonical.map((row) => row.id));
  const persisted = runs
    // App Map execution uses a private, revisioned recipe id. Comparing that
    // full action to the durable map id made successful runs disappear from
    // Coverage even though their reports were persisted correctly.
    .filter((run) => appMapIdForJob(run) === appMapId && !canonicalIds.has(run.id))
    .map((run) => {
      const platform =
        run.targetProfile?.platform ??
        (run.platform === "ios" || run.platform === "browser" ? run.platform : "android");
      return {
        id: run.id,
        label: run.title ?? run.recipeSnapshot?.title ?? "App Map run",
        actor: actorForRun(run),
        target:
          run.targetProfile?.name ??
          (run.serial ? targetNameForId(run.serial) : undefined) ??
          platformName(platform),
        platform,
        outcome: runOutcome(run),
        finishedAt: run.finishedAt ?? run.writtenAt,
        ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
      } satisfies CoverageRow;
    });
  return [...canonical, ...persisted].sort((left, right) => right.finishedAt - left.finishedAt);
}

function actorForRun(run: PersistedRun): string {
  const provenance = (
    run as PersistedRun & {
      executionProvenance?: { actorId?: string; actorKind?: string };
    }
  ).executionProvenance;
  return (
    provenance?.actorId?.replace(/^(human|agent|system):/, "") ||
    (provenance?.actorKind === "agent" ? "Agent" : "You")
  );
}

function CoverageTable(props: {
  rows: CoverageRow[];
  hasAnyRuns: boolean;
  filtersActive: boolean;
  onClearFilters: () => void;
  onOpenRun: (runId: string) => void;
}) {
  const visibleRows = () => props.rows.slice(0, 200);

  return (
    <Show
      when={props.rows.length}
      fallback={
        <BrowseEmpty
          icon={props.hasAnyRuns ? "search" : "clock"}
          title={props.hasAnyRuns ? "No runs match these filters" : "No runs yet"}
          body={
            props.hasAnyRuns
              ? "Try broader filters or clear the search."
              : "Run this map on one device or a target set. Each target will keep its own result."
          }
          actionLabel={props.hasAnyRuns && props.filtersActive ? "Clear filters" : undefined}
          onAction={props.hasAnyRuns && props.filtersActive ? props.onClearFilters : undefined}
        />
      }
    >
      <div class="overflow-hidden rounded-[13px] bg-[var(--v2-background-bg-base)] shadow-[0_0_0_1px_var(--v2-border-border-muted),0_10px_28px_rgb(0_0_0/6%)]">
        <div class="grid grid-cols-[minmax(180px,1.5fr)_minmax(130px,1fr)_minmax(120px,.8fr)_110px_118px] gap-4 border-b border-[var(--v2-border-border-muted)] px-4 py-2.5 text-[9.5px] font-semibold tracking-[0.08em] text-[var(--text-weak)] uppercase max-[820px]:grid-cols-[minmax(160px,1fr)_minmax(130px,.8fr)_110px] max-[820px]:[&>*:nth-child(3)]:hidden max-[820px]:[&>*:nth-child(5)]:hidden">
          <span>Run</span>
          <span>Target</span>
          <span>Actor</span>
          <span>Result</span>
          <span>Date</span>
        </div>
        <For each={visibleRows()}>
          {(row) => (
            <button
              type="button"
              class="grid min-h-14 w-full grid-cols-[minmax(180px,1.5fr)_minmax(130px,1fr)_minmax(120px,.8fr)_110px_118px] items-center gap-4 border-b border-[var(--v2-border-border-muted)] px-4 text-left text-[11.5px] outline-none transition-colors duration-150 last:border-b-0 hover:bg-[var(--v2-background-bg-layer-01)] focus-visible:bg-[var(--product-accent-soft)] max-[820px]:grid-cols-[minmax(160px,1fr)_minmax(130px,.8fr)_110px] max-[820px]:[&>*:nth-child(3)]:hidden max-[820px]:[&>*:nth-child(5)]:hidden"
              onClick={() => props.onOpenRun(row.id)}
            >
              <span class="min-w-0">
                <strong class="block truncate font-medium text-[var(--text-strong)]">
                  {row.label}
                </strong>
                <Show when={row.durationMs !== undefined}>
                  <small class="font-mono text-[9.5px] tabular-nums text-[var(--text-weak)]">
                    {formatDuration(row.durationMs!)}
                  </small>
                </Show>
              </span>
              <span class="flex min-w-0 items-center gap-2 text-[var(--text-base)]">
                <Icon
                  name={row.platform === "browser" ? "server" : "smartphone"}
                  size={13}
                  class="shrink-0 text-[var(--text-weak)]"
                />
                <span class="truncate">{row.target}</span>
              </span>
              <span class="truncate text-[var(--text-base)]">{row.actor}</span>
              <span class={outcomePill(row.outcome)}>{browseOutcomeLabel(row.outcome)}</span>
              <time
                class="font-mono text-[10px] tabular-nums text-[var(--text-weak)]"
                datetime={new Date(row.finishedAt).toISOString()}
              >
                {formatDate(row.finishedAt)}
              </time>
            </button>
          )}
        </For>
        <Show when={props.rows.length > visibleRows().length}>
          <p class="px-4 py-3 text-center text-[10.5px] text-[var(--text-weak)]">
            Showing the newest {visibleRows().length} of {props.rows.length} results. Narrow the
            list with search or filters.
          </p>
        </Show>
      </div>
    </Show>
  );
}

function FilterSelect(props: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label class="relative shrink-0">
      <span class="sr-only">{props.label}</span>
      <select
        class="h-10 min-w-[132px] appearance-none rounded-[9px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)] pr-8 pl-3 text-[16px] font-medium text-[var(--text-base)] outline-none transition-[border-color,background-color] duration-150 hover:border-[var(--v2-border-border-strong)] focus:border-[var(--text-interactive-base)] min-[681px]:text-[11.5px]"
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        <For each={props.options}>{([value, label]) => <option value={value}>{label}</option>}</For>
      </select>
      <Icon
        name="chevron-down"
        size={11}
        class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[var(--text-weak)]"
      />
    </label>
  );
}

function BrowseEmpty(props: {
  icon: "search" | "play" | "clock";
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <section class="grid min-h-56 place-items-center px-6 text-center">
      <div class="grid max-w-[380px] justify-items-center gap-3">
        <span class="grid size-10 place-items-center rounded-[11px] bg-[var(--v2-background-bg-base)] text-[var(--text-interactive-base)] shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
          <Icon name={props.icon} size={17} />
        </span>
        <div>
          <h3 class="text-[16px] font-semibold text-[var(--text-strong)]">{props.title}</h3>
          <p class="mt-1 text-[12px]/[1.5] text-[var(--text-weak)]">{props.body}</p>
        </div>
        <Show when={props.actionLabel && props.onAction}>
          <Button variant="secondary" size="lg" onClick={props.onAction}>
            {props.actionLabel}
          </Button>
        </Show>
      </div>
    </section>
  );
}

function incomingCount(appMap: AppMap, screenId: string): number {
  return Object.values(appMap.connections).filter(
    (connection) =>
      connection.destination.kind === "screen" && connection.destination.screenId === screenId,
  ).length;
}

function outgoingCount(appMap: AppMap, screenId: string): number {
  return Object.values(appMap.connections).filter(
    (connection) => connection.fromScreenId === screenId,
  ).length;
}

function screenTargetNames(appMap: AppMap, screen: Screen): string[] {
  return screen.variantIds.flatMap((id) => {
    const variant = appMap.screenVariants[id];
    return variant ? [variant.targetProfile.name] : [];
  });
}

function screenApprovedTargetCount(appMap: AppMap, screen: Screen): number {
  return screen.variantIds.filter((id) => Boolean(appMap.screenVariants[id]?.baseline)).length;
}

function baselineCoverageLabel(approved: number, total: number): string {
  if (approved <= 0) return "Needs baseline";
  if (approved >= total) return "Approved";
  return `${approved}/${total} approved`;
}

function connectionLabel(appMap: AppMap, connectionId: string): string {
  const connection = appMap.connections[connectionId];
  if (!connection) return "App Map run";
  const from = appMap.screens[connection.fromScreenId]?.title ?? "Screen";
  const to =
    connection.destination.kind === "screen"
      ? (appMap.screens[connection.destination.screenId]?.title ?? "Screen")
      : "End";
  return `${from} → ${to}`;
}

function runOutcome(run: PersistedRun): BrowseRunOutcome {
  if (run.status === "queued" || run.status === "running" || run.status === "paused")
    return "running";
  if (run.outcome) return run.outcome;
  return run.status === "done" || run.status === "passed" ? "passed" : "uncertain";
}

function platformName(platform: "android" | "ios" | "browser"): string {
  return platform === "ios" ? "iOS" : platform === "android" ? "Android" : "Browser";
}

function outcomePill(outcome: BrowseRunOutcome): string {
  return cn(
    "inline-flex min-h-6 w-fit items-center rounded-md px-2 text-[9.5px] font-semibold ring-1 ring-inset",
    outcome === "passed"
      ? "bg-surface-success-weak text-text-success-base ring-border-success-base/40"
      : outcome === "product-failure"
        ? "bg-surface-critical-weak text-text-critical-base ring-border-critical-base/40"
        : outcome === "harness-failure" || outcome === "uncertain"
          ? "bg-surface-warning-weak text-text-warning-base ring-border-warning-base/40"
          : "bg-surface-raised-strong text-text-base ring-border-weak-base",
  );
}

function statePill(state: ScreenState): string {
  return cn(
    "inline-flex min-h-5 items-center gap-1 rounded-full bg-[var(--v2-background-bg-base)] px-1.5 text-[8.5px] font-semibold shadow-[0_1px_5px_rgb(0_0_0/16%)]",
    state === "passed"
      ? "text-[var(--icon-success-base)]"
      : state === "failed"
        ? "text-[var(--icon-critical-base)]"
        : state === "healed" || state === "blocked"
          ? "text-[var(--icon-warning-base)]"
          : state === "running"
            ? "text-[var(--text-interactive-base)]"
            : "text-[var(--text-weak)]",
  );
}

function stateLabel(state: ScreenState): string {
  return state === "passed"
    ? "Passed"
    : state === "failed"
      ? "Changed"
      : state === "healed"
        ? "Assisted"
        : state === "blocked"
          ? "Blocked"
          : state === "unknown"
            ? "Unknown"
            : "Running";
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
