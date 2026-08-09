import { Show } from "solid-js";
import type { MapGroup } from "@relay/protocol";
import { groupForScreen } from "../lib/app-map-groups";
import { Icon } from "./icon";

export type AppMapGroupMenuState = {
  x: number;
  y: number;
  groupId?: string;
  screenIds: string[];
};

const menuItemClass =
  "flex h-8 items-center justify-between rounded-[7px] px-2.5 text-left text-[12px] text-[var(--text-strong)] hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]";

export function AppMapGroupMenu(props: {
  menu: AppMapGroupMenuState | null;
  groups: readonly MapGroup[];
  onGroup: () => void;
  onUngroupSelection: () => void;
  onRename: (group: MapGroup) => void;
  onUngroup: (group: MapGroup) => void;
}) {
  const menuGroup = () => {
    const id = props.menu?.groupId;
    return id ? props.groups.find((group) => group.id === id) : undefined;
  };
  const hasGroupedScreen = () =>
    Boolean(
      props.menu?.screenIds.some((screenId) => Boolean(groupForScreen(props.groups, screenId))),
    );

  return (
    <Show when={props.menu}>
      {(menu) => (
        <aside
          role="menu"
          aria-label="Group actions"
          data-app-map-group-menu
          data-canvas-shortcuts="ignore"
          class="absolute z-50 grid w-48 gap-0.5 rounded-[10px] bg-[var(--map-control-surface)] p-1.5 shadow-[var(--map-elevation-panel)]"
          style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Show
            when={menuGroup()}
            fallback={
              <>
                <Show when={menu().screenIds.length > 1}>
                  <button
                    type="button"
                    role="menuitem"
                    class={menuItemClass}
                    onClick={props.onGroup}
                  >
                    <span class="inline-flex items-center gap-2">
                      <Icon name="group" size={13} /> Group
                    </span>
                    <kbd class="text-[10px] text-[var(--text-weak)]">⌘G</kbd>
                  </button>
                </Show>
                <Show when={hasGroupedScreen()}>
                  <button
                    type="button"
                    role="menuitem"
                    class={menuItemClass}
                    onClick={props.onUngroupSelection}
                  >
                    <span>Ungroup</span>
                    <kbd class="text-[10px] text-[var(--text-weak)]">⇧⌘G</kbd>
                  </button>
                </Show>
                <Show when={menu().screenIds.length < 2 && !hasGroupedScreen()}>
                  <p class="px-2.5 py-2 text-[11px]/[1.45] text-[var(--text-weak)]">
                    Shift-click another screen to group them.
                  </p>
                </Show>
              </>
            }
          >
            {(group) => (
              <>
                <button
                  type="button"
                  role="menuitem"
                  class={menuItemClass}
                  onClick={() => props.onRename(group())}
                >
                  <span>Rename Group</span>
                  <kbd class="text-[10px] text-[var(--text-weak)]">F2</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class={menuItemClass}
                  onClick={() => props.onUngroup(group())}
                >
                  <span>Ungroup</span>
                  <kbd class="text-[10px] text-[var(--text-weak)]">⇧⌘G</kbd>
                </button>
              </>
            )}
          </Show>
        </aside>
      )}
    </Show>
  );
}
