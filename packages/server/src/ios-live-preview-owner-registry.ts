import { HttpError } from "./http.js";

export type IosPreviewStopReason =
  | "idle"
  | "stale"
  | "startup-failed"
  | "upstream-ended"
  | "shutdown";

export type IosPreviewOwner = {
  stop: (reason?: IosPreviewStopReason) => Promise<boolean>;
};

/**
 * A singleflight registry keeps refreshes and multiple Relay windows from
 * starting concurrent go-ios processes for the same physical target.
 */
export class IosPreviewOwnerRegistry<T extends IosPreviewOwner> {
  readonly #active = new Map<string, T>();
  readonly #starting = new Map<string, Promise<T>>();

  async acquire(
    serial: string,
    isLive: (owner: T) => boolean,
    start: () => Promise<T>,
  ): Promise<T> {
    const existing = this.#active.get(serial);
    if (existing) {
      if (isLive(existing)) return existing;
      const stopped = await existing.stop("stale");
      if (!stopped) {
        throw new HttpError(
          503,
          "The previous iOS preview is still stopping; retry once it exits.",
        );
      }
    }

    const pending = this.#starting.get(serial);
    if (pending) return pending;

    const created = Promise.resolve()
      .then(start)
      .then((owner) => {
        if (!isLive(owner)) {
          void owner.stop("startup-failed");
          throw new HttpError(502, "iOS preview ended before its first frame arrived.");
        }
        this.#active.set(serial, owner);
        return owner;
      });
    this.#starting.set(serial, created);
    void created.then(
      () => {
        if (this.#starting.get(serial) === created) this.#starting.delete(serial);
      },
      () => {
        if (this.#starting.get(serial) === created) this.#starting.delete(serial);
      },
    );
    return created;
  }

  release(serial: string, owner: T): boolean {
    if (this.#active.get(serial) !== owner) return false;
    this.#active.delete(serial);
    return true;
  }

  get(serial: string): T | undefined {
    return this.#active.get(serial);
  }

  values(): readonly T[] {
    return [...this.#active.values()];
  }

  get count(): number {
    return this.#active.size;
  }
}
