export type TargetWorkerStatus = {
  workerId: string;
  capacity: number;
  active: number;
  queued: number;
  activeTargets: string[];
  queuedTargets: string[];
  /** Optional aggregate host/provider constraint for this physical target lane. */
  host?: {
    workerId: string;
    capacity: number;
    active: number;
    queued: number;
  };
};

export type RuntimePreflightCheck = {
  id: string;
  status: "pass" | "warning" | "fail";
  message: string;
};

export type DevicePoolTargetStatus = {
  serial: string;
  connected: boolean;
  platform?: "android" | "ios";
  name?: string;
  lease: "available" | "leased";
  leaseOwnerId?: string;
  leaseExpiresAt?: number;
};

export type DevicePoolPreflight = {
  poolId: string;
  ok: boolean;
  checkedAt: number;
  capacity: { configured: number; connected: number; available: number; leased: number };
  targets: DevicePoolTargetStatus[];
  checks: RuntimePreflightCheck[];
};

export type RegisteredBuildPreflight = {
  buildId: string;
  ok: boolean;
  checkedAt: number;
  artifact?: { path: string; kind: "apk" | "app"; bytes?: number };
  applicationId?: string;
  capabilities: { install: boolean; launch: boolean };
  checks: RuntimePreflightCheck[];
};

export type InstalledBuild = {
  installed: true;
  applicationId?: string;
  artifactPath: string;
};

export type LaunchedBuild = { launched: true; applicationId: string };
