import { useState, type SetStateAction } from "react";

/** Keep standalone canvases local; routed canvases use their URL as selection authority. */
export function useMapSelection(
  value: string | undefined,
  onChange?: (value: string | undefined) => void,
) {
  const [local, setLocal] = useState(value);
  const current = onChange ? value : local;
  function set(next: SetStateAction<string | undefined>) {
    const resolved = typeof next === "function" ? next(current) : next;
    if (onChange) onChange(resolved);
    else setLocal(resolved);
  }
  return [current, set] as const;
}
