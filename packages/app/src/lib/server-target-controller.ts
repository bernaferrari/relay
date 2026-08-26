import type { Accessor, Setter } from "solid-js";
import type { RelayClient } from "@relay/client";
import { humanError } from "./human-error";
import type {
  CompatibilityMatrix,
  MatrixExpansion,
  OperationInput,
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
import {
  deleteTarget,
  listTargetProfiles,
  listTargets,
  openBrowserTarget as openBrowserTargetRemote,
  preflightTarget,
  saveBrowserTarget as saveBrowserTargetRemote,
} from "./server-target-remote";

type TargetControllerDependencies = {
  client: () => Promise<RelayClient>;
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
    deps.setTargets(await listTargets(await deps.client()));
  }
  async function refreshTargetProfiles(): Promise<void> {
    if (deps.health() === "offline") return;
    deps.setTargetProfiles(await listTargetProfiles(await deps.client()));
  }
  async function refreshMatrices(): Promise<void> {
    if (deps.health() === "offline") return;
    const data = await (await deps.client()).invoke("matrix.list", {});
    deps.setMatrices(data.matrices ?? []);
  }
  async function saveCompatibilityMatrix(input: {
    id: string;
    name: string;
    selectors: CompatibilityMatrix["selectors"];
  }): Promise<CompatibilityMatrix> {
    const data = await saveMatrix(
      await deps.client(),
      input,
      deps.matrices().some((matrix) => matrix.id === input.id),
    );
    await refreshMatrices();
    return data.matrix;
  }
  async function deleteCompatibilityMatrix(id: string): Promise<void> {
    await deleteMatrix(await deps.client(), id);
    await refreshMatrices();
  }
  async function resolveCompatibilityMatrix(id: string): Promise<MatrixExpansion> {
    return resolveMatrix(await deps.client(), id);
  }
  async function loadCompatibilityMatrixYaml(id: string): Promise<string | null> {
    try {
      return await loadMatrixYaml(await deps.client(), id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const readable = humanError(error, "Could not open this compatibility matrix");
      deps.appendLog(message, "error");
      toast(readable, "error");
      return null;
    }
  }
  async function importCompatibilityMatrixYaml(
    yaml: string,
    conflict: "reject" | "replace" = "reject",
  ): Promise<CompatibilityMatrix | null> {
    try {
      const matrix = await importMatrixYaml(await deps.client(), yaml, conflict);
      await refreshMatrices();
      toast(`Imported “${matrix.name}”`, "success");
      return matrix;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const readable = humanError(error, "Could not import this compatibility matrix");
      deps.appendLog(message, "error");
      toast(readable, "error");
      return null;
    }
  }
  async function saveBrowserTarget(
    input: OperationInput<"target.create">,
  ): Promise<TargetDefinition> {
    const target = await saveBrowserTargetRemote(await deps.client(), input);
    await Promise.all([refreshTargets(), refreshTargetProfiles(), deps.refreshDevices()]);
    return target;
  }
  async function deleteTargetRemote(id: string): Promise<void> {
    await deleteTarget(await deps.client(), id);
    if (deps.selectedDevice() === id) await deps.selectDevice(null);
    await Promise.all([refreshTargets(), refreshTargetProfiles(), deps.refreshDevices()]);
  }
  async function preflightTargetRemote(id: string): Promise<TargetPreflight> {
    return preflightTarget(await deps.client(), id);
  }
  async function openBrowserTarget(id: string): Promise<void> {
    const session = await openBrowserTargetRemote(await deps.client(), id);
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
