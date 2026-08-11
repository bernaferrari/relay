import { For, Show, createMemo } from "solid-js";
import type { MapGroup } from "@relay/protocol";
import { cn } from "../lib/cn";
import { mapGroupGeometry } from "../lib/app-map-groups";
import { selectedScreensRect } from "../lib/app-map-selection";
import type { CanvasPoint, ScreenCardGeometry } from "../lib/app-map-canvas-layout";
import { Icon } from "./icon";

export function AppMapGroupsLayer(props: {
  groups: readonly MapGroup[];
  positions: Readonly<Record<string, CanvasPoint>>;
  geometries?: Readonly<Record<string, ScreenCardGeometry>>;
  selectedGroupId: string | null;
  renamingGroupId: string | null;
  selectedScreenIds: ReadonlySet<string>;
  viewportScale: number;
  onSelectGroup: (group: MapGroup) => void;
  onGroupPointerDown: (
    event: PointerEvent & { currentTarget: HTMLElement },
    group: MapGroup,
  ) => void;
  onGroupContextMenu: (event: MouseEvent, group: MapGroup) => void;
  onRenameGroup: (group: MapGroup) => void;
  onCommitGroupRename: (group: MapGroup, name: string) => void;
  onUngroup: (group: MapGroup) => void;
  onGroupSelection: () => void;
}) {
  const selectionGeometry = createMemo(() =>
    selectedScreensRect([...props.selectedScreenIds], props.positions, props.geometries),
  );
  const selectedGroup = createMemo(
    () => props.groups.find((group) => group.id === props.selectedGroupId) ?? null,
  );
  const selectedGroupGeometry = createMemo(() => {
    const group = selectedGroup();
    return group ? mapGroupGeometry(group, props.positions) : null;
  });

  return (
    <>
      <For each={props.groups}>
        {(group) => {
          const geometry = () => mapGroupGeometry(group, props.positions);
          const selected = () => props.selectedGroupId === group.id;
          return (
            <Show when={geometry()}>
              {(bounds) => (
                <section
                  role="group"
                  aria-label={`Group named ${group.name}, ${group.screenIds.length} ${group.screenIds.length === 1 ? "screen" : "screens"}`}
                  tabIndex={0}
                  data-app-map-group-id={group.id}
                  data-tip="Click to inspect group"
                  class={cn(
                    "group/map-group absolute z-0 rounded-[14px] bg-[color-mix(in_srgb,var(--product-accent-soft)_11%,transparent)] outline outline-1 outline-[color-mix(in_srgb,var(--border-strong-base)_34%,transparent)] transition-[background-color,outline-color,box-shadow] duration-150 hover:bg-[color-mix(in_srgb,var(--product-accent-soft)_15%,transparent)] hover:outline-[color-mix(in_srgb,var(--border-strong-base)_52%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--product-accent-soft)_15%,transparent)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]",
                    selected() &&
                      "bg-[color-mix(in_srgb,var(--product-accent-soft)_18%,transparent)] outline-2 outline-[var(--text-interactive-base)]",
                  )}
                  style={{
                    transform: `translate3d(${bounds().left}px, ${bounds().top}px, 0)`,
                    width: `${bounds().width}px`,
                    height: `${bounds().height}px`,
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onSelectGroup(group);
                  }}
                  onDblClick={(event) => {
                    event.stopPropagation();
                    props.onRenameGroup(group);
                  }}
                  onContextMenu={(event) => props.onGroupContextMenu(event, group)}
                  onPointerDown={(event) => {
                    if ((event.target as HTMLElement).closest("button, input")) return;
                    props.onGroupPointerDown(event, group);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "F2") {
                      event.preventDefault();
                      props.onRenameGroup(group);
                    }
                  }}
                >
                  <header
                    class={cn(
                      "absolute top-2.5 left-3 flex h-7 max-w-[calc(100%-24px)] items-center justify-center gap-1.5 rounded-[7px] bg-[color-mix(in_srgb,var(--map-control-surface)_94%,transparent)] px-2 outline outline-1 outline-[color-mix(in_srgb,var(--border-strong-base)_30%,transparent)] backdrop-blur-[8px] transition-[background-color,outline-color] duration-150 hover:bg-[var(--surface-base-hover)] hover:outline-[color-mix(in_srgb,var(--border-strong-base)_46%,transparent)]",
                      selected() &&
                        "bg-[var(--product-accent-soft)] opacity-100 outline-[color-mix(in_srgb,var(--text-interactive-base)_42%,transparent)]",
                    )}
                  >
                    <Icon name="group" size={13} class="shrink-0 text-[var(--text-weak)]" />
                    <Show
                      when={props.renamingGroupId === group.id}
                      fallback={
                        <strong class="truncate text-[12px] font-semibold tracking-[-0.01em] text-[var(--text-base)]">
                          {group.name}
                        </strong>
                      }
                    >
                      <input
                        class="h-7 min-w-24 max-w-60 rounded-[6px] bg-[var(--map-control-surface)] px-2 text-[12px] font-semibold text-[var(--text-strong)] outline-none ring-2 ring-[var(--text-interactive-base)]"
                        aria-label="Group name"
                        value={group.name}
                        autofocus
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onBlur={(event) =>
                          props.onCommitGroupRename(group, event.currentTarget.value)
                        }
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") {
                            event.preventDefault();
                            props.onCommitGroupRename(group, group.name);
                          }
                        }}
                      />
                    </Show>
                  </header>
                </section>
              )}
            </Show>
          );
        }}
      </For>

      <Show when={props.selectedScreenIds.size > 1 && selectionGeometry()}>
        {(bounds) => (
          <div
            class="pointer-events-none absolute z-[18] rounded-[9px] border border-[var(--text-interactive-base)]"
            data-app-map-selection-bounds
            aria-hidden="true"
            style={{
              transform: `translate3d(${bounds().left}px, ${bounds().top}px, 0)`,
              width: `${bounds().width}px`,
              height: `${bounds().height}px`,
              "border-width": `${1 / props.viewportScale}px`,
            }}
          />
        )}
      </Show>

      <Show
        when={
          selectedGroup() &&
          selectedGroupGeometry() &&
          props.renamingGroupId !== selectedGroup()!.id
        }
      >
        <div
          class="absolute z-30 flex min-h-10 flex-col items-stretch gap-1 rounded-[11px] bg-[var(--map-control-surface)] p-1 shadow-[var(--map-elevation-panel)]"
          style={{
            left: `${selectedGroupGeometry()!.left + selectedGroupGeometry()!.width + 12}px`,
            top: `${selectedGroupGeometry()!.top + 30}px`,
          }}
        >
          <button
            type="button"
            class="app-map-icon-button"
            data-tip="Rename Group · F2"
            aria-label={`Rename ${selectedGroup()!.name}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              props.onRenameGroup(selectedGroup()!);
            }}
          >
            <Icon name="edit" size={13} />
          </button>
          <button
            type="button"
            class="app-map-icon-button px-2 text-[11px] font-medium"
            data-tip="Ungroup · ⇧⌘G"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              props.onUngroup(selectedGroup()!);
            }}
          >
            Ungroup
          </button>
        </div>
      </Show>

      <Show when={props.selectedScreenIds.size > 1 && selectionGeometry()}>
        {(bounds) => (
          <div
            class="absolute z-30 flex min-h-10 items-center rounded-[11px] bg-[var(--map-control-surface)] p-1 shadow-[var(--map-elevation-panel)]"
            style={{
              left: `${bounds().left + bounds().width + 12}px`,
              top: `${bounds().top + 30}px`,
            }}
          >
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[11px] font-medium text-[var(--text-strong)] hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
              data-tip="Group · ⌘G"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                props.onGroupSelection();
              }}
            >
              <Icon name="group" size={13} /> Group
            </button>
          </div>
        )}
      </Show>
    </>
  );
}
