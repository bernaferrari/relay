/** Keep refresh feedback visible long enough to be perceived, even when a
 * local adapter answers immediately. The operation still owns its result and
 * errors; this only adds a small, bounded affordance delay. */
export async function withRefreshFeedback<T>(
  operation: () => Promise<T> | T,
  minimumMs = 500,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    const remaining = minimumMs - (Date.now() - startedAt);
    if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  }
}
