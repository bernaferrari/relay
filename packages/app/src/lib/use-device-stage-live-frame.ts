import { createEffect, createSignal, onCleanup } from "solid-js";
import { useServer } from "../context/server";

/** Owns the object URL lifecycle for the selected device's latest frame. */
export function useDeviceStageLiveFrame() {
  const server = useServer();
  const [src, setSrc] = createSignal("");
  let objectUrl = "";
  let renderedBase64 = "";
  let renderedSerial: string | undefined;
  createEffect(() => {
    const live = server.liveFrame();
    const previous = objectUrl;
    if (!live?.base64) {
      objectUrl = "";
      renderedBase64 = "";
      renderedSerial = undefined;
      setSrc("");
      if (previous) URL.revokeObjectURL(previous);
      return;
    }
    // Runtime proof metadata may update while the exact PNG bytes remain the
    // same. Do not decode/repaint that bitmap again merely to reflect a newer
    // semantic capability state elsewhere in the Stage.
    if (live.base64 === renderedBase64 && live.serial === renderedSerial && objectUrl) return;
    const binary = atob(live.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    objectUrl = URL.createObjectURL(new Blob([bytes], { type: live.mime || "image/png" }));
    renderedBase64 = live.base64;
    renderedSerial = live.serial;
    setSrc(objectUrl);
    if (previous) URL.revokeObjectURL(previous);
  });
  onCleanup(() => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });
  return src;
}
