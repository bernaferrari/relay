export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onLateResolve?: (value: T) => void | Promise<void>,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  const tracked = promise.then(async (value) => {
    if (timedOut && onLateResolve) await onLateResolve(value);
    return value;
  });
  try {
    return await Promise.race([
      tracked,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(`${label} timed out`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Time out the caller, abort when supported, and still wait for the original
 * operation to settle before another target operation may begin. Android has
 * one UiAutomation slot; racing onward while a late snapshot still owns it is
 * less safe than spending the backend's bounded cleanup budget. */
export async function withTimeoutAndDrain<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void | Promise<void>,
): Promise<T> {
  try {
    return await withTimeout(promise, ms, label);
  } catch (error) {
    if (error instanceof Error && error.message === `${label} timed out`) {
      await onTimeout?.();
      await promise.catch(() => undefined);
    }
    throw error;
  }
}
