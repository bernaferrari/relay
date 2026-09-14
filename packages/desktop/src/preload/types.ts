export type ElectronAPI = {
  /** Persistent key/value store (JSON-backed under userData/stores). */
  storeGet: (name: string, key: string) => Promise<string | null>;
  storeSet: (name: string, key: string, value: string) => Promise<void>;
  storeDelete: (name: string, key: string) => Promise<void>;

  /** Open a URL in the system browser. */
  openExternal: (url: string) => void;

  /** Isolated Chromium jar for one Lane. Same Lane shares cookies. */
  openLaneTab: (input: { url: string; laneId: string }) => Promise<{ partition: string }>;
  setLaneCookie: (input: {
    laneId: string;
    url: string;
    name: string;
    value: string;
  }) => Promise<void>;
  getLaneCookies: (input: {
    laneId: string;
    url: string;
  }) => Promise<Array<{ name: string; value: string }>>;

  /** Open Xcode to its Accounts settings workflow. */
  openXcode: () => Promise<boolean>;

  /** Show a native OS notification. */
  notify: (title: string, body?: string) => void;

  /** Copy a PNG/JPEG payload to the native system clipboard. */
  copyImage: (base64: string, mime: string) => Promise<void>;

  /** URL of the local @relay/server HTTP API. */
  getServerUrl: () => Promise<string>;

  /** Whether the hosting BrowserWindow is focused. */
  getWindowFocused: () => Promise<boolean>;

  /** Update native window background (theme sync). */
  setBackgroundColor: (color: string) => Promise<void>;

  /** Signed desktop update lifecycle, emitted by the main process only. */
  updates: {
    getState: () => Promise<{
      phase:
        | "unsupported"
        | "disabled"
        | "idle"
        | "checking"
        | "available"
        | "downloaded"
        | "error";
      version?: string;
      releaseName?: string;
      releaseNotes?: string;
      releaseDate?: string;
      error?: string;
    }>;
    check: () => Promise<void>;
    install: () => Promise<void>;
    onState: (
      listener: (state: {
        phase:
          | "unsupported"
          | "disabled"
          | "idle"
          | "checking"
          | "available"
          | "downloaded"
          | "error";
        version?: string;
        releaseName?: string;
        releaseNotes?: string;
        releaseDate?: string;
        error?: string;
      }) => void,
    ) => () => void;
  };
};

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
