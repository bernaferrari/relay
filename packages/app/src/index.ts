export { AppBaseProviders, AppInterface } from "./app";
export {
  PlatformProvider,
  usePlatform,
  createWebPlatform,
  type Platform,
  type PlatformStorage,
  type PlatformName,
} from "./context/platform";
export { ServerProvider, useServer } from "./context/server";
export type {
  ActionInfo,
  DeviceInfo,
  Frame,
  HealthState,
  JobInfo,
  LogLine,
  PersistedRun,
  RecipeInfo,
  RecipeStep,
  SnapshotNode,
  SnapshotState,
  StepTarget,
  TraceFrameRef,
  TraceStep,
} from "./lib/api-types";
export { CommandProvider, useCommand, type Command } from "./context/command";
export type { ThemeAppliedDetail } from "@grok-device/ui/theme/context";
