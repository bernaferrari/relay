import { For, Show, createMemo, createSignal } from "solid-js";
import { Button } from "@grok-device/ui/button";
import { useServer } from "../context/server";

export function InspectorPanel() {
  const server = useServer();
  const [filter, setFilter] = createSignal("");

  const nodes = createMemo(() => {
    const snap = server.snapshot();
    if (!snap) return [];
    const q = filter().trim().toLowerCase();
    const src = snap.nodes;
    if (!q) return src.slice(0, 200);
    return src
      .filter((n) => {
        const blob =
          `${n.label ?? ""} ${n.value ?? ""} ${n.identifier ?? ""} ${n.ref ?? ""}`.toLowerCase();
        return blob.includes(q);
      })
      .slice(0, 200);
  });

  return (
    <div class="workspace-panel">
      <div class="workspace-toolbar">
        <div class="workspace-toolbar__left">
          <h2 class="app-panel__title" style={{ margin: 0 }}>
            UI inspector
          </h2>
          <Show when={server.snapshot()}>
            <span class="header-chip">{server.snapshot()!.nodes.length} nodes</span>
          </Show>
        </div>
        <div class="workspace-toolbar__right">
          <input
            class="field-input"
            placeholder="Filter nodes…"
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
          />
          <Button
            variant="primary"
            size="sm"
            disabled={server.busyCapture() || server.health() !== "online"}
            onClick={() => void server.captureUiSnapshot()}
          >
            {server.busyCapture() ? "…" : "Snapshot"}
          </Button>
        </div>
      </div>

      <Show
        when={server.snapshot()}
        fallback={
          <div class="empty empty--large">
            Capture a UI snapshot from the selected device to inspect the accessibility tree.
            <div style={{ "margin-top": "0.75rem" }}>
              <Button variant="primary" size="sm" onClick={() => void server.captureUiSnapshot()}>
                Capture snapshot
              </Button>
            </div>
          </div>
        }
      >
        <div class="inspector-list">
          <For each={nodes()}>
            {(n) => {
              const label = () => (n.label ?? n.value ?? n.identifier ?? "(unnamed)").trim();
              return (
                <button
                  type="button"
                  class="inspector-row"
                  disabled={!n.hittable && !n.ref && !n.label && !n.rect}
                  onClick={() => void server.pressNode(n)}
                  title="Click to press this node on device"
                >
                  <span class="inspector-row__hit">{n.hittable ? "●" : "○"}</span>
                  <span class="inspector-row__label">{label()}</span>
                  <span class="inspector-row__meta">
                    {n.ref ? `${n.ref.startsWith("@") ? n.ref : `@${n.ref}`} ` : ""}
                    {n.rect
                      ? `${Math.round(n.rect.x)},${Math.round(n.rect.y)} ${Math.round(n.rect.width)}×${Math.round(n.rect.height)}`
                      : ""}
                  </span>
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
