import { ArrowLeft, Camera, Circle, Clock, Hand, Keyboard, MoveUpRight } from "lucide-react";
import type { ProductRunReportOverview } from "../data/run-product-service";

export function timelineStateLabel(
  state: ProductRunReportOverview["timeline"][number]["state"],
): string {
  if (state === "passed") return "Passed";
  if (state === "failed") return "Failed";
  if (state === "blocked") return "Blocked";
  if (state === "recovered") return "Recovered";
  if (state === "running") return "In progress";
  return "Not reached";
}

export function StepActionIcon({ title }: { title: string }) {
  const Icon = /^tap\b/i.test(title)
    ? Hand
    : /^back\b/i.test(title)
      ? ArrowLeft
      : /^observe\b/i.test(title)
        ? Camera
        : /^(wait|pause)\b/i.test(title)
          ? Clock
          : /^(type|input)\b/i.test(title)
            ? Keyboard
            : /^swipe\b/i.test(title)
              ? MoveUpRight
              : Circle;
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />;
}
