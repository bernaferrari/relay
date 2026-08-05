import { createSignal } from "solid-js";
import type { AppMap, CaseExpansionStrategy, CaseStack } from "@relay/protocol";
import type { CanvasConnection } from "./app-map-connection-draft";
import { useServer } from "../context/server";
import { toast } from "../context/toast";

export function useAppMapCaseStack(options: {
  activeAppMap: () => AppMap | undefined;
  canonicalConnectionFor: (
    connection: CanvasConnection,
  ) => AppMap["connections"][string] | undefined;
}) {
  const server = useServer();
  const [caseStackBusy, setCaseStackBusy] = createSignal(false);

  const caseStackFor = (connection: CanvasConnection) => {
    const map = options.activeAppMap();
    const id = options.canonicalConnectionFor(connection)?.caseStackId;
    return id ? map?.caseStacks[id] : undefined;
  };

  const saveConnectionCaseStack = async (
    connection: CanvasConnection,
    value: { name: string; variableIds: string[]; strategy: CaseExpansionStrategy },
  ) => {
    const map = options.activeAppMap();
    const canonicalConnection = options.canonicalConnectionFor(connection);
    if (!map || !canonicalConnection) {
      toast("This connection is still syncing. Try again in a moment.", "info");
      return;
    }
    const existing = canonicalConnection.caseStackId
      ? map.caseStacks[canonicalConnection.caseStackId]
      : undefined;
    const at = Date.now();
    const caseStackId = existing?.id ?? `cases-${connection.id}`;
    const stack: CaseStack = {
      id: caseStackId,
      organizationId: map.organizationId,
      projectId: map.projectId,
      appMapId: map.id,
      name: value.name,
      variableIds: value.variableIds,
      strategy: value.strategy,
      maxCases: existing?.maxCases ?? 20,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    setCaseStackBusy(true);
    try {
      await server.runAction("app-map.case-stack.attach", {
        appMapId: map.id,
        connectionId: canonicalConnection.id,
        caseStackId,
        expectedRevision: map.revision,
        caseStack: stack,
      });
      await server.refreshAppMaps();
      toast(
        `Added ${value.variableIds.length === 1 ? "a case stack" : "combined coverage"}`,
        "success",
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setCaseStackBusy(false);
    }
  };

  const attachConnectionCaseStack = async (connection: CanvasConnection, caseStackId: string) => {
    const map = options.activeAppMap();
    const canonicalConnection = options.canonicalConnectionFor(connection);
    if (!map || !canonicalConnection || !map.caseStacks[caseStackId]) return;
    setCaseStackBusy(true);
    try {
      await server.runAction("app-map.case-stack.attach", {
        appMapId: map.id,
        connectionId: canonicalConnection.id,
        caseStackId,
        expectedRevision: map.revision,
      });
      await server.refreshAppMaps();
      toast(`Applied ${map.caseStacks[caseStackId]!.name}`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setCaseStackBusy(false);
    }
  };

  const detachConnectionCaseStack = async (connection: CanvasConnection) => {
    const map = options.activeAppMap();
    const canonicalConnection = options.canonicalConnectionFor(connection);
    if (!map || !canonicalConnection?.caseStackId) return;
    setCaseStackBusy(true);
    try {
      await server.runAction("app-map.connection.update", {
        appMapId: map.id,
        connectionId: canonicalConnection.id,
        expectedRevision: map.revision,
        patch: { caseStackId: null },
      });
      await server.refreshAppMaps();
      toast("Removed cases from this connection", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setCaseStackBusy(false);
    }
  };

  return {
    caseStackBusy,
    caseStackFor,
    saveConnectionCaseStack,
    attachConnectionCaseStack,
    detachConnectionCaseStack,
  };
}
