/** UI presentation uses busy; dispatch consults the current admission so
 * queued events and open portal callbacks cannot use an earlier render. */
export type RecordingSetupAdmission = Readonly<{
  busy: boolean;
  mayEdit(): boolean;
}>;

/** One synchronous owner for recording startup, held through its receipt.
 * This gates setup edits and device commands without repeating Begin. */
export function createRecordingSetupAdmission() {
  let starting = false;
  return {
    mayEdit: () => !starting,
    async run<T>(start: () => Promise<T>): Promise<T | undefined> {
      if (starting) return;
      starting = true;
      try {
        return await start();
      } finally {
        starting = false;
      }
    },
  };
}
