import { TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
import type { ProductRunReportOverview } from "../data/run-report-model";

/** One navigation model for the run summary and all retained evidence. */
export function RunViewTabs({ report }: { report: ProductRunReportOverview }) {
  const views = [
    ["story", "Overview"],
    ["steps", "Steps"],
    ...(report.captureReview?.items.length ||
    report.evidence.some((section) => section.id === "screenshot" && section.items.length) ||
    report.timeline.some((step) => step.framePaths?.length)
      ? [["captures", "Screenshots"]]
      : []),
    ...(report.performance?.length ? [["performance", "Performance"]] : []),
    ...(report.timeline.some((step) => step.expected?.trim()) ? [["details", "Checks"]] : []),
    ["logs", "Logs"],
    ...(report.evidence.some((section) => section.id === "network" && section.items.length)
      ? [["network", "Network"]]
      : []),
  ];
  return (
    <TabsList
      variant="line"
      className="h-12 w-full shrink-0 justify-start gap-3 overflow-x-auto border-y border-border px-5"
      aria-label="Run views"
    >
      {views.map(([value, label]) => (
        <TabsTrigger key={value} value={value} className="h-10 flex-none px-2 after:bottom-0">
          {label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
