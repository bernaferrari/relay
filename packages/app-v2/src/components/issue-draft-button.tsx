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
      <DialogTrigger render={<Button variant="outline" />}>
        <FileWarning aria-hidden="true" /> Draft issue
      </DialogTrigger>

      <DialogContent showCloseButton={false} className="relay-issue-draft-dialog">
        <DialogTitle>Issue handoff</DialogTitle>
        <DialogDescription>
          Relay prepared a bounded, redacted draft. Nothing is sent to GitHub or another provider.
        </DialogDescription>
        <div className="relay-issue-draft-meta">
          <span>{draft.source.kind}</span>
          <span>
            {draft.evidence.count} evidence {draft.evidence.count === 1 ? "channel" : "channels"}
          </span>
          <span>
            {draft.redaction.applied ? "Sensitive fields redacted" : "No sensitive fields detected"}
          </span>
        </div>
        <label htmlFor={`issue-title-${draft.source.id}`}>Title</label>
        <input
          id={`issue-title-${draft.source.id}`}
          className="relay-issue-draft-title"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <label htmlFor={`issue-body-${draft.source.id}`}>Body</label>
        <textarea
          id={`issue-body-${draft.source.id}`}
          className="relay-issue-draft-body"
          value={body}
          onChange={(event) => setBody(event.currentTarget.value)}
          rows={14}
        />
        <p className="relay-issue-draft-note">{draft.delivery.detail}</p>
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
