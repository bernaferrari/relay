import { createSchemaOperationBuilders } from "../operation/operation-builders.js";

type WorkspaceResourceOperationId =
  | "project.list"
  | "project.save"
  | "build.list"
  | "build.save"
  | "build.preflight"
  | "build.install"
  | "build.launch"
  | "device-pool.list"
  | "device-pool.save"
  | "device-pool.preflight"
  | "lane.list"
  | "lane.save"
  | "lane.remove";

const { command, query } = createSchemaOperationBuilders<WorkspaceResourceOperationId>();

/**
 * Named workspace inventory: projects, builds, device pools, and Lanes.
 * Extracted so `operations.ts` can compose them without growing its ceiling.
 */
export const workspaceResourceOperationDefinitions = [
  query("project.list", "List projects", "/projects", {}),
  command("project.save", "Save project", "POST", "/projects", {}),
  query("build.list", "List builds", "/builds", {}),
  command("build.save", "Save build", "POST", "/builds", {}),
  command("build.preflight", "Preflight build", "POST", "/builds/:buildId/preflight", {
    category: "target",
  }),
  command("build.install", "Install build", "POST", "/builds/:buildId/install", {
    category: "target",
    targetCapabilities: ["install"],
    lease: "exclusive",
    confirmation: "confirm",
  }),
  command("build.launch", "Launch build", "POST", "/builds/:buildId/launch", {
    category: "target",
    targetCapabilities: ["launch"],
    lease: "exclusive",
  }),
  query("device-pool.list", "List device pools", "/device-pools", {}),
  command("device-pool.save", "Save device pool", "POST", "/device-pools", {}),
  command(
    "device-pool.preflight",
    "Preflight device pool",
    "POST",
    "/device-pools/:poolId/preflight",
    {
      category: "target",
    },
  ),
  query("lane.list", "List saved Lanes", "/lanes"),
  command("lane.save", "Save a Lane", "POST", "/lanes"),
  command("lane.remove", "Remove a Lane", "DELETE", "/lanes/:laneId", {
    confirmation: "none",
  }),
] as const;
