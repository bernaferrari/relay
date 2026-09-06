/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Target } from "lucide-react";
import { useState } from "react";
import type { RecordingEvidenceControl } from "../data/recording-evidence-target";
import { pickRecordingEvidenceControl } from "../data/recording-evidence-target";
import { imagePointFromClick } from "../data/recording-evidence-target";
import type { RecordingEvidenceTarget } from "../data/recording-evidence-target";

export function RecordingTargetPicker({
  controls,
  canEdit,
  previewUrl,
  onKeep,
}: {
  controls: readonly RecordingEvidenceControl[];
  canEdit: boolean;
  previewUrl: string | null;
  onKeep(target: RecordingEvidenceTarget): void;
}) {
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<RecordingEvidenceControl>();
  const [tried, setTried] = useState(false);

  function choose(control: RecordingEvidenceControl) {
    setSelected(control);
    setTried(false);
  }

  return (
    <div className="grid gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={!canEdit}
        onClick={() => {
          setPicking(true);
          setTried(false);
        }}
      >
        <Target aria-hidden="true" /> Change target
      </Button>
      {picking ? (
        <div className="grid gap-2 rounded-lg border border-border p-3">
          {previewUrl && controls.length ? (
            <button
              type="button"
              className="relative overflow-hidden rounded-md border border-border bg-muted"
              aria-label="Pick a control in this screenshot"
              onClick={(event) => {
                const image = event.currentTarget.querySelector("img");
                if (!image) return;
                const point = imagePointFromClick(event, image);
                if (!point) return;
                const next = pickRecordingEvidenceControl(controls, point);
                if (next) choose(next);
              }}
            >
              <img src={previewUrl} alt="" className="max-h-[280px] w-full object-contain" />
            </button>
          ) : null}
          {controls.length ? (
            <ul className="grid gap-1" aria-label="Visible controls">
              {controls.map((control) => (
                <li key={control.id}>
                  <button
                    type="button"
                    className={`flex min-h-10 w-full items-center justify-between rounded-md px-2 text-left text-sm ${
                      selected?.id === control.id ? "bg-muted font-medium" : "hover:bg-muted/60"
                    }`}
                    title={control.role}
                    onClick={() => choose(control)}
                  >
                    {control.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              This frame has no labeled controls. Relay cannot pick a target from pixels alone.
            </p>
          )}
          {selected ? (
            <div className="grid gap-2">
              <p className="text-sm text-foreground">{selected.why}</p>
              {tried ? (
                <p className="text-xs text-muted-foreground">
                  Relay would tap {selected.name}. Keep this target to store a reviewed revision.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setTried(true)}
                  disabled={!canEdit}
                >
                  Try target
                </Button>
                <Button size="sm" onClick={() => onKeep(selected.target)} disabled={!canEdit}>
                  Keep target
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Click the control in the screenshot, or choose it from the list.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
