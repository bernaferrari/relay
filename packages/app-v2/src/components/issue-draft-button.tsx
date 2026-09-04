/** @jsxImportSource react */
import { Button, Dialog } from "@relay/ui-react";
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
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open) setCopied(false);
      }}
    >
      <Dialog.Trigger render={<Button variant="secondary" />}>
        <FileWarning aria-hidden="true" /> Draft issue
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="relay-dialog-backdrop" />
        <Dialog.Viewport className="relay-dialog-viewport">
          <Dialog.Popup className="relay-overlay-popup relay-dialog-popup relay-issue-draft-dialog">
            <Dialog.Title>Issue handoff</Dialog.Title>
            <Dialog.Description>
              Relay prepared a bounded, redacted draft. Nothing is sent to GitHub or another
              provider.
            </Dialog.Description>
            <div className="relay-issue-draft-meta">
              <span>{draft.source.kind}</span>
              <span>
                {draft.evidence.count} evidence{" "}
                {draft.evidence.count === 1 ? "channel" : "channels"}
              </span>
              <span>
                {draft.redaction.applied
                  ? "Sensitive fields redacted"
                  : "No sensitive fields detected"}
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
              <Dialog.Close render={<Button variant="ghost">Close</Button>} />
              <Button
                variant="primary"
                onClick={() => void copyDraft()}
                disabled={!navigator.clipboard}
              >
                <Copy aria-hidden="true" /> {copied ? "Copied" : "Copy draft"}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
