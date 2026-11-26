/**
 * A bounded, target-scoped admission lane for browser mutations.
 *
 * Browser Device input and the generic browser Device adapter address the same
 * Playwright page. Keeping their lanes separate lets a generic mutation pass
 * its pre-dispatch checks and then interleave with a frame-bound Browser Device
 * input. One shared lane makes admission itself the serialization boundary and
 * gives callers a typed overload response instead of retaining an unbounded
 * promise chain.
 */

export const MAX_BROWSER_DEVICE_INPUT_QUEUE = 32;

export class BrowserDeviceInputOverloadedError extends Error {
  readonly code = "BROWSER_INPUT_OVERLOADED" as const;

  constructor(
    readonly targetId: string,
    readonly pending: number,
    readonly limit = MAX_BROWSER_DEVICE_INPUT_QUEUE,
  ) {
    super(
      `Browser Device input is overloaded for ${targetId}; ${limit} mutations are already queued. Try again after the current page settles.`,
    );
    this.name = "BrowserDeviceInputOverloadedError";
  }
}

type AdmissionQueue = {
  tail: Promise<void>;
  pending: number;
};

const queues = new Map<string, AdmissionQueue>();

function queueFor(targetId: string): AdmissionQueue {
  let queue = queues.get(targetId);
  if (!queue) {
    queue = { tail: Promise.resolve(), pending: 0 };
    queues.set(targetId, queue);
  }
  return queue;
}

/** Serialize a browser mutation without allowing an unbounded wait list. */
export async function runBrowserMutationAdmission<T>(
  targetId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const queue = queueFor(targetId);
  if (queue.pending >= MAX_BROWSER_DEVICE_INPUT_QUEUE) {
    throw new BrowserDeviceInputOverloadedError(targetId, queue.pending);
  }

  queue.pending += 1;
  const previous = queue.tail;
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => turn);
  queue.tail = tail;
  await previous;
  try {
    return await operation();
  } finally {
    queue.pending -= 1;
    release();
    if (queue.pending === 0 && queue.tail === tail) queues.delete(targetId);
  }
}

export function browserMutationAdmissionStats(targetId: string): {
  pending: number;
  limit: number;
} {
  return {
    pending: queues.get(targetId)?.pending ?? 0,
    limit: MAX_BROWSER_DEVICE_INPUT_QUEUE,
  };
}

export function resetBrowserMutationAdmissionsForTests(): void {
  queues.clear();
}
