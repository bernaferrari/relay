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
import { projectError } from "@relay/product/errors";
import type { RecordingCondition as Condition } from "../data/recording-product-service";

const WAIT_CHOICES = [30, 60, 120, 300] as const;
const PAUSE_CHOICES = [5, 10, 30, 60] as const;

/** Give an assertion timeout its form context without exposing runner syntax.
 * Connection, ownership and other failures keep their product recovery. */
export function conditionFailureMessage(condition: Condition, error: unknown): string {
  const detail = projectError(error).detail;
  if (!condition.text || !detail.includes(condition.text)) return detail;
  if (/not visible after|not found on screen|wait-for: timed out waiting for/iu.test(detail))
    return `“${condition.text}” wasn’t found. Check the text on screen and try again.`;
  if (/still visible after/iu.test(detail))
    return `“${condition.text}” is still on screen. Try again when it disappears.`;
  return detail;
}

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
    if ((kind !== "pause" && !text.trim()) || pending || disabled) return;
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
    } disabled:cursor-wait disabled:opacity-60`;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
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
          Wait for text or a control to appear or disappear. Relay checks it now and saves the step.
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
                disabled={pending}
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
                    disabled={pending}
                    className={choice(pause === value)}
                    onClick={() => setPause(value)}
                  >
                    {label(value)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Prefer a visible condition: the wait ends as soon as it matches.
              </p>
            </div>
          ) : (
            <Field>
              <FieldLabel htmlFor="condition-text">Text on screen</FieldLabel>
              <Input
                id="condition-text"
                value={text}
                onChange={(event) => setText(event.currentTarget.value)}
                placeholder={kind === "gone" ? "For example, Generating" : "For example, Download"}
                maxLength={200}
                autoComplete="off"
                autoFocus
                disabled={pending}
              />
              <p className="text-xs text-muted-foreground">
                Choose text or a control that appears when ready. Text in your prompt also matches.
              </p>
              {suggestions.length ? (
                <div className="mt-1 flex flex-wrap gap-1.5" aria-label="On screen now">
                  {suggestions.map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={pending}
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
                    disabled={pending}
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
            <DialogClose
              render={
                <Button variant="ghost" disabled={pending}>
                  Cancel
                </Button>
              }
            />
            <Button
              type="submit"
              disabled={(kind !== "pause" && !text.trim()) || pending || disabled}
            >
              {pending ? (kind === "check" ? "Checking…" : "Waiting…") : "Add step"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
