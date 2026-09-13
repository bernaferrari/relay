import { createOperationBuilders } from "./operation-builders.js";
import type { OperationInput, OperationOutput, RelayOperationMap } from "./operation-map.js";
import {
  arrayFieldParser,
  boolean,
  emptyInputParser,
  objectFieldParser,
  objectParser,
  record,
  string,
} from "./operation-parser-primitives.js";

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

const { command, query } =
  createOperationBuilders<Pick<RelayOperationMap, WorkspaceResourceOperationId>>();

const buildPreflightInputParser = objectParser<OperationInput<"build.preflight">>(
  "build preflight input",
  (input) => {
    string(input.buildId, "build preflight buildId");
    if (input.serial !== undefined) string(input.serial, "build preflight serial");
  },
);

const buildInstallInputParser = objectParser<OperationInput<"build.install">>(
  "build install input",
  (input) => {
    string(input.buildId, "build install buildId");
    string(input.serial, "build install serial");
    if (input.launch !== undefined) boolean(input.launch, "build install launch");
    if (input.applicationId !== undefined)
      string(input.applicationId, "build install applicationId");
  },
);

const buildInstallOutputParser = objectParser<OperationOutput<"build.install">>(
  "build install response",
  (input) => {
    record(input.installed, "installed build");
    if (input.launched !== undefined) record(input.launched, "launched build");
  },
);

const buildLaunchInputParser = objectParser<OperationInput<"build.launch">>(
  "build launch input",
  (input) => {
    string(input.buildId, "build launch buildId");
    string(input.serial, "build launch serial");
    if (input.applicationId !== undefined)
      string(input.applicationId, "build launch applicationId");
  },
);

const poolPreflightInputParser = objectParser<OperationInput<"device-pool.preflight">>(
  "device pool preflight input",
  (input) => string(input.poolId, "device pool preflight poolId"),
);

/**
 * Named workspace inventory: projects, builds, device pools, and Lanes.
 * Extracted so `operations.ts` can compose them without growing its ceiling.
 */
export const workspaceResourceOperationDefinitions = [
  query("project.list", "List projects", "/projects", {
    input: emptyInputParser,
    output: arrayFieldParser("projects response", "projects"),
  }),
  command("project.save", "Save project", "POST", "/projects", {
    output: objectFieldParser("project response", "project"),
  }),
  query("build.list", "List builds", "/builds", {
    input: emptyInputParser,
    output: arrayFieldParser("builds response", "builds"),
  }),
  command("build.save", "Save build", "POST", "/builds", {
    output: objectFieldParser("build response", "build"),
  }),
  command("build.preflight", "Preflight build", "POST", "/builds/:buildId/preflight", {
    category: "target",
    input: buildPreflightInputParser,
    output: objectFieldParser<OperationOutput<"build.preflight">>(
      "build preflight response",
      "preflight",
    ),
  }),
  command("build.install", "Install build", "POST", "/builds/:buildId/install", {
    category: "target",
    targetCapabilities: ["install"],
    lease: "exclusive",
    confirmation: "confirm",
    input: buildInstallInputParser,
    output: buildInstallOutputParser,
  }),
  command("build.launch", "Launch build", "POST", "/builds/:buildId/launch", {
    category: "target",
    targetCapabilities: ["launch"],
    lease: "exclusive",
    input: buildLaunchInputParser,
    output: objectFieldParser<OperationOutput<"build.launch">>("build launch response", "launched"),
  }),
  query("device-pool.list", "List device pools", "/device-pools", {
    input: emptyInputParser,
    output: arrayFieldParser("device pools response", "pools"),
  }),
  command("device-pool.save", "Save device pool", "POST", "/device-pools", {
    output: objectFieldParser("device pool response", "pool"),
  }),
  command(
    "device-pool.preflight",
    "Preflight device pool",
    "POST",
    "/device-pools/:poolId/preflight",
    {
      category: "target",
      input: poolPreflightInputParser,
      output: objectFieldParser<OperationOutput<"device-pool.preflight">>(
        "device pool preflight response",
        "preflight",
      ),
    },
  ),
  query("lane.list", "List saved Lanes", "/lanes"),
  command("lane.save", "Save a Lane", "POST", "/lanes"),
  command("lane.remove", "Remove a Lane", "DELETE", "/lanes/:laneId", {
    confirmation: "none",
  }),
] as const;
