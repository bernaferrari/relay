export type PanelSelection = { appMapId?: string; runId?: string; frameIndex?: number };

/** Both request order and exact evidence identity must match before painting. */
export class PanelRequestGate {
  private sequence = 0;
  private expected: PanelSelection & { requestId?: string } = {};

  begin(selection: PanelSelection, requestId?: string) {
    this.sequence += 1;
    this.expected = { ...selection, requestId };
    return this.sequence;
  }

  current(sequence: number) {
    return sequence === this.sequence;
  }

  accepts(state: Record<string, unknown>, frame?: { runId?: string; index?: number }) {
    if (state.requestId !== this.expected.requestId) return false;
    if (state.runId !== this.expected.runId) return false;
    if (this.expected.appMapId && state.appMapId !== this.expected.appMapId) return false;
    if (this.expected.frameIndex !== undefined && state.frameIndex !== this.expected.frameIndex)
      return false;
    if (frame && (frame.runId !== this.expected.runId || frame.index !== state.frameIndex))
      return false;
    return true;
  }
}
