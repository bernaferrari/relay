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

/** Replay continues as soon as the authored control condition matches. */
export function RecordingWaitPicker({
  canEdit,
  onInsert,
}: {
  canEdit: boolean;
  onInsert(interaction: AuthoringInteraction): void;
}) {
  const [open, setOpen] = useState(false);
  const [condition, setCondition] = useState<"visible" | "gone">("visible");
  const [strategy, setStrategy] = useState<"identifier" | "label">("identifier");
  const [value, setValue] = useState("");
  const [seconds, setSeconds] = useState("15");
  const timeout = Number(seconds);
  const valid =
    value.trim().length > 0 &&
    value.trim().length <= 500 &&
    seconds.trim() !== "" &&
    Number.isFinite(timeout) &&
    timeout >= 1 &&
    timeout <= 900;
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
            Continue when a control appears or disappears. If the condition is not met before the
            limit, the Test stops.
          </DialogDescription>
          <div role="group" aria-label="Wait until" className="flex gap-2">
            <Button
              variant={condition === "visible" ? "secondary" : "ghost"}
              aria-pressed={condition === "visible"}
              onClick={() => setCondition("visible")}
            >
              Appears
            </Button>
            <Button
              variant={condition === "gone" ? "secondary" : "ghost"}
              aria-pressed={condition === "gone"}
              onClick={() => setCondition("gone")}
            >
              Disappears
            </Button>
          </div>
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
              maxLength={500}
              placeholder={strategy === "identifier" ? "com.example:id/timer_stop" : "Stop"}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {condition === "gone"
              ? "An already absent control continues immediately. Check for a result appearing next."
              : "An already visible control continues immediately. Choose a control unique to the finished state."}
          </p>
          <label className="grid gap-1.5 text-sm">
            Maximum wait (seconds)
            <Input
              type="number"
              min="1"
              max="900"
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
                  label:
                    condition === "gone"
                      ? `Wait until ${value.trim()} disappears`
                      : `Wait for ${value.trim()}`,
                  steps: [
                    condition === "gone"
                      ? {
                          kind: "expect",
                          condition: "gone",
                          target: { [strategy]: value.trim() },
                          timeoutMs: timeout * 1000,
                        }
                      : {
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
