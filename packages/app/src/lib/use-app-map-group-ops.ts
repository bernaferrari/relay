import type { AppMap, AppMapCanvasState, MapGroup } from "@relay/protocol";
import { nextGroupName } from "./app-map-groups";
import { toast } from "../context/toast";

export function useAppMapGroupOps(options: {
  activeAppMap: () => AppMap | undefined;
  canvasState: () => AppMapCanvasState;
  groups: () => MapGroup[];
  selectedNodeIds: () => string[];
  persistMetadata: (value: AppMapCanvasState) => void;
  setSelectedNodeIdValue: (id: string | null) => void;
  setSelectedNodeIds: (ids: string[] | ((current: string[]) => string[])) => void;
  setSelectedConnectionId: (id: string | null) => void;
  setSelectedGroupId: (id: string | null) => void;
  setRenamingGroupId: (id: string | null) => void;
  setScreenInspectorOpen: (open: boolean) => void;
  setRenamingNodeId: (id: string | null) => void;
  setGroupMenu: (menu: null) => void;
}) {
  const groupSelection = () => {
    const appMap = options.activeAppMap();
    const screenIds = [...new Set(options.selectedNodeIds())].filter((id) => appMap?.screens[id]);
    if (!appMap || screenIds.length < 2) {
      toast("Select at least two screens to group", "info");
      return;
    }
    const selected = new Set(screenIds);
    const at = Date.now();
    const remaining = options.groups().flatMap((group) => {
      const memberIds = group.screenIds.filter((id) => !selected.has(id));
      return memberIds.length ? [{ ...group, screenIds: memberIds, updatedAt: at }] : [];
    });
    const group: MapGroup = {
      id: `group-${crypto.randomUUID()}`,
      organizationId: appMap.organizationId,
      projectId: appMap.projectId,
      appMapId: appMap.id,
      name: nextGroupName(options.groups()),
      screenIds,
      createdAt: at,
      updatedAt: at,
    };
    options.persistMetadata({ ...options.canvasState(), groups: [...remaining, group] });
    options.setSelectedNodeIdValue(null);
    options.setSelectedNodeIds([]);
    options.setSelectedConnectionId(null);
    options.setSelectedGroupId(group.id);
    options.setGroupMenu(null);
    toast("Created Group", "success");
  };

  const ungroup = (group: MapGroup) => {
    options.persistMetadata({
      ...options.canvasState(),
      groups: options.groups().filter((candidate) => candidate.id !== group.id),
    });
    options.setSelectedGroupId(null);
    options.setRenamingGroupId(null);
    options.setSelectedNodeIds([...group.screenIds]);
    options.setSelectedNodeIdValue(group.screenIds.at(-1) ?? null);
    options.setGroupMenu(null);
    toast("Ungrouped screens", "success");
  };

  const ungroupSelection = () => {
    const selected = new Set(options.selectedNodeIds());
    const owners = options
      .groups()
      .filter((group) => group.screenIds.some((id) => selected.has(id)));
    if (!owners.length) return;
    const ownerIds = new Set(owners.map((group) => group.id));
    options.persistMetadata({
      ...options.canvasState(),
      groups: options.groups().filter((group) => !ownerIds.has(group.id)),
    });
    options.setGroupMenu(null);
    toast(
      owners.length === 1 ? "Ungrouped screens" : `Ungrouped ${owners.length} Groups`,
      "success",
    );
  };

  const renameGroup = (group: MapGroup, name: string) => {
    const next = name.trim();
    if (!next || next === group.name) {
      options.setRenamingGroupId(null);
      return;
    }
    options.persistMetadata({
      ...options.canvasState(),
      groups: options
        .groups()
        .map((candidate) =>
          candidate.id === group.id
            ? { ...candidate, name: next, updatedAt: Date.now() }
            : candidate,
        ),
    });
    options.setRenamingGroupId(null);
  };

  const selectGroup = (group: MapGroup) => {
    options.setSelectedGroupId(group.id);
    options.setSelectedNodeIdValue(null);
    options.setSelectedNodeIds([]);
    options.setSelectedConnectionId(null);
    options.setScreenInspectorOpen(false);
    options.setRenamingNodeId(null);
  };

  return {
    groupSelection,
    ungroup,
    ungroupSelection,
    renameGroup,
    selectGroup,
  };
}
