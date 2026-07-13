import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { DiscoveryControl, DiscoverySession } from "@relay/protocol";
import { useServer } from "../../context/server";
import { toast } from "../../context/toast";
import { cn } from "../../lib/cn";
import { discoveryCanvasLayout, discoveryPathRows } from "../../lib/discovery-presentation";
import { targetIsReady } from "../../lib/target-presentation";
import { modalPanel, modalScrim } from "../../lib/ui";
import { Icon } from "../icon";

export const DISCOVERY_NODE_DIMENSIONS = {
  width: 204,
  height: 252,
} as const;

function discoveryPathTo(session: DiscoverySession, targetScreenId: string | null): string[] {
  if (
    !targetScreenId ||
    session.screens.length === 0 ||
    targetScreenId === session.screens[0]!.id
  ) {
    return [];
  }
  const root = session.screens[0]!.id;
  const queue = [root];
  const previous = new Map<string, string>();
  while (queue.length) {
    const current = queue.shift()!;
    for (const transition of session.transitions) {
      if (
        !transition.changedScreen ||
        transition.fromScreenId !== current ||
        !transition.toScreenId
      )
        continue;
      if (previous.has(transition.toScreenId) || transition.toScreenId === root) continue;
      previous.set(transition.toScreenId, transition.id);
      queue.push(transition.toScreenId);
    }
  }
  const transitions = new Map(session.transitions.map((transition) => [transition.id, transition]));
  const path: string[] = [];
  let cursor = targetScreenId;
  while (cursor !== root) {
    const transitionId = previous.get(cursor);
    const transition = transitionId ? transitions.get(transitionId) : undefined;
    if (!transitionId || !transition?.toScreenId) return [];
    path.unshift(transitionId);
    cursor = transition.fromScreenId;
  }
  return path;
}

export function DiscoveryWorkspace(props: { onOpenRecipe: (id: string) => void }) {
  const server = useServer();
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [selectedScreenId, setSelectedScreenId] = createSignal<string | null>(null);
  const [projection, setProjection] = createSignal<"canvas" | "list">("canvas");
  const [view, setView] = createSignal({ x: 56, y: 56, scale: 0.8 });
  const [suggestion, setSuggestion] = createSignal<{
    screenId: string;
    control: DiscoveryControl;
  } | null>(null);
  const [coverageOpen, setCoverageOpen] = createSignal(false);
  const [actionsOpen, setActionsOpen] = createSignal(false);
  const [autoExploring, setAutoExploring] = createSignal(false);
  const [autoExplored, setAutoExplored] = createSignal(0);
  const [promotionOpen, setPromotionOpen] = createSignal(false);
  const [promotionTitle, setPromotionTitle] = createSignal("");
  const [mapNameDraft, setMapNameDraft] = createSignal("");
  const [promotionLabels, setPromotionLabels] = createSignal<Record<string, string>>({});
  const [coverage, setCoverage] = createSignal<
    import("@relay/protocol").DiscoveryCoverageReport | null
  >(null);
  let stopAutoExploration = false;
  let mapNameDraftForId: string | null = null;
  const selectedTarget = () =>
    server.devices().find((device) => device.serial === server.selectedDevice());
  const targetReady = () => targetIsReady(selectedTarget(), server.health() === "online");
  const active = () =>
    server.discoverySessions().find((session) => session.id === activeId()) ??
    server.discoverySessions()[0] ??
    null;
  const selectedScreen = () =>
    active()?.screens.find((screen) => screen.id === selectedScreenId()) ?? null;
  const availableControls = () => {
    const screen = selectedScreen();
    if (!screen) return [];
    const used = new Set(
      active()
        ?.transitions.filter(
          (transition) => transition.fromScreenId === screen.id && transition.target,
        )
        .map((transition) => JSON.stringify(transition.target)) ?? [],
    );
    return (screen.controls ?? []).filter((control) => !used.has(JSON.stringify(control.target)));
  };
  const remainingControls = () => {
    const suggested = suggestion()?.control;
    if (!suggested) return availableControls();
    const suggestedTarget = JSON.stringify(suggested.target);
    return availableControls().filter(
      (control) => JSON.stringify(control.target) !== suggestedTarget,
    );
  };

  createEffect(() => {
    if (!activeId() && server.discoverySessions()[0])
      setActiveId(server.discoverySessions()[0]!.id);
  });

  createEffect(() => {
    const session = active();
    if (!session) return;
    if (!session.screens.some((screen) => screen.id === selectedScreenId())) {
      setSelectedScreenId(null);
    }
  });

  createEffect(() => {
    if (!selectedScreenId()) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedScreenId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    onCleanup(() => window.removeEventListener("keydown", closeOnEscape));
  });

  createEffect(() => {
    if (server.activeDiscoverySessionId()) setActiveId(server.activeDiscoverySessionId());
  });

  // Restoring a running map from disk should make it the explicit recorder
  // destination. Paused/stopped maps stay inspectable without hijacking
  // ordinary device interactions from another workspace.
  createEffect(() => {
    const session = active();
    if (session?.status === "running" && !server.activeDiscoverySessionId()) {
      server.setActiveDiscoverySessionId(session.id);
    }
  });

  createEffect(() => {
    const session = active();
    if (!session || session.status !== "running") {
      setSuggestion(null);
      return;
    }
    void server
      .discoverySuggestion(session.id)
      .then(setSuggestion)
      .catch(() => setSuggestion(null));
  });

  createEffect(() => {
    const session = active();
    if (session && mapNameDraftForId !== session.id) {
      mapNameDraftForId = session.id;
      setMapNameDraft(session.name);
    }
  });

  async function start(): Promise<void> {
    const targetId = selectedTarget();
    if (!targetId || !targetReady()) {
      toast("Connect or start the selected target before mapping.", "warning");
      return;
    }
    const session = await server.createDiscoverySession({
      name: `Map · ${targetId.name}`,
      targetId: targetId.serial,
    });
    await server.setDiscoveryStatus(session.id, "running");
    await server
      .captureDiscoveryScreen(session.id)
      .catch((error: unknown) =>
        toast(error instanceof Error ? error.message : String(error), "warning"),
      );
    server.setActiveDiscoverySessionId(session.id);
    setActiveId(session.id);
  }

  async function rename(session: DiscoverySession, nextName: string): Promise<void> {
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === session.name) return;
    try {
      await server.renameDiscoverySession(session.id, trimmed);
      setMapNameDraft(trimmed);
      toast("Map renamed", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  }

  function reviewPromotion(session: DiscoverySession): void {
    const transitionIds = discoveryPathTo(session, selectedScreenId());
    if (transitionIds.length === 0) {
      toast("Select a reached screen to turn its path into a test.", "warning");
      return;
    }
    setPromotionTitle(`${session.name} path`);
    setPromotionLabels(
      Object.fromEntries(
        transitionIds.map((id) => {
          const transition = session.transitions.find((item) => item.id === id);
          return [id, transition?.label ?? transition?.kind ?? "Continue"];
        }),
      ),
    );
    setPromotionOpen(true);
  }

  async function promote(session: DiscoverySession): Promise<void> {
    const transitionIds = discoveryPathTo(session, selectedScreenId());
    const title = promotionTitle();
    if (!title?.trim()) return;
    const recipeId = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96);
    if (!recipeId) return;
    try {
      const result = await server.promoteDiscoveryPath({
        sessionId: session.id,
        transitionIds,
        recipeId,
        title,
        transitionLabels: promotionLabels(),
      });
      setPromotionOpen(false);
      if (result.warnings.length) toast("Test created with review pauses", "warning");
      else toast("Editable YAML test created", "success");
      props.onOpenRecipe(result.recipe.id);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function explore(control: DiscoveryControl): Promise<void> {
    const session = active();
    if (!session) return;
    try {
      await server.approveDiscoverySuggestion({ sessionId: session.id, control });
      await server.refreshDiscoverySessions();
      const fresh = server.discoverySessions().find((item) => item.id === session.id);
      const before = new Set(session.screens.map((screen) => screen.id));
      const reached = fresh?.screens.find((screen) => !before.has(screen.id));
      if (reached) setSelectedScreenId(reached.id);
      setSuggestion(await server.discoverySuggestion(session.id));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function exploreAutomatically(sessionId: string): Promise<void> {
    if (autoExploring()) return;
    const current = server.discoverySessions().find((item) => item.id === sessionId);
    if (!current || current.status !== "running") return;
    stopAutoExploration = false;
    setAutoExplored(0);
    setAutoExploring(true);
    try {
      for (let index = 0; index < current.scope.maxTransitions; index += 1) {
        if (stopAutoExploration) break;
        const latest = server.discoverySessions().find((item) => item.id === sessionId);
        if (!latest || latest.status !== "running") break;
        const next = await server.discoverySuggestion(sessionId);
        if (!next) {
          const rootId = latest.screens[0]?.id;
          if (!rootId || !latest.currentScreenId || latest.currentScreenId === rootId) break;
          const changed = await server.backtrackDiscovery(sessionId);
          if (!changed) break;
          const returned = server.discoverySessions().find((item) => item.id === sessionId);
          if (returned?.currentScreenId) setSelectedScreenId(returned.currentScreenId);
          setAutoExplored(index + 1);
          continue;
        }
        const before = new Set(latest.screens.map((screen) => screen.id));
        await server.approveDiscoverySuggestion({ sessionId, control: next.control });
        const fresh = server.discoverySessions().find((item) => item.id === sessionId);
        if (!fresh) break;
        const reached = fresh.screens.find((screen) => !before.has(screen.id));
        if (reached) setSelectedScreenId(reached.id);
        setAutoExplored(index + 1);
      }
      if (!stopAutoExploration) {
        const count = autoExplored();
        toast(
          count > 0 ? `Explored ${count} safe paths` : "No new safe paths found",
          count > 0 ? "success" : "warning",
        );
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setAutoExploring(false);
      stopAutoExploration = false;
    }
  }

  function stopAutomaticExploration(): void {
    stopAutoExploration = true;
  }

  async function toggleCoverage(): Promise<void> {
    const session = active();
    if (!session) return;
    const next = !coverageOpen();
    setCoverageOpen(next);
    if (!next) return;
    try {
      setCoverage(await server.loadDiscoveryCoverage(session.id));
    } catch (error) {
      setCoverage(null);
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  }

  return (
    <div class={cn("relay-discovery", active() && selectedScreen() && "has-inspector")}>
      <aside class="relay-discovery__sessions" aria-label="Discovery sessions">
        <div>
          <span class="relay-eyebrow">Product map</span>
          <h3>Observed screens</h3>
          <p>Drive the app yourself or let Relay safely discover reachable screens and branches.</p>
        </div>
        <div class="relay-discovery__target" aria-live="polite">
          <Icon
            name={selectedTarget()?.platform === "browser" ? "server" : "smartphone"}
            size={14}
          />
          <span>{selectedTarget()?.name ?? "No target selected"}</span>
          <small>
            {targetReady()
              ? "Ready"
              : server.health() !== "online"
                ? "Start the device server"
                : "Unavailable"}
          </small>
        </div>
        <button
          type="button"
          class="relay-primary"
          disabled={!targetReady()}
          onClick={() => void start()}
        >
          <Icon name="plus" size={14} /> Start mapping
        </button>
        <div class="relay-discovery__session-list">
          <For
            each={server.discoverySessions()}
            fallback={<small class="relay-discovery__session-empty">No saved maps yet.</small>}
          >
            {(session) => (
              <button
                type="button"
                class={cn(active()?.id === session.id && "is-active")}
                aria-current={active()?.id === session.id ? "true" : undefined}
                aria-label={`Open map ${session.name}, ${session.screens.length} screens, ${session.status}`}
                onClick={() => {
                  setActiveId(session.id);
                  server.setActiveDiscoverySessionId(
                    session.status === "running" ? session.id : null,
                  );
                }}
              >
                <strong>{session.name}</strong>
                <small>
                  {session.status} · {session.screens.length} screens
                </small>
              </button>
            )}
          </For>
        </div>
        <Show when={coverageOpen()}>
          <DiscoveryCoveragePanel coverage={coverage()} />
        </Show>
      </aside>
      <main class="relay-discovery__canvas">
        <Show
          when={active()}
          fallback={
            <div class="relay-discovery__empty">
              <Icon name="move" size={22} />
              <span class="relay-eyebrow">Product map</span>
              <strong>See the path as you record it</strong>
              <p>
                Start a guided map or let Relay explore safe paths. Every observed screen becomes
                evidence, even when the app takes a different path next time.
              </p>
            </div>
          }
        >
          {(session) => (
            <>
              <header>
                <div>
                  <span class="relay-eyebrow">
                    {session().status === "running"
                      ? "Mapping"
                      : session().status === "complete"
                        ? "Complete"
                        : session().status === "stopped"
                          ? "Stopped"
                          : "Map"}
                  </span>
                  <input
                    aria-label="Map name"
                    class="relay-discovery__title-input"
                    value={mapNameDraft()}
                    onInput={(event) => setMapNameDraft(event.currentTarget.value)}
                    onChange={() => void rename(session(), mapNameDraft())}
                  />
                  <p>
                    {session().screens.length} screens · {session().transitions.length} paths
                  </p>
                </div>
                <div>
                  <div class="relay-discovery__view-switch" role="group" aria-label="Map view">
                    <button
                      type="button"
                      class={cn(projection() === "canvas" && "is-active")}
                      aria-pressed={projection() === "canvas"}
                      onClick={() => setProjection("canvas")}
                    >
                      Canvas
                    </button>
                    <button
                      type="button"
                      class={cn(projection() === "list" && "is-active")}
                      aria-pressed={projection() === "list"}
                      onClick={() => setProjection("list")}
                    >
                      Path list
                    </button>
                  </div>
                  <button
                    type="button"
                    class="relay-primary"
                    disabled={session().status !== "running"}
                    onClick={() => void server.captureDiscoveryScreen(session().id)}
                  >
                    <Icon name="camera" size={14} /> Capture screen
                  </button>
                  <button
                    type="button"
                    class="relay-icon-button"
                    aria-label="More map actions"
                    aria-expanded={actionsOpen()}
                    onClick={() => setActionsOpen((open) => !open)}
                  >
                    <Icon name="more" size={15} />
                  </button>
                  <Show when={actionsOpen()}>
                    <div class="relay-discovery__actions-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => void toggleCoverage()}>
                        <Icon name="grid" size={14} />
                        {coverageOpen() ? "Hide coverage" : "Show coverage"}
                      </button>
                      <Show when={session().status === "running" || session().status === "paused"}>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            void server.setDiscoveryStatus(
                              session().id,
                              session().status === "running" ? "paused" : "running",
                            );
                            setActionsOpen(false);
                          }}
                        >
                          <Icon
                            name={session().status === "running" ? "pause" : "play"}
                            size={13}
                          />
                          {session().status === "running" ? "Pause mapping" : "Resume mapping"}
                        </button>
                      </Show>
                      <button
                        type="button"
                        role="menuitem"
                        class="is-danger"
                        disabled={session().status !== "running"}
                        onClick={() => {
                          void server.setDiscoveryStatus(session().id, "stopped");
                          setActionsOpen(false);
                        }}
                      >
                        <Icon name="square" size={13} /> Stop mapping
                      </button>
                    </div>
                  </Show>
                </div>
              </header>
              <Show
                when={projection() === "canvas"}
                fallback={
                  <DiscoveryPathList
                    session={session()}
                    selectedScreenId={selectedScreenId()}
                    onSelectScreen={setSelectedScreenId}
                  />
                }
              >
                <DiscoveryCanvas
                  session={session()}
                  view={view()}
                  selectedScreenId={selectedScreenId()}
                  onSelectScreen={setSelectedScreenId}
                  onView={setView}
                />
              </Show>
            </>
          )}
        </Show>
      </main>
      <Show when={active() && selectedScreen()}>
        <button
          type="button"
          class="relay-discovery__inspector-dismiss"
          aria-label="Close selected screen"
          onClick={() => setSelectedScreenId(null)}
        />
        <aside class="relay-discovery__inspector" aria-label="Selected screen details">
          <div class="relay-discovery__screen-preview">
            <Show
              when={selectedScreen()!.screenshotPath}
              fallback={<Icon name="smartphone" size={24} />}
            >
              <img
                src={server.discoveryScreenUrl(active()!.id, selectedScreen()!.id)}
                alt={`Captured ${selectedScreen()!.title ?? "screen"}`}
              />
            </Show>
          </div>
          <header>
            <div>
              <span class="relay-eyebrow">Selected screen</span>
              <button
                type="button"
                class="relay-icon-button"
                aria-label="Close selected screen"
                onClick={() => setSelectedScreenId(null)}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
            <strong>{selectedScreen()!.title ?? "Observed screen"}</strong>
            <small>
              {selectedScreen()!.controls?.length ?? 0} available action
              {(selectedScreen()!.controls?.length ?? 0) === 1 ? "" : "s"}
            </small>
          </header>
          <button
            type="button"
            class="relay-primary relay-discovery__create-test"
            disabled={discoveryPathTo(active()!, selectedScreenId()).length === 0}
            onClick={() => reviewPromotion(active()!)}
          >
            <Icon name="pointer" size={14} /> Create test from this path
          </button>
          <Show when={active()!.status === "running"}>
            <button
              type="button"
              class="relay-secondary relay-discovery__auto"
              onClick={() =>
                autoExploring()
                  ? stopAutomaticExploration()
                  : void exploreAutomatically(active()!.id)
              }
            >
              <Icon name={autoExploring() ? "square" : "scan"} size={13} />
              {autoExploring() ? `Stop exploring (${autoExplored()})` : "Explore automatically"}
            </button>
          </Show>
          <div class="relay-discovery__next-actions">
            <span class="relay-eyebrow">Continue from here</span>
            <Show when={suggestion()}>
              {(next) => (
                <button
                  type="button"
                  class="is-suggested"
                  disabled={active()!.status !== "running"}
                  onClick={() => void explore(next().control)}
                >
                  <span>
                    <strong>{next().control.label}</strong>
                    <small>Suggested next action</small>
                  </span>
                  <Icon name="arrow-right" size={14} />
                </button>
              )}
            </Show>
            <For each={remainingControls().slice(0, 5)}>
              {(control) => (
                <button
                  type="button"
                  disabled={active()!.status !== "running"}
                  onClick={() => void explore(control)}
                >
                  <span>
                    <strong>{control.label}</strong>
                    <small>Open this branch</small>
                  </span>
                  <Icon name="chevron-right" size={14} />
                </button>
              )}
            </For>
            <Show when={remainingControls().length === 0 && !suggestion()}>
              <small class="relay-discovery__mapped">
                Every safe action here is already mapped.
              </small>
            </Show>
          </div>
        </aside>
      </Show>
      <Show when={promotionOpen() && active()}>
        {(session) => {
          const transitionIds = () => discoveryPathTo(session(), selectedScreenId());
          const transitions = () =>
            transitionIds()
              .map((id) => session().transitions.find((item) => item.id === id))
              .filter((item): item is NonNullable<typeof item> => Boolean(item));
          const screenTitle = (id: string | undefined) =>
            session().screens.find((screen) => screen.id === id)?.title ?? "Observed screen";
          return (
            <div class={cn(modalScrim, "z-[120] flex items-center justify-center p-5")}>
              <section
                class={cn(modalPanel, "relay-discovery-review")}
                role="dialog"
                aria-modal="true"
                aria-labelledby="discovery-review-title"
              >
                <header>
                  <div>
                    <span class="relay-eyebrow">Create editable test</span>
                    <h3 id="discovery-review-title">Review this path</h3>
                  </div>
                  <button
                    type="button"
                    class="relay-icon-button"
                    aria-label="Close path review"
                    onClick={() => setPromotionOpen(false)}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </header>
                <label>
                  <span>Test name</span>
                  <input
                    value={promotionTitle()}
                    autofocus
                    onInput={(event) => setPromotionTitle(event.currentTarget.value)}
                  />
                </label>
                <ol>
                  <For each={transitions()}>
                    {(transition, index) => (
                      <li>
                        <span>{index() + 1}</span>
                        <div>
                          <small>
                            {screenTitle(transition.fromScreenId)} →{" "}
                            {screenTitle(transition.toScreenId)}
                          </small>
                          <input
                            aria-label={`Action ${index() + 1} label`}
                            value={promotionLabels()[transition.id] ?? ""}
                            onInput={(event) =>
                              setPromotionLabels((labels) => ({
                                ...labels,
                                [transition.id]: event.currentTarget.value,
                              }))
                            }
                          />
                        </div>
                      </li>
                    )}
                  </For>
                </ol>
                <footer>
                  <p>Names change the editable test only. Captured evidence stays untouched.</p>
                  <div>
                    <button
                      type="button"
                      class="relay-secondary"
                      onClick={() => setPromotionOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      class="relay-primary"
                      disabled={!promotionTitle().trim() || transitions().length === 0}
                      onClick={() => void promote(session())}
                    >
                      Create test
                    </button>
                  </div>
                </footer>
              </section>
            </div>
          );
        }}
      </Show>
    </div>
  );
}

function DiscoveryPathList(props: {
  session: DiscoverySession;
  selectedScreenId: string | null;
  onSelectScreen: (id: string) => void;
}) {
  const server = useServer();
  const rows = () => discoveryPathRows(props.session);
  return (
    <section class="relay-discovery-list" aria-label="Observed screens and paths">
      <header>
        <div>
          <span class="relay-eyebrow">Accessible map</span>
          <strong>Observed paths</strong>
        </div>
        <small>Ordered from the first captured screen</small>
      </header>
      <ol>
        <For
          each={rows()}
          fallback={<li class="relay-discovery-list__empty">Capture a screen to begin.</li>}
        >
          {(row, index) => (
            <li>
              <button
                type="button"
                class={cn(
                  row.screen.id === props.selectedScreenId && "is-selected",
                  !row.reachable && "is-unlinked",
                )}
                aria-current={row.screen.id === props.selectedScreenId ? "true" : undefined}
                aria-label={`Select ${row.screen.title ?? `screen ${index() + 1}`}, ${
                  row.reachable ? `${row.depth} steps from start` : "unlinked"
                }`}
                onClick={() => props.onSelectScreen(row.screen.id)}
              >
                <span class="relay-discovery-list__index">
                  {String(index() + 1).padStart(2, "0")}
                </span>
                <span class="relay-discovery-list__shot">
                  <Show
                    when={row.screen.screenshotPath}
                    fallback={<Icon name="smartphone" size={18} />}
                  >
                    <img src={server.discoveryScreenUrl(props.session.id, row.screen.id)} alt="" />
                  </Show>
                </span>
                <span class="relay-discovery-list__copy">
                  <small>
                    {row.incoming
                      ? `Via ${row.incoming.label ?? row.incoming.kind}`
                      : row.reachable
                        ? "Starting screen"
                        : "Unlinked capture"}
                  </small>
                  <strong>{row.screen.title ?? "Observed screen"}</strong>
                  <span>
                    {row.depth > 0 ? `${row.depth} ${row.depth === 1 ? "step" : "steps"}` : "Start"}
                    {" · "}
                    {row.screen.controls?.length ?? 0} available actions
                  </span>
                </span>
                <Icon name="chevron-right" size={14} />
              </button>
            </li>
          )}
        </For>
      </ol>
    </section>
  );
}

function DiscoveryCoveragePanel(props: {
  coverage: import("@relay/protocol").DiscoveryCoverageReport | null;
}) {
  return (
    <section class="relay-discovery__coverage" aria-live="polite">
      <Show when={props.coverage} fallback={<p>Loading map coverage…</p>}>
        {(report) => (
          <>
            <header>
              <span class="relay-eyebrow">Across profiles</span>
              <strong>
                {report().profiles.length || "No"} observed target
                {report().profiles.length === 1 ? "" : "s"}
              </strong>
            </header>
            <div class="relay-discovery__profile-chips">
              <For each={report().profiles}>{(profile) => <span>{profile.name}</span>}</For>
            </div>
            <DiscoveryCoverageList
              title="Screens"
              items={report().screens}
              total={report().profiles.length}
            />
            <DiscoveryCoverageList
              title="Paths"
              items={report().transitions}
              total={report().profiles.length}
            />
            <Show when={report().unprofiledSessionIds.length > 0}>
              <small>
                {report().unprofiledSessionIds.length} legacy capture
                {report().unprofiledSessionIds.length === 1 ? " is" : "s are"} excluded from the
                comparison.
              </small>
            </Show>
          </>
        )}
      </Show>
    </section>
  );
}

function DiscoveryCoverageList(props: {
  title: string;
  items: import("@relay/protocol").DiscoveryCoverageItem[];
  total: number;
}) {
  return (
    <div class="relay-discovery__coverage-list">
      <strong>{props.title}</strong>
      <For
        each={props.items.slice(0, 5)}
        fallback={<small>No observed {props.title.toLowerCase()} yet.</small>}
      >
        {(item) => (
          <div class={cn(item.missingProfileIds.length === 0 && "is-complete")}>
            <span>{item.label}</span>
            <b>
              {item.observedProfileIds.length}/{props.total || 0}
            </b>
          </div>
        )}
      </For>
      <Show when={props.items.length > 5}>
        <small>+{props.items.length - 5} more</small>
      </Show>
    </div>
  );
}

function DiscoveryCanvas(props: {
  session: DiscoverySession;
  view: { x: number; y: number; scale: number };
  selectedScreenId: string | null;
  onSelectScreen: (id: string) => void;
  onView: (view: { x: number; y: number; scale: number }) => void;
}) {
  const server = useServer();
  let canvas: HTMLElement | undefined;
  let drag: { x: number; y: number; view: { x: number; y: number; scale: number } } | null = null;
  const layout = () =>
    discoveryCanvasLayout(props.session, {
      width: DISCOVERY_NODE_DIMENSIONS.width,
      height: DISCOVERY_NODE_DIMENSIONS.height,
      columnGap: 56,
      rowGap: 44,
    });
  const extent = () => {
    const positions = Object.values(layout());
    return {
      width:
        Math.max(
          620,
          ...positions.map((position) => position.x + DISCOVERY_NODE_DIMENSIONS.width + 12),
        ) + 100,
      height:
        Math.max(
          430,
          ...positions.map((position) => position.y + DISCOVERY_NODE_DIMENSIONS.height),
        ) + 100,
    };
  };
  function zoom(delta: number, clientPoint?: { x: number; y: number }): void {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const origin = clientPoint ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const localX = origin.x - rect.left;
    const localY = origin.y - rect.top;
    const nextScale = Math.max(0.42, Math.min(1.16, props.view.scale + delta));
    const worldX = (localX - props.view.x) / props.view.scale;
    const worldY = (localY - props.view.y) / props.view.scale;
    props.onView({
      x: localX - worldX * nextScale,
      y: localY - worldY * nextScale,
      scale: nextScale,
    });
  }
  function fit(): void {
    if (!canvas) return;
    const positions = Object.values(layout());
    if (positions.length === 0) {
      props.onView({ x: 48, y: 48, scale: 0.8 });
      return;
    }
    const minX = Math.min(...positions.map((position) => position.x));
    const minY = Math.min(...positions.map((position) => position.y));
    const maxX = Math.max(
      ...positions.map((position) => position.x + DISCOVERY_NODE_DIMENSIONS.width),
    );
    const maxY = Math.max(
      ...positions.map((position) => position.y + DISCOVERY_NODE_DIMENSIONS.height),
    );
    const padding = 48;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const scale = Math.max(
      0.42,
      Math.min(
        1.16,
        (canvas.clientWidth - padding * 2) / width,
        (canvas.clientHeight - padding * 2) / height,
      ),
    );
    props.onView({
      x: (canvas.clientWidth - width * scale) / 2 - minX * scale,
      y: (canvas.clientHeight - height * scale) / 2 - minY * scale,
      scale,
    });
  }
  return (
    <section
      ref={(element) => {
        canvas = element;
      }}
      class="relay-discovery-canvas"
      aria-label="Observed screen map"
      style={{
        "--relay-discovery-node-width": `${DISCOVERY_NODE_DIMENSIONS.width}px`,
        "--relay-discovery-node-height": `${DISCOVERY_NODE_DIMENSIONS.height}px`,
      }}
      onWheel={(event) => {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          zoom(event.deltaY > 0 ? -0.08 : 0.08, { x: event.clientX, y: event.clientY });
          return;
        }
        props.onView({
          ...props.view,
          x: props.view.x - event.deltaX,
          y: props.view.y - event.deltaY,
        });
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        drag = { x: event.clientX, y: event.clientY, view: props.view };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag) return;
        props.onView({
          ...props.view,
          x: drag.view.x + event.clientX - drag.x,
          y: drag.view.y + event.clientY - drag.y,
        });
      }}
      onPointerUp={() => {
        drag = null;
      }}
    >
      <div class="relay-discovery-canvas__controls">
        <button type="button" aria-label="Zoom out" onClick={() => zoom(-0.1)}>
          −
        </button>
        <span>{Math.round(props.view.scale * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => zoom(0.1)}>
          +
        </button>
        <button type="button" onClick={fit}>
          Fit
        </button>
      </div>
      <Show
        when={props.session.screens.length > 0}
        fallback={
          <div class="relay-discovery__empty">Capture a screen to begin the evidence map.</div>
        }
      >
        <div
          class="relay-discovery-canvas__world"
          style={{
            transform: `translate3d(${props.view.x}px, ${props.view.y}px, 0) scale(${props.view.scale})`,
            width: `${extent().width}px`,
            height: `${extent().height}px`,
          }}
        >
          <svg aria-hidden="true" viewBox={`0 0 ${extent().width} ${extent().height}`}>
            <defs>
              <marker
                id={`discovery-arrow-${props.session.id}`}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            <For each={props.session.transitions.filter((transition) => transition.changedScreen)}>
              {(transition, index) => {
                const from = () => layout()[transition.fromScreenId];
                const to = () =>
                  transition.toScreenId ? layout()[transition.toScreenId] : undefined;
                const edge = () => {
                  const start = from()!;
                  const end = to()!;
                  const forward = end.x >= start.x;
                  const startX = start.x + (forward ? DISCOVERY_NODE_DIMENSIONS.width : 0);
                  const endX = end.x + (forward ? 0 : DISCOVERY_NODE_DIMENSIONS.width);
                  const startY = start.y + DISCOVERY_NODE_DIMENSIONS.height / 2;
                  const endY = end.y + DISCOVERY_NODE_DIMENSIONS.height / 2;
                  const bend = Math.max(56, Math.abs(endX - startX) * 0.42);
                  const direction = forward ? 1 : -1;
                  return {
                    d: `M ${startX} ${startY} C ${startX + direction * bend} ${startY}, ${endX - direction * bend} ${endY}, ${endX} ${endY}`,
                    labelX: (startX + endX) / 2,
                    labelY: (startY + endY) / 2 - 10 - (index() % 2) * 16,
                  };
                };
                return (
                  <Show when={from() && to()}>
                    <path marker-end={`url(#discovery-arrow-${props.session.id})`} d={edge().d} />
                    <g transform={`translate(${edge().labelX} ${edge().labelY})`}>
                      <rect
                        width={Math.min(
                          164,
                          Math.max(48, (transition.label ?? transition.kind).length * 7 + 16),
                        )}
                        height="20"
                        x={
                          -Math.min(
                            164,
                            Math.max(48, (transition.label ?? transition.kind).length * 7 + 16),
                          ) / 2
                        }
                        y="-14"
                        rx="6"
                      />
                      <text y="0">{transition.label ?? transition.kind}</text>
                    </g>
                  </Show>
                );
              }}
            </For>
          </svg>
          <For each={props.session.screens}>
            {(screen, index) => {
              const position = () => layout()[screen.id]!;
              return (
                <button
                  type="button"
                  class={cn(
                    "relay-discovery-screen",
                    props.selectedScreenId === screen.id && "is-selected",
                    !position().reachable && "is-unlinked",
                  )}
                  aria-pressed={props.selectedScreenId === screen.id}
                  aria-label={`Select screen ${index() + 1}: ${
                    screen.title ?? "Observed screen"
                  }, ${screen.controls?.length ?? 0} safe controls`}
                  style={{ transform: `translate3d(${position().x}px, ${position().y}px, 0)` }}
                  onClick={() => props.onSelectScreen(screen.id)}
                >
                  <span>{String(index() + 1).padStart(2, "0")}</span>
                  <div class="relay-discovery-screen__shot">
                    <Show
                      when={screen.screenshotPath}
                      fallback={<Icon name="smartphone" size={24} />}
                    >
                      <img
                        src={server.discoveryScreenUrl(props.session.id, screen.id)}
                        alt={`Evidence screenshot for ${screen.title ?? `screen ${index() + 1}`}`}
                      />
                    </Show>
                  </div>
                  <strong>{screen.title ?? "Observed screen"}</strong>
                  <small>
                    {screen.controls?.length ?? 0} available actions ·{" "}
                    {new Date(screen.capturedAt).toLocaleTimeString()}
                  </small>
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </section>
  );
}
