import { useServer } from "../context/server";
import { confirmAction } from "./confirm-dialog";

export function createStudioMapDeletion(server: ReturnType<typeof useServer>) {
  const deleteMap = (appMapId: string) => {
    const appMap = server.appMaps().find((candidate) => candidate.id === appMapId);
    if (!appMap) return;
    confirmAction({
      title: "Delete map?",
      body: `“${appMap.name}” and its version history will be removed. This cannot be undone.`,
      confirmLabel: "Delete map",
      onConfirm: async () => {
        await server.runAction("app-map.remove", { appMapId });
        await server.refreshAppMaps();
        if (server.selectedAppMapId() === appMapId) server.setSelectedAppMapId(null);
      },
    });
  };
  return {
    deleteMap,
    deleteSelected: () => {
      const appMapId = server.selectedAppMapId();
      if (appMapId) deleteMap(appMapId);
    },
  };
}
