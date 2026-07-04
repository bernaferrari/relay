export type ElectronAPI = {
  /** Persistent key/value store (JSON-backed under userData/stores). */
  storeGet: (name: string, key: string) => Promise<string | null>;
  storeSet: (name: string, key: string, value: string) => Promise<void>;
  storeDelete: (name: string, key: string) => Promise<void>;

  /** Open a URL in the system browser. */
  openExternal: (url: string) => void;

  /** Show a native OS notification. */
  notify: (title: string, body?: string) => void;

  /** URL of the local @grok-device/server HTTP API. */
  getServerUrl: () => Promise<string>;

  /** Whether the hosting BrowserWindow is focused. */
  getWindowFocused: () => Promise<boolean>;

  /** Update native window background (theme sync). */
  setBackgroundColor: (color: string) => Promise<void>;
};

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
