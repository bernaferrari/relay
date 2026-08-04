type VisualFrame = { path?: string; mime?: string };

export function hasVisualRunFrames(frames: readonly VisualFrame[]): boolean {
  return frames.some(
    (frame) =>
      frame.mime?.toLocaleLowerCase() === "image/png" || /\.png(?:$|[?#])/i.test(frame.path ?? ""),
  );
}

export function canApproveVisualBaseline(status: string, frames: readonly VisualFrame[]): boolean {
  return (status === "ok" || status === "healed") && hasVisualRunFrames(frames);
}
