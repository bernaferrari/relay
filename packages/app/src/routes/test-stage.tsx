/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useState, type ReactNode } from "react";

/** The app beside the steps: the recorded screenshot, or the live browser. */
export function TestStage({ recorded, live }: { recorded: ReactNode; live: ReactNode }) {
  const [mode, setMode] = useState<"recorded" | "live">("recorded");
  const [liveOpened, setLiveOpened] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col bg-stage">
      <div
        className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2"
        role="tablist"
        aria-label="App view"
      >
        {(
          [
            ["recorded", "Screenshot"],
            ["live", "Live browser"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            role="tab"
            size="sm"
            variant={mode === value ? "secondary" : "ghost"}
            aria-selected={mode === value}
            disabled={value === "live" && !live}
            onClick={() => {
              setMode(value);
              if (value === "live") setLiveOpened(true);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className={mode === "recorded" ? "min-h-0 flex-1 overflow-auto" : "hidden"}>
        {recorded}
      </div>
      {liveOpened ? (
        <div className={mode === "live" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>{live}</div>
      ) : null}
    </div>
  );
}
