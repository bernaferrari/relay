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
  const draft = useMemo(() => composeProductIssue(source), [source]);

  async function copyDraft() {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(`${draft.title}\n\n${draft.body}`);
    setCopied(true);
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) setCopied(false);
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <FileWarning aria-hidden="true" /> Draft issue
      </DialogTrigger>

      <DialogContent
        showCloseButton={false}
        className="relay-issue-draft-dialog"
      >
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
          value={draft.title}
          readOnly
        />
        <label htmlFor={`issue-body-${draft.source.id}`}>Body</label>
        <textarea
          id={`issue-body-${draft.source.id}`}
          className="relay-issue-draft-body"
          value={draft.body}
          readOnly
          rows={14}
        />
        <p className="relay-issue-draft-note">{draft.delivery.detail}</p>
        <div className="relay-dialog-actions">
          <DialogClose render={<Button variant="ghost">Close</Button>} />
          <Button
            variant="default"
            onClick={() => void copyDraft()}
            disabled={!navigator.clipboard}
          >
            <Copy aria-hidden="true" /> {copied ? "Copied" : "Copy draft"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
