import { useState } from "react";
import { Timer } from "lucide-react";
import type { AuthoringInteraction } from "@relay/protocol";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";

/** A condition, not a fixed pause: replay continues as soon as the control appears. */
export function RecordingWaitPicker({
  canEdit,
  onInsert,
}: {
  canEdit: boolean;
  onInsert(interaction: AuthoringInteraction): void;
}) {
  const [open, setOpen] = useState(false);
  const [strategy, setStrategy] = useState<"identifier" | "label">("identifier");
  const [value, setValue] = useState("");
  const [seconds, setSeconds] = useState("15");
  const timeout = Number(seconds);
  const valid =
    value.trim().length > 0 &&
    seconds.trim() !== "" &&
    Number.isFinite(timeout) &&
    timeout >= 1 &&
    timeout <= 120;
  return (
    <>
      <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => setOpen(true)}>
        <Timer aria-hidden="true" />
        Wait before this step
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Wait for a control</DialogTitle>
          <DialogDescription>
            Continue when a control appears, such as Stop when a timer finishes. If it never
            appears, the test stops.
          </DialogDescription>
          <div role="group" aria-label="Find by" className="flex gap-2">
            <Button
              variant={strategy === "identifier" ? "secondary" : "ghost"}
              aria-pressed={strategy === "identifier"}
              onClick={() => setStrategy("identifier")}
            >
              Identifier
            </Button>
            <Button
              variant={strategy === "label" ? "secondary" : "ghost"}
              aria-pressed={strategy === "label"}
              onClick={() => setStrategy("label")}
            >
              Label
            </Button>
          </div>
          <label className="grid gap-1.5 text-sm">
            {strategy === "identifier" ? "Identifier" : "Label"}
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={strategy === "identifier" ? "com.example:id/timer_stop" : "Stop"}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Use a control unique to the finished state. A control already visible will continue
            immediately. Labels may change with the app’s language.
          </p>
          <label className="grid gap-1.5 text-sm">
            Maximum wait (seconds)
            <Input
              type="number"
              min="1"
              max="120"
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!canEdit || !valid}
              onClick={() => {
                onInsert({
                  kind: "steps",
                  label: `Wait for ${value.trim()}`,
                  steps: [
                    {
                      kind: "wait-for",
                      target: { [strategy]: value.trim() },
                      timeoutMs: timeout * 1000,
                    },
                  ],
                });
                setOpen(false);
              }}
            >
              Add wait
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
