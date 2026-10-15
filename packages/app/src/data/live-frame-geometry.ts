/**
 * Where the frame is actually drawn inside the canvas element. The canvas uses
 * object-fit: contain, so a frame with a different aspect is letterboxed;
 * mapping a click against the whole element would land on the wrong control.
 */
export function containedFrameRect(
  element: { left: number; top: number; width: number; height: number },
  frameWidth: number,
  frameHeight: number,
): { left: number; top: number; width: number; height: number } {
  const boxWidth = Math.max(element.width, 1);
  const boxHeight = Math.max(element.height, 1);
  if (!frameWidth || !frameHeight) {
    return { left: element.left, top: element.top, width: boxWidth, height: boxHeight };
  }
  const scale = Math.min(boxWidth / frameWidth, boxHeight / frameHeight);
  const width = frameWidth * scale;
  const height = frameHeight * scale;
  return {
    left: element.left + (boxWidth - width) / 2,
    top: element.top + (boxHeight - height) / 2,
    width,
    height,
  };
}
