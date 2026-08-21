export type RetainedJob = {
  id: string;
  status: string;
  persisted?: boolean;
};

const TERMINAL_STATUSES = new Set(["ok", "error", "healed", "cancelled"]);

/**
 * Process-local job ownership with a bounded, durable terminal history.
 *
 * Non-terminal work is never an eviction candidate. The registry may therefore
 * exceed its history target while a large campaign is queued or running, then
 * contracts after those jobs reach a terminal state and are persisted.
 */
export class JobRegistry<T extends RetainedJob> {
  readonly #jobs = new Map<string, T>();
  readonly #order: string[] = [];

  constructor(readonly terminalHistoryLimit: number) {
    if (!Number.isInteger(terminalHistoryLimit) || terminalHistoryLimit < 1) {
      throw new Error("Job registry history limit must be a positive integer");
    }
  }

  get size(): number {
    return this.#jobs.size;
  }

  get(id: string): T | undefined {
    return this.#jobs.get(id);
  }

  remember(job: T): void {
    if (this.#jobs.has(job.id)) throw new Error(`Job ${job.id} is already registered`);
    this.#jobs.set(job.id, job);
    this.#order.push(job.id);
    this.pruneTerminalHistory();
  }

  /** Remove a job that was registered during a failed admission before it was
   * ever handed to an execution worker. Normal lifecycle code must use the
   * terminal-state path instead; this is intentionally a narrow transaction
   * compensation primitive. */
  forgetUnstarted(job: T): boolean {
    if (this.#jobs.get(job.id) !== job) return false;
    this.#jobs.delete(job.id);
    const index = this.#order.indexOf(job.id);
    if (index >= 0) this.#order.splice(index, 1);
    return true;
  }

  list(limit: number): T[] {
    return this.#order
      .slice()
      .reverse()
      .flatMap((id) => {
        const job = this.#jobs.get(id);
        return job ? [job] : [];
      })
      .slice(0, Math.max(0, limit));
  }

  /** Every retained job, newest first. Use this for lifecycle ownership, not UI pagination. */
  listAll(): T[] {
    return this.list(this.#order.length);
  }

  /** Remove only the oldest terminal jobs whose durable run write completed. */
  pruneTerminalHistory(): void {
    let excess =
      this.#order.reduce((count, id) => {
        const job = this.#jobs.get(id);
        return count + (job && TERMINAL_STATUSES.has(job.status) ? 1 : 0);
      }, 0) - this.terminalHistoryLimit;
    if (excess <= 0) return;

    const retained: string[] = [];
    for (const id of this.#order) {
      const job = this.#jobs.get(id);
      if (!job) continue;
      if (excess > 0 && TERMINAL_STATUSES.has(job.status) && job.persisted === true) {
        this.#jobs.delete(id);
        excess -= 1;
        continue;
      }
      retained.push(id);
    }
    this.#order.splice(0, this.#order.length, ...retained);
  }
}
