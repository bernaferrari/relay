/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { Target, Search, Check } from "lucide-react";
import { useState, type CSSProperties } from "react";
import type { RecordingEvidenceControl } from "../data/recording-evidence-target";
import {
  pickRecordingEvidenceControl,
  imagePointFromClick,
} from "../data/recording-evidence-target";
import type { StepTarget } from "@relay/protocol";
import { RecordingTargetFields } from "./recording-target-fields";
import type { ReviewTargetTryResult } from "../data/recording-try-target";

export function RecordingTargetPicker({
  controls,
  canEdit,
  previewUrl,
  onTry,
  onKeep,
}: {
  controls: readonly RecordingEvidenceControl[];
  canEdit: boolean;
  previewUrl: string | null;
  onTry(control: RecordingEvidenceControl): Promise<ReviewTargetTryResult>;
  onKeep(target: StepTarget): void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<RecordingEvidenceControl>();
  const [hovered, setHovered] = useState<RecordingEvidenceControl>();
  const [query, setQuery] = useState("");
  const [tryResult, setTryResult] = useState<ReviewTargetTryResult>();
  const [trying, setTrying] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [manual, setManual] = useState(false);
  const normalized = query.trim().toLowerCase();
  const visible = controls.filter((control) => {
    if (normalized)
      return [control.name, control.role, control.target.identifier].some((value) =>
        value?.toLowerCase().includes(normalized),
      );
    return (
      !control.target.identifier?.startsWith("com.android.systemui") &&
      (!size || control.rect.y > size.height * 0.06)
    );
  });
  const highlight = hovered ?? selected;
  function choose(control: RecordingEvidenceControl) {
    setSelected(control);
    setTryResult(undefined);
  }
  function keep(target: StepTarget) {
    onKeep(target);
    setOpen(false);
  }
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={!canEdit}
        onClick={() => {
          setOpen(true);
          setTryResult(undefined);
        }}
      >
        <Target aria-hidden="true" /> Change target
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90dvh] w-[min(920px,calc(100vw-32px))] max-w-none flex-col gap-4 overflow-hidden sm:max-w-[920px]">
          <div>
            <DialogTitle>Change target</DialogTitle>
            <DialogDescription>
              Select an element on the screenshot, or find it by name.
            </DialogDescription>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(260px,340px)] gap-5 max-[640px]:grid-cols-1">
            <div className="flex min-h-0 items-center justify-center rounded-lg bg-muted/40 p-3 max-[640px]:hidden">
              {previewUrl ? (
                <button
                  type="button"
                  className="relative block min-h-0 max-w-full cursor-crosshair"
                  aria-label="Pick a control in this screenshot"
                  onPointerLeave={() => setHovered(undefined)}
                  onPointerMove={(event) => {
                    const image = event.currentTarget.querySelector("img");
                    if (!image) return;
                    const point = imagePointFromClick(event, image);
                    setHovered(point ? pickRecordingEvidenceControl(visible, point) : undefined);
                  }}
                  onClick={(event) => {
                    const image = event.currentTarget.querySelector("img");
                    if (!image) return;
                    const point = imagePointFromClick(event, image);
                    const next = point && pickRecordingEvidenceControl(controls, point);
                    if (next) choose(next);
                  }}
                >
                  <img
                    src={previewUrl}
                    alt="Recorded screen"
                    className="block max-h-[65dvh] max-w-full rounded-md object-contain"
                    onLoad={(event) =>
                      setSize({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
                    }
                  />
                  {highlight && size ? (
                    <span
                      className="pointer-events-none absolute left-(--box-left) top-(--box-top) h-(--box-height) w-(--box-width) rounded-sm border-2 border-blue-500 bg-blue-500/10"
                      style={
                        {
                          "--box-left": `${(highlight.rect.x / size.width) * 100}%`,
                          "--box-top": `${(highlight.rect.y / size.height) * 100}%`,
                          "--box-width": `${(highlight.rect.width / size.width) * 100}%`,
                          "--box-height": `${(highlight.rect.height / size.height) * 100}%`,
                        } as CSSProperties
                      }
                    />
                  ) : null}
                </button>
              ) : (
                <p className="text-sm text-muted-foreground">Screenshot unavailable</p>
              )}
            </div>
            <div className="flex min-h-0 flex-col gap-3">
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={manual ? "ghost" : "secondary"}
                  onClick={() => setManual(false)}
                >
                  Elements
                </Button>
                <Button
                  size="sm"
                  variant={manual ? "secondary" : "ghost"}
                  onClick={() => setManual(true)}
                >
                  Custom target
                </Button>
              </div>
              {manual ? (
                <div className="min-h-0 overflow-auto">
                  <RecordingTargetFields canEdit={canEdit} onKeep={keep} />
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      aria-label="Find an element"
                      placeholder="Find an element…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      className="ps-9"
                    />
                  </div>
                  <ul
                    className="min-h-40 flex-1 space-y-1 overflow-y-auto overflow-x-hidden"
                    aria-label="Visible controls"
                  >
                    {visible.map((control) => (
                      <li key={control.id}>
                        <button
                          type="button"
                          onClick={() => choose(control)}
                          onPointerEnter={() => setHovered(control)}
                          onPointerLeave={() => setHovered(undefined)}
                          className={`flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-2 text-start text-sm ${selected?.id === control.id ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
                        >
                          <span className="min-w-0 flex-1 truncate" title={control.name}>
                            {control.name}
                          </span>
                          {control.role ? (
                            <code className="max-w-24 truncate rounded bg-muted px-1 text-[10px] text-muted-foreground">
                              {control.role.split(".").at(-1)}
                            </code>
                          ) : null}
                          {selected?.id === control.id ? (
                            <Check className="size-3.5 shrink-0" />
                          ) : null}
                        </button>
                      </li>
                    ))}
                    {!visible.length ? (
                      <li className="p-4 text-sm text-muted-foreground">
                        No matching elements. Try another name or use a custom target.
                      </li>
                    ) : null}
                  </ul>
                  {selected ? (
                    <div className="grid gap-1 rounded-md bg-muted/40 p-3 text-xs">
                      <strong className="truncate text-sm font-medium">{selected.name}</strong>
                      <span className="break-all text-muted-foreground">{selected.why}</span>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
          {tryResult ? (
            <p className="text-sm text-muted-foreground" role="status">
              {tryResult.detail}
            </p>
          ) : null}
          <div className="flex shrink-0 justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {!manual ? (
              <>
                <Button
                  variant="outline"
                  disabled={!selected || trying || !canEdit}
                  onClick={() => {
                    if (!selected) return;
                    setTrying(true);
                    void onTry(selected)
                      .then(setTryResult)
                      .catch(() =>
                        setTryResult({
                          kind: "failed",
                          detail: "Could not try this target. Check the device and try again.",
                        }),
                      )
                      .finally(() => setTrying(false));
                  }}
                >
                  {trying ? "Trying…" : "Try on device"}
                </Button>
                <Button
                  disabled={!selected || !canEdit || trying}
                  onClick={() => selected && keep(selected.target)}
                >
                  Use target
                </Button>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
