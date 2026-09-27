import type { ServerConnection } from "@relay/protocol";

export type PlatformStorage = {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove?(key: string): void | Promise<void>;
};

export type DesktopUpdateState = {
  phase: "unsupported" | "disabled" | "idle" | "checking" | "available" | "downloaded" | "error";
  version?: string;
  releaseName?: string;
  releaseNotes?: string;
  releaseDate?: string;
  error?: string;
};

export type Platform = {
  platform: "web" | "desktop";
  openExternal?(url: string): void | Promise<void>;
  openLaneTab?(input: { url: string; laneId: string }): Promise<{ partition: string }>;
  openXcode?(): void | Promise<void>;
  notify?(title: string, body?: string): void | Promise<void>;
  copyImage?(base64: string, mime: string): void | Promise<void>;
  getServerUrl(): string | Promise<string>;
  getServerConnection?(): ServerConnection | Promise<ServerConnection>;
  setServerConnection?(connection: ServerConnection): void | Promise<void>;
  setServerUrl?(url: string): void | Promise<void>;
  storage: PlatformStorage;
  version?: string;
  fetch?: typeof fetch;
  updates?: {
    getState(): Promise<DesktopUpdateState>;
    check(): Promise<void>;
    install(): Promise<void>;
    subscribe(listener: (state: DesktopUpdateState) => void): () => void;
  };
};
