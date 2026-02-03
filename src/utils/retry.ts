import { AppError } from './errors.ts';

type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

const defaultOptions: Required<Pick<RetryOptions, 'attempts' | 'baseDelayMs' | 'maxDelayMs' | 'jitter'>> = {
  attempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2000,
  jitter: 0.2,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? defaultOptions.attempts;
  const baseDelayMs = options.baseDelayMs ?? defaultOptions.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? defaultOptions.maxDelayMs;
  const jitter = options.jitter ?? defaultOptions.jitter;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= attempts) break;
      if (options.shouldRetry && !options.shouldRetry(err, attempt)) break;
      const delay = computeDelay(baseDelayMs, maxDelayMs, jitter, attempt);
      await sleep(delay);
    }
  }
  if (lastError) throw lastError;
  throw new AppError('COMMAND_FAILED', 'retry failed');
}

function computeDelay(base: number, max: number, jitter: number, attempt: number): number {
  const exp = Math.min(max, base * 2 ** (attempt - 1));
  const jitterAmount = exp * jitter;
  return Math.max(0, exp + (Math.random() * 2 - 1) * jitterAmount);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
