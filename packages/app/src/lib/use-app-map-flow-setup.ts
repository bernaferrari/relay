import type { AppMap, Flow } from "@relay/protocol";
import { useServer } from "../context/server";
import { toast } from "../context/toast";

export function useAppMapFlowSetup(options: {
  activeAppMap: () => AppMap | undefined;
  selectedEntryFlows: () => Flow[];
}) {
  const server = useServer();

  const setSelectedFlowSetup = async (routineId?: string) => {
    const map = options.activeAppMap();
    const flows = options.selectedEntryFlows();
    if (!map || !flows.length) return;
    const at = Date.now();
    const routine = routineId ? map.routines[routineId] : undefined;
    const defaultBindings = routine
      ? Object.fromEntries(
          routine.parameters.flatMap((parameter) =>
            parameter.default === undefined ? [] : [[parameter.name, parameter.default]],
          ),
        )
      : undefined;
    try {
      await server.runAction("app-map.commit", {
        appMapId: map.id,
        expectedRevision: map.revision,
        summary: routineId
          ? `Prepare ${flows.length === 1 ? flows[0]!.name : `${flows.length} flows`} with ${routine!.name}`
          : `Remove before-run setup from ${flows.length === 1 ? flows[0]!.name : `${flows.length} flows`}`,
        changes: flows.map((flow) => {
          const { setup: _setup, ...withoutSetup } = flow;
          const existingSetup = flow.setup;
          const bindings =
            existingSetup && existingSetup.routineId === routineId
              ? existingSetup.bindings
              : defaultBindings;
          return {
            kind: "flow.save" as const,
            flow: {
              ...withoutSetup,
              ...(routineId
                ? {
                    setup: {
                      routineId,
                      ...(Object.keys(bindings ?? {}).length ? { bindings } : {}),
                    },
                  }
                : {}),
              updatedAt: at,
            },
          };
        }),
      });
      await server.refreshAppMaps();
      toast(
        routineId ? `Runs will start with ${routine!.name}` : "Before-run setup removed",
        "success",
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  return { setSelectedFlowSetup };
}
