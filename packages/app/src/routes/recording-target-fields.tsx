/** @jsxImportSource react */
import type { StepTarget } from "@relay/protocol";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { useState } from "react";
import { SelectField } from "../components/filter-select";

export function RecordingTargetFields({
  canEdit,
  onKeep,
}: {
  canEdit: boolean;
  onKeep(target: StepTarget): void;
}) {
  const [method, setMethod] = useState("identifier");
  const [value, setValue] = useState("");
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const coordinates = method === "point";
  const valid = coordinates
    ? [x, y].every((v) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0)
    : value.trim().length > 0;
  return (
    <div className="grid gap-3 border-t border-border pt-3">
      <SelectField
        label="Target by"
        value={method}
        options={[
          { value: "identifier", label: "Accessibility identifier" },
          { value: "label", label: "Accessibility label" },
          { value: "text", label: "Visible text" },
          { value: "point", label: "Screen coordinates" },
        ]}
        onValueChange={setMethod}
      />
      {coordinates ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-xs">
              X (pixels)
              <Input
                type="number"
                min="0"
                value={x}
                onChange={(event) => setX(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs">
              Y (pixels)
              <Input
                type="number"
                min="0"
                value={y}
                onChange={(event) => setY(event.target.value)}
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Measured from the top-left of the full device screen, not the preview. X goes right; Y
            goes down. These fixed pixels do not adapt to another screen size.
          </p>
        </>
      ) : (
        <label className="grid gap-1 text-xs">
          {method === "identifier" ? "Identifier" : method === "text" ? "Text" : "Label"}
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={method === "identifier" ? "com.example:id/settings" : "Network & internet"}
          />
        </label>
      )}
      <p className="text-xs text-muted-foreground">
        Changing the target requires replay before this test can be saved.
      </p>
      <Button
        size="sm"
        disabled={!canEdit || !valid}
        onClick={() =>
          onKeep(
            coordinates ? { point: { x: Number(x), y: Number(y) } } : { [method]: value.trim() },
          )
        }
      >
        Use target
      </Button>
    </div>
  );
}
