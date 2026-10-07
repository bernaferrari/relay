export async function drawJpeg(
  canvas: HTMLCanvasElement,
  bytes: Uint8Array,
  isCurrent: () => boolean,
): Promise<boolean> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const image = await createImageBitmap(new Blob([owned.buffer], { type: "image/jpeg" }));
  try {
    if (!isCurrent()) return false;
    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
    }
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Live target canvas context is unavailable");
    context.drawImage(image, 0, 0);
    return true;
  } finally {
    image.close();
  }
}
