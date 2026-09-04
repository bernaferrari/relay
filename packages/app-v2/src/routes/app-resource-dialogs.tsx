/** @jsxImportSource react */
import { Button, Dialog, Field, FieldError, FieldLabel, Input } from "@relay/ui-react";
import { Box, Globe2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type {
  ProductAppVersion,
  ProductBrowserAccount,
} from "../data/app-resources-product-service";

export type VersionDraft = {
  id: string;
  name: string;
  platform: ProductAppVersion["platform"];
  status: ProductAppVersion["status"];
  applicationId?: string;
  configuration?: string;
  sourceSha?: string;
};

export type AccountDraft = {
  targetId: string;
  name: string;
  expiresAt?: number;
};

export type AccountRefreshInput = AccountDraft & { fixtureId: string };

export function VersionRow({
  version,
  canEdit,
  onEdit,
}: {
  version: ProductAppVersion;
  canEdit: boolean;
  onEdit(): void;
}) {
  return (
    <li className="relay-resource-row">
      <span className="relay-resource-icon" aria-hidden="true">
        {version.platform === "web" ? <Globe2 /> : <Box />}
      </span>
      <span className="relay-resource-copy">
        <strong>{version.name}</strong>
        <small>
          {platformLabel(version.platform)}
          {version.configuration ? ` · ${version.configuration}` : ""}
          {version.applicationId ? ` · ${version.applicationId}` : ""}
        </small>
      </span>
      <span className={`relay-resource-status relay-resource-status--${version.status}`}>
        {statusLabel(version.status)}
      </span>
      <time dateTime={new Date(version.updatedAt).toISOString()}>
        Updated {shortDate(version.updatedAt)}
      </time>
      {canEdit ? (
        <span className="relay-resource-row-actions">
          <Button size="small" variant="ghost" onClick={onEdit} aria-label={`Edit ${version.name}`}>
            Edit
          </Button>
        </span>
      ) : null}
    </li>
  );
}

export function VersionEditorDialog({
  value,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  value?: ProductAppVersion;
  pending: boolean;
  error: Error | null;
  onClose(): void;
  onSubmit(input: VersionDraft): void;
}) {
  const [draft, setDraft] = useState<VersionDraft>(() => versionDraft(value));
  const editing = value !== undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    const id = draft.id.trim();
    const name = draft.name.trim();
    if (!id || !name) return;
    onSubmit({
      id,
      name,
      platform: draft.platform,
      status: draft.status,
      ...(draft.applicationId?.trim() ? { applicationId: draft.applicationId.trim() } : {}),
      ...(draft.configuration?.trim() ? { configuration: draft.configuration.trim() } : {}),
      ...(draft.sourceSha?.trim() ? { sourceSha: draft.sourceSha.trim() } : {}),
    });
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="relay-dialog-backdrop" />
        <Dialog.Viewport className="relay-dialog-viewport">
          <Dialog.Popup className="relay-overlay-popup relay-dialog-popup relay-resource-dialog">
            <Dialog.Title>{editing ? "Edit version" : "Add version"}</Dialog.Title>
            <Dialog.Description>
              Register the exact build identity Relay can use. This does not associate a build with
              an App Map.
            </Dialog.Description>
            <form onSubmit={submit}>
              <Field>
                <FieldLabel htmlFor="version-id">Version ID</FieldLabel>
                <Input
                  id="version-id"
                  value={draft.id}
                  onChange={(event) => setDraft({ ...draft, id: event.currentTarget.value })}
                  placeholder="checkout-ios-3-4"
                  autoComplete="off"
                  readOnly={editing}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="version-name">Name</FieldLabel>
                <Input
                  id="version-name"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                  placeholder="Checkout 3.4.0"
                  autoComplete="off"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="version-platform">Platform</FieldLabel>
                <select
                  id="version-platform"
                  value={draft.platform}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      platform: event.currentTarget.value as ProductAppVersion["platform"],
                    })
                  }
                  disabled={editing}
                >
                  <option value="ios">iOS</option>
                  <option value="android">Android</option>
                  <option value="web">Web</option>
                </select>
              </Field>
              {editing ? (
                <p className="relay-resource-lifecycle-note">
                  Current status: <strong>{statusLabel(draft.status)}</strong>. Relay updates build
                  readiness from preflight, installation, and launch results.
                </p>
              ) : null}
              <div className="relay-resource-field-grid">
                <Field>
                  <FieldLabel htmlFor="version-configuration">Configuration</FieldLabel>
                  <Input
                    id="version-configuration"
                    value={draft.configuration ?? ""}
                    onChange={(event) =>
                      setDraft({ ...draft, configuration: event.currentTarget.value })
                    }
                    placeholder="release"
                    autoComplete="off"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="version-application-id">Application ID</FieldLabel>
                  <Input
                    id="version-application-id"
                    value={draft.applicationId ?? ""}
                    onChange={(event) =>
                      setDraft({ ...draft, applicationId: event.currentTarget.value })
                    }
                    placeholder="com.example.checkout"
                    autoComplete="off"
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="version-source-sha">Source SHA (optional)</FieldLabel>
                <Input
                  id="version-source-sha"
                  value={draft.sourceSha ?? ""}
                  onChange={(event) => setDraft({ ...draft, sourceSha: event.currentTarget.value })}
                  placeholder="40-character source revision"
                  autoComplete="off"
                />
              </Field>
              {error ? (
                <FieldError>
                  {error instanceof Error ? error.message : "Relay could not save this version."}
                </FieldError>
              ) : null}
              <div className="relay-dialog-actions">
                <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!draft.id.trim() || !draft.name.trim() || pending}
                >
                  {pending ? "Saving…" : editing ? "Save version" : "Add version"}
                </Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function BrowserAccountDialog({
  account,
  targets,
  pending,
  error,
  onClose,
  onSave,
  onRefresh,
}: {
  account?: ProductBrowserAccount;
  targets: readonly { id: string; name: string }[];
  pending: boolean;
  error: Error | null;
  onClose(): void;
  onSave(input: AccountDraft): void;
  onRefresh(input: AccountRefreshInput): void;
}) {
  const editing = account !== undefined;
  const [name, setName] = useState(account?.fixture.name ?? "");
  const [targetId, setTargetId] = useState(account?.target.id ?? targets[0]?.id ?? "");
  const [expiresAt, setExpiresAt] = useState(formatDateInput(account?.fixture.expiresAt));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !targetId) return;
    const expiry = parseDateInput(expiresAt);
    const input = {
      targetId,
      name: name.trim(),
      ...(expiry === undefined ? {} : { expiresAt: expiry }),
    };
    if (editing) onRefresh({ ...input, fixtureId: account.fixture.id });
    else onSave(input);
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="relay-dialog-backdrop" />
        <Dialog.Viewport className="relay-dialog-viewport">
          <Dialog.Popup className="relay-overlay-popup relay-dialog-popup relay-resource-dialog">
            <Dialog.Title>
              {editing ? "Refresh browser sign-in" : "Save browser sign-in"}
            </Dialog.Title>
            <Dialog.Description>
              {editing
                ? "Capture the current reviewed state from this exact managed browser into the same fixture."
                : "Save the current reviewed state from an exact managed browser. Secrets stay on Relay and are never shown here."}
            </Dialog.Description>
            <form onSubmit={submit}>
              <Field>
                <FieldLabel htmlFor="account-name">Sign-in name</FieldLabel>
                <Input
                  id="account-name"
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  placeholder="Staging buyer"
                  autoComplete="off"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="account-target">Managed browser</FieldLabel>
                <select
                  id="account-target"
                  value={targetId}
                  onChange={(event) => setTargetId(event.currentTarget.value)}
                  disabled={editing}
                >
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field>
                <FieldLabel htmlFor="account-expiry">Expires on (optional)</FieldLabel>
                <Input
                  id="account-expiry"
                  type="date"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.currentTarget.value)}
                />
              </Field>
              {error ? (
                <FieldError>
                  {error instanceof Error ? error.message : "Relay could not update this sign-in."}
                </FieldError>
              ) : null}
              <div className="relay-dialog-actions">
                <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!name.trim() || !targetId || pending}
                >
                  {pending ? "Saving…" : editing ? "Refresh sign-in" : "Save sign-in"}
                </Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

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
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="relay-dialog-backdrop" />
        <Dialog.Viewport className="relay-dialog-viewport">
          <Dialog.Popup className="relay-overlay-popup relay-dialog-popup relay-resource-dialog">
            <Dialog.Title>Revoke browser sign-in?</Dialog.Title>
            <Dialog.Description>
              This revokes “{account.fixture.name}” on {account.target.name}. Relay will keep the
              audit record, but it cannot be used for future authenticated Tests.
            </Dialog.Description>
            {error ? <FieldError>{error.message}</FieldError> : null}
            <div className="relay-dialog-actions">
              <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" variant="primary" disabled={pending} onClick={onConfirm}>
                {pending ? "Revoking…" : "Revoke sign-in"}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function versionDraft(version?: ProductAppVersion): VersionDraft {
  return {
    id: version?.id ?? "",
    name: version?.name ?? "",
    platform: version?.platform ?? "ios",
    status: version?.status ?? "uploaded",
    applicationId: version?.applicationId,
    configuration: version?.configuration,
    sourceSha: version?.sourceSha,
  };
}

function formatDateInput(timestamp?: number): string {
  return timestamp === undefined ? "" : new Date(timestamp).toISOString().slice(0, 10);
}

function parseDateInput(value: string): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(`${value}T23:59:59.999Z`);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function platformLabel(platform: ProductAppVersion["platform"]): string {
  if (platform === "ios") return "iOS";
  if (platform === "android") return "Android";
  return "Web";
}

function statusLabel(status: string): string {
  return status.replace(/-/gu, " ").replace(/^./u, (letter) => letter.toLocaleUpperCase());
}

function shortDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(timestamp);
}
