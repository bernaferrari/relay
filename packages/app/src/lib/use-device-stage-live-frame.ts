import { createEffect, createSignal, onCleanup } from "solid-js";
import { useServer } from "../context/server";

/** Owns the object URL lifecycle for the selected device's latest frame. */
export function useDeviceStageLiveFrame() {
  const server = useServer();
  const [src, setSrc] = createSignal("");
  let objectUrl = "";
  createEffect(() => {
    const live = server.liveFrame();
    const previous = objectUrl;
    if (!live?.base64) {
      objectUrl = "";
      setSrc("");
      if (previous) URL.revokeObjectURL(previous);
      return;
    }
    const binary = atob(live.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    objectUrl = URL.createObjectURL(new Blob([bytes], { type: live.mime || "image/png" }));
    setSrc(objectUrl);
    if (previous) URL.revokeObjectURL(previous);
  });
  onCleanup(() => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });
  return src;
}
