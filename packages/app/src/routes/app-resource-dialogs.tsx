/** @jsxImportSource react */
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { FieldError } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import type { ProductBrowserAccount } from "../data/app-resources-product-service";

export function RevokeAccountDialog({
  account,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  account: ProductBrowserAccount;
  pending: boolean;
  error: Error | null;
  onClose(): void;
  onConfirm(): void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[min(720px,calc(100dvh-32px))] overflow-auto"
      >
        <DialogTitle>Revoke {account.fixture.name}?</DialogTitle>
        <DialogDescription>
          Tests can no longer run as this account. Past results keep their evidence, and you can add
          the account again any time.
        </DialogDescription>
        {error ? <FieldError>{error.message}</FieldError> : null}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? "Revoking…" : "Revoke account"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
