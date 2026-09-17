/** @jsxImportSource react */
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { Button } from "@relay/ui-react/components/button";
import { Copy, FileWarning } from "lucide-react";
import { useMemo, useState } from "react";
import { composeProductIssue, type ProductIssueSource } from "../data/integration-product-service";

export function IssueDraftButton({ source }: { source: ProductIssueSource }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string>();
  const draft = useMemo(() => composeProductIssue(source), [source]);
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);

  async function copyDraft() {
    if (!navigator.clipboard) {
      setCopyError(
        "Clipboard access is unavailable. Select the draft text below to copy it manually.",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(`${title}\n\n${body}`);
      setCopyError(undefined);
      setCopied(true);
    } catch {
      setCopyError(
        "Clipboard access was blocked. Select the draft text below to copy it manually.",
      );
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          setCopyError(undefined);
        }
      }}
    >
      <DialogTrigger render={<Button variant="ghost" />}>
        <FileWarning aria-hidden="true" /> Draft issue
      </DialogTrigger>

      <DialogContent
        showCloseButton={false}
        className="relay-issue-draft-dialog w-[min(720px,calc(100vw-32px))]"
      >
        <DialogTitle>Issue handoff</DialogTitle>
        <DialogDescription>
          Relay prepared a bounded, redacted draft. Nothing is sent to GitHub or another provider.
        </DialogDescription>
        <div className="relay-issue-draft-meta mt-[18px] flex flex-wrap gap-1.5">
          <span className="rounded-full bg-muted px-2 py-1 text-[10px] capitalize text-muted-foreground">
            {draft.source.kind}
          </span>
          <span className="rounded-full bg-muted px-2 py-1 text-[10px] capitalize text-muted-foreground">
            {draft.evidence.count} evidence {draft.evidence.count === 1 ? "channel" : "channels"}
          </span>
          <span className="rounded-full bg-muted px-2 py-1 text-[10px] capitalize text-muted-foreground">
            {draft.redaction.applied ? "Sensitive fields redacted" : "No sensitive fields detected"}
          </span>
        </div>
        <label
          className="mb-1.5 mt-4 block text-[11px] font-semibold text-muted-foreground"
          htmlFor={`issue-title-${draft.source.id}`}
        >
          Title
        </label>
        <input
          id={`issue-title-${draft.source.id}`}
          className="relay-issue-draft-title min-h-9 w-full rounded-[var(--radius-md)] border border-input bg-secondary px-3 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <label
          className="mb-1.5 mt-4 block text-[11px] font-semibold text-muted-foreground"
          htmlFor={`issue-body-${draft.source.id}`}
        >
          Body
        </label>
        <textarea
          id={`issue-body-${draft.source.id}`}
          className="relay-issue-draft-body max-h-80 w-full resize-y rounded-[var(--radius-md)] border border-input bg-secondary p-3 font-mono text-xs leading-6 text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          value={body}
          onChange={(event) => setBody(event.currentTarget.value)}
          rows={14}
        />
        <p className="relay-issue-draft-note mt-2.5 text-[11px] text-muted-foreground">
          {draft.delivery.detail}
        </p>
        {copyError ? <p role="alert">{copyError}</p> : null}
        <div className="relay-dialog-actions flex flex-wrap items-center justify-end gap-2.5">
          <DialogClose render={<Button variant="ghost">Close</Button>} />
          <Button variant="default" onClick={() => void copyDraft()}>
            <Copy aria-hidden="true" /> {copied ? "Copied" : "Copy draft"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
