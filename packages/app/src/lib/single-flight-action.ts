/** Drops duplicate activations while one deliberate UI action is in flight. */
export function createSingleFlightAction<Arguments extends readonly unknown[], Result>(input: {
  action: (...args: Arguments) => Promise<Result>;
  onBusyChange?: (busy: boolean) => void;
}) {
  let busy = false;
  return async (...args: Arguments): Promise<Result | undefined> => {
    if (busy) return undefined;
    busy = true;
    input.onBusyChange?.(true);
    try {
      return await input.action(...args);
    } finally {
      busy = false;
      input.onBusyChange?.(false);
    }
  };
}
