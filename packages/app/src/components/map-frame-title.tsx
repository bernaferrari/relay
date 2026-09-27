import { useLayoutEffect, useRef } from "react";

/** Fit the full title on one line without changing the frame's geometry. */
export function MapFrameTitle({ title }: { title: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const fit = () => {
      node.style.fontSize = "13px";
      const available = node.parentElement?.clientWidth ?? 0;
      const natural = node.scrollWidth;
      if (available && natural > available) node.style.fontSize = `${(13 * available) / natural}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (node.parentElement) observer.observe(node.parentElement);
    return () => observer.disconnect();
  }, [title]);
  return (
    <span ref={ref} className="block max-w-full whitespace-nowrap" title={title}>
      {title}
    </span>
  );
}
