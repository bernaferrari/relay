import type { Accessor, Setter } from "solid-js";
import type {
  CompatibilityMatrix,
  MatrixExpansion,
  TargetDefinition,
  TargetPreflight,
  TargetProfile,
} from "@relay/protocol";
import { toast } from "../context/toast";
import type { LogLine } from "./api-types";
import {
  deleteMatrix,
  importMatrixYaml,
  loadMatrixYaml,
  resolveMatrix,
  saveMatrix,
} from "./server-matrix-remote";
import type { ServerRequest } from "./server-matrix-remote";
import {
  deleteTarget,
  listTargetProfiles,
  listTargets,
  openBrowserTarget as openBrowserTargetRemote,
  preflightTarget,
  saveBrowserTarget as saveBrowserTargetRemote,
} from "./server-target-remote";

type TargetControllerDependencies = {
  request: ServerRequest;
  health: Accessor<string>;
  matrices: Accessor<CompatibilityMatrix[]>;
  selectedDevice: Accessor<string | null>;
  setTargets: Setter<TargetDefinition[]>;
  setTargetProfiles: Setter<TargetProfile[]>;
  setMatrices: Setter<CompatibilityMatrix[]>;
  selectDevice: (id: string | null) => Promise<void>;
  refreshDevices: () => Promise<void>;
  appendLog: (text: string, level?: LogLine["level"]) => void;
};

export function createServerTargetController(deps: TargetControllerDependencies) {
  async function refreshTargets(): Promise<void> {
    if (deps.health() === "offline") return;
    deps.setTargets(await listTargets(deps.request));
  }
  async function refreshTargetProfiles(): Promise<void> {
    if (deps.health() === "offline") return;
    deps.setTargetProfiles(await listTargetProfiles(deps.request));
  }
  async function refreshMatrices(): Promise<void> {
    if (deps.health() === "offline") return;
    const data = await deps.request<{ matrices: CompatibilityMatrix[] }>("/matrices");
    deps.setMatrices(data.matrices ?? []);
  }
  async function saveCompatibilityMatrix(input: {
    id: string;
    name: string;
    selectors: CompatibilityMatrix["selectors"];
  }): Promise<CompatibilityMatrix> {
    const data = await saveMatrix(
      deps.request,
      input,
      deps.matrices().some((matrix) => matrix.id === input.id),
    );
    await refreshMatrices();
    return data.matrix;
  }
  async function deleteCompatibilityMatrix(id: string): Promise<void> {
    await deleteMatrix(deps.request, id);
    await refreshMatrices();
  }
  function resolveCompatibilityMatrix(id: string): Promise<MatrixExpansion> {
    return resolveMatrix(deps.request, id);
  }
  async function loadCompatibilityMatrixYaml(id: string): Promise<string | null> {
    try {
      return await loadMatrixYaml(deps.request, id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.appendLog(message, "error");
      toast(message, "error");
      return null;
    }
  }
  async function importCompatibilityMatrixYaml(
    yaml: string,
    conflict: "reject" | "replace" = "reject",
  ): Promise<CompatibilityMatrix | null> {
    try {
      const matrix = await importMatrixYaml(deps.request, yaml, conflict);
      await refreshMatrices();
      toast(`Imported “${matrix.name}”`, "success");
      return matrix;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.appendLog(message, "error");
      toast(message, "error");
      return null;
    }
  }
  async function saveBrowserTarget(input: {
    id?: string;
    name: string;
    startUrl: string;
    executablePath?: string;
    headless?: boolean;
  }): Promise<TargetDefinition> {
    const target = await saveBrowserTargetRemote(deps.request, input);
    await Promise.all([refreshTargets(), refreshTargetProfiles(), deps.refreshDevices()]);
    return target;
  }
  async function deleteTargetRemote(id: string): Promise<void> {
    await deleteTarget(deps.request, id);
    if (deps.selectedDevice() === id) await deps.selectDevice(null);
    await Promise.all([refreshTargets(), refreshTargetProfiles(), deps.refreshDevices()]);
  }
  function preflightTargetRemote(id: string): Promise<TargetPreflight> {
    return preflightTarget(deps.request, id);
  }
  async function openBrowserTarget(id: string): Promise<void> {
    const session = await openBrowserTargetRemote(deps.request, id);
    toast(`${session.name} is ready for sign in`, "success");
  }
  return {
    refreshTargets,
    refreshTargetProfiles,
    refreshMatrices,
    saveCompatibilityMatrix,
    deleteCompatibilityMatrix,
    resolveCompatibilityMatrix,
    loadCompatibilityMatrixYaml,
    importCompatibilityMatrixYaml,
    saveBrowserTarget,
    deleteTargetRemote,
    preflightTargetRemote,
    openBrowserTarget,
  };
}
