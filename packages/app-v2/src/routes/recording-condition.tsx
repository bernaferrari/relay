/** @jsxImportSource react */
import { useState, type FormEvent } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@relay/ui-react/components/dialog";
import { Button } from "@relay/ui-react/components/button";
import { Field, FieldLabel } from "@relay/ui-react/components/field";
import { Input } from "@relay/ui-react/components/input";
import { Hourglass } from "lucide-react";
import type { RecordingCondition as Condition } from "../data/recording-product-service";

const WAIT_CHOICES = [30, 60, 120, 300] as const;
const PAUSE_CHOICES = [5, 10, 30, 60] as const;

/**
 * Slow results (an image, a video, a model's answer) need "wait until this
 * shows up", not a fixed pause. Added while recording, it runs on the live
 * page right away, so the person sees that it holds before saving.
 */
export function RecordingCondition({
  open,
  onOpenChange,
  disabled,
  pending,
  error,
  onSubmit,
  suggestions = [],
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  disabled: boolean;
  pending: boolean;
  error?: string;
  onSubmit(condition: Condition): void;
  /** Text visible on the page right now. */
  suggestions?: readonly string[];
}) {
  const [kind, setKind] = useState<Condition["kind"]>("wait");
  const [text, setText] = useState("");
  const [seconds, setSeconds] = useState<number>(60);
  const [pause, setPause] = useState<number>(10);
  const label = (value: number) =>
    value < 60 ? `${value} seconds` : `${value / 60} minute${value > 60 ? "s" : ""}`;
  function submit(event: FormEvent) {
    event.preventDefault();
    if ((kind !== "pause" && !text.trim()) || pending) return;
    onSubmit({
      kind,
      text: text.trim(),
      timeoutMs: (kind === "check" ? 10 : kind === "pause" ? pause : seconds) * 1000,
    });
  }
  const choice = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      active
        ? "border-brand bg-brand-soft text-foreground"
        : "border-border text-muted-foreground hover:border-brand/40 hover:text-foreground"
    }`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            title="Wait for something or check it"
          >
            <Hourglass aria-hidden="true" /> Wait or check
          </Button>
        }
      />
      <DialogContent showCloseButton={false}>
        <DialogTitle>Wait or check</DialogTitle>
        <DialogDescription>
          Relay tries it on the page now and adds it as a step. A wait stops as soon as the
          condition holds.
        </DialogDescription>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kind">
            {(
              [
                ["wait", "Wait until it appears"],
                ["gone", "Wait until it’s gone"],
                ["check", "Check it is on screen"],
                ["pause", "Just wait"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                className={choice(kind === value)}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {kind === "pause" ? (
            <div className="grid gap-2">
              <span className="text-sm font-medium">Wait for</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Wait for">
                {PAUSE_CHOICES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={pause === value}
                    className={choice(pause === value)}
                    onClick={() => setPause(value)}
                  >
                    {label(value)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Prefer waiting for text: it finishes as soon as the result is ready.
              </p>
            </div>
          ) : (
            <Field>
              <FieldLabel htmlFor="condition-text">Text on screen</FieldLabel>
              <Input
                id="condition-text"
                value={text}
                onChange={(event) => setText(event.currentTarget.value)}
                placeholder={
                  kind === "gone" ? "For example, Generating" : "For example, 144 or Download"
                }
                maxLength={200}
                autoComplete="off"
                autoFocus
              />
              {suggestions.length ? (
                <div className="mt-1 flex flex-wrap gap-1.5" aria-label="On screen now">
                  {suggestions.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={choice(text === value)}
                      onClick={() => setText(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              ) : null}
            </Field>
          )}
          {kind === "wait" || kind === "gone" ? (
            <div className="grid gap-2">
              <span className="text-sm font-medium">Give up after</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Give up after">
                {WAIT_CHOICES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={seconds === value}
                    className={choice(seconds === value)}
                    onClick={() => setSeconds(value)}
                  >
                    {label(value)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <DialogClose render={<Button variant="ghost">Cancel</Button>} />
            <Button type="submit" disabled={(kind !== "pause" && !text.trim()) || pending}>
              {pending ? (kind === "check" ? "Checking…" : "Waiting…") : "Add step"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
