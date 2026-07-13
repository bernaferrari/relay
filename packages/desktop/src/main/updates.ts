import { app, autoUpdater } from "electron";

export type DesktopUpdateState = {
  phase: "unsupported" | "disabled" | "idle" | "checking" | "available" | "downloaded" | "error";
  version?: string;
  releaseName?: string;
  releaseNotes?: string;
  releaseDate?: string;
  error?: string;
};

type UpdateListener = (state: DesktopUpdateState) => void;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function updateFeedUrl(): string | null {
  const configured = process.env.RELAY_UPDATE_FEED_URL?.trim();
  if (configured) {
    return configured
      .replaceAll("{platform}", process.platform)
      .replaceAll("{arch}", process.arch)
      .replaceAll("{version}", app.getVersion());
  }
  const repository = process.env.RELAY_GITHUB_REPOSITORY?.trim();
  if (!repository) return null;
  // update.electronjs.org is Electron's hosted GitHub Releases bridge. It
  // still requires signed macOS artifacts and public GitHub Releases.
  return `https://update.electronjs.org/${repository}/${process.platform}-${process.arch}/${app.getVersion()}`;
}

function stringifyReleaseNotes(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : ""))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  return undefined;
}

/**
 * Minimal, explicit wrapper around Electron's built-in updater. It only runs
 * for packaged macOS/Windows apps, never in dev, and exposes a narrow typed
 * API to the renderer through IPC.
 */
export class DesktopUpdater {
  #state: DesktopUpdateState = { phase: "disabled" };
  #listeners = new Set<UpdateListener>();
  #timer: ReturnType<typeof setInterval> | undefined;
  #configured = false;

  getState = (): DesktopUpdateState => ({ ...this.#state });

  subscribe(listener: UpdateListener): () => void {
    this.#listeners.add(listener);
    listener(this.getState());
    return () => this.#listeners.delete(listener);
  }

  #setState(next: DesktopUpdateState): void {
    this.#state = next;
    for (const listener of this.#listeners) listener(this.getState());
  }

  start(): void {
    if (process.platform !== "darwin" && process.platform !== "win32") {
      this.#setState({ phase: "unsupported" });
      return;
    }
    if (!app.isPackaged) {
      this.#setState({ phase: "disabled" });
      return;
    }
    const feed = updateFeedUrl();
    if (!feed) {
      this.#setState({ phase: "disabled" });
      return;
    }
    try {
      autoUpdater.setFeedURL({ url: feed });
      this.#bindEvents();
      this.#configured = true;
      void this.check();
      this.#timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    } catch (error) {
      this.#setState({
        phase: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async check(): Promise<void> {
    if (!this.#configured || this.#state.phase === "checking") return;
    this.#setState({ phase: "checking" });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.#setState({
        phase: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  install(): void {
    if (this.#state.phase !== "downloaded") return;
    autoUpdater.quitAndInstall();
  }

  #bindEvents(): void {
    autoUpdater.on("checking-for-update", () => this.#setState({ phase: "checking" }));
    autoUpdater.on("update-not-available", () => this.#setState({ phase: "idle" }));
    autoUpdater.on("update-available", () => this.#setState({ phase: "available" }));
    autoUpdater.on(
      "update-downloaded",
      (_event, releaseNotes, releaseName, releaseDate, _updateUrl) => {
        this.#setState({
          phase: "downloaded",
          version: releaseName || undefined,
          releaseName: releaseName || undefined,
          releaseNotes: stringifyReleaseNotes(releaseNotes),
          releaseDate: releaseDate ? new Date(releaseDate).toISOString() : undefined,
        });
      },
    );
    autoUpdater.on("error", (error) => {
      this.#setState({
        phase: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
