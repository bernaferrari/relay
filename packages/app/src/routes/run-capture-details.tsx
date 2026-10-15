import { Info } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@relay/ui-react/components/popover";
import {
  formatCaptureReviewConfiguration,
  formatCaptureReviewObservedSession,
  type CaptureReviewConfiguration,
  type CaptureReviewItem,
} from "@relay/protocol";

/** Metadata follows the exact capture being inspected, including its attempt. */
export function CaptureDetails({
  item,
  fallbackConfiguration,
}: {
  item: CaptureReviewItem;
  fallbackConfiguration?: CaptureReviewConfiguration;
}) {
  const configuration = [
    ...formatCaptureReviewConfiguration(item.configuration ?? fallbackConfiguration),
    ...formatCaptureReviewObservedSession(item.observed),
  ];
  const runId = "runId" in item && typeof item.runId === "string" ? item.runId : undefined;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label="Capture details"
            title="Capture details"
          />
        }
      >
        <Info aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[70dvh] w-80 max-w-[calc(100vw-2rem)] overflow-auto p-4"
      >
        <h3 className="mb-3 text-sm font-medium">Capture details</h3>
        <dl className="grid gap-3 text-xs leading-5">
          {[
            ["Configuration", configuration.join(" · ")],
            ["Capture", item.caption],
            ["Run", runId],
            ["Full image", item.framePath],
            ["Attempt", item.attempt ? String(item.attempt) : undefined],
          ].map(([label, value]) =>
            value ? (
              <div key={label} className="space-y-0.5">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="wrap-anywhere">{value}</dd>
              </div>
            ) : null,
          )}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
