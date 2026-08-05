import { createSignal, onCleanup } from "solid-js";

/** Owns the right-rail device companion open/close lifecycle. */
export function useAppMapCapturePanel(options: { clearContextSurface: () => void }) {
  const [captureOpen, setCaptureOpen] = createSignal(false);
  const [captureClosing, setCaptureClosing] = createSignal(false);
  let captureCloseTimer: number | undefined;

  const closeCapturePanel = () => {
    if (!captureOpen() || captureClosing()) return;
    setCaptureClosing(true);
    captureCloseTimer = window.setTimeout(() => {
      setCaptureOpen(false);
      setCaptureClosing(false);
      captureCloseTimer = undefined;
    }, 150);
  };

  const openCapturePanel = () => {
    if (captureCloseTimer) window.clearTimeout(captureCloseTimer);
    captureCloseTimer = undefined;
    setCaptureClosing(false);
    options.clearContextSurface();
    setCaptureOpen(true);
  };

  const openDevicePicker = () => {
    if (captureCloseTimer) window.clearTimeout(captureCloseTimer);
    captureCloseTimer = undefined;
    setCaptureClosing(false);
    options.clearContextSurface();
    setCaptureOpen(true);
    // DevicePicker subscribes when the companion mounts. Wait one frame so a
    // request made from the canvas can never race that subscription.
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("relay:open-device-picker")));
  };

  onCleanup(() => {
    if (captureCloseTimer) window.clearTimeout(captureCloseTimer);
  });

  return {
    captureOpen,
    setCaptureOpen,
    captureClosing,
    closeCapturePanel,
    openCapturePanel,
    openDevicePicker,
  };
}
