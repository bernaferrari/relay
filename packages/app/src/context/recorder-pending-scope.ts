export function createPendingRecordingScopeActions(input: {
  hasActiveSession: () => boolean;
  setGroup: (value: string) => void;
  setSourceScreenId: (value: string | undefined) => void;
  setTransitionId: (value: string | undefined) => void;
}) {
  return {
    setRecordingGroup(value: string): void {
      if (!input.hasActiveSession()) input.setGroup(value.slice(0, 96));
    },
    setRecordingSourceScreen(value: string | undefined): void {
      if (!input.hasActiveSession()) input.setSourceScreenId(value);
    },
    setRecordingTransition(value: string | undefined): void {
      if (!input.hasActiveSession()) input.setTransitionId(value);
    },
    startNextRecordingGroup(): void {
      if (!input.hasActiveSession()) input.setGroup("");
    },
  };
}
