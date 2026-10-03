export interface RelayRuntimeOptions {
  workspaceRoot: string;
  stateDirectory?: string;
  port?: number;
  token?: string;
}
export interface RelayRuntimeStartup {
  disposition: "started" | "attached";
  url: string;
  pid: number;
  workspaceRoot: string;
  stateDirectory: string;
  logPath?: string;
}
export function ensureRelayRuntime(options: RelayRuntimeOptions): Promise<RelayRuntimeStartup>;
