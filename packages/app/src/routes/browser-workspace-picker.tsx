/** @jsxImportSource react */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { SelectField } from "../components/filter-select";
import { browserLabel } from "./browsers-side-by-side";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import type { ProductBrowserSpace } from "../data/browser-spaces-product-service";
import { BrowserWorkspaceError, type BrowserTile } from "../data/browser-workspace";
import { browserAddress } from "../components/browser-address-bar";
import { errorMessage } from "./recording-shared";

export function BrowserWorkspacePicker({
  spaces,
  used,
  onAdd,
  onClose,
}: {
  spaces: readonly ProductBrowserSpace[];
  used: readonly string[];
  onAdd(tile: BrowserTile): Promise<void>;
  onClose(): void;
}) {
  const { browserSpacesService, queryClient } = useRouteContext({ from: "__root__" });
  const available = spaces.filter((space) => !used.includes(space.id));
  const [creating, setCreating] = useState(available.length === 0);
  const [browserId, setBrowserId] = useState(available[0]?.id ?? "");
  const [name, setName] = useState("");
  const [url, setUrl] = useState(spaces[0]?.startUrl ?? "");
  const selected = available.find((space) => space.id === browserId);
  const fixtures = useQuery({
    queryKey: ["browser-spaces", browserId, "accounts"],
    queryFn: () => browserSpacesService.listAuthenticationFixtures(browserId),
    enabled: !creating && Boolean(selected),
  });
  const validFixtures = (fixtures.data ?? []).filter(
    (fixture) => !fixture.revokedAt && (!fixture.expiresAt || fixture.expiresAt > Date.now()),
  );
  // One browser is one identity: open as its saved sign-in, else as its current session.
  const account =
    [...validFixtures].sort((a, b) => b.createdAt - a.createdAt)[0]?.reference ?? "current";
  const add = useMutation({
    mutationFn: async () => {
      let space = selected;
      if (creating) {
        space = await browserSpacesService.createSpace({
          name: name.trim(),
          startUrl: (() => {
            try {
              return browserAddress(url);
            } catch {
              throw new BrowserWorkspaceError("Enter a valid http or https address.");
            }
          })(),
          profileRetention: "retain",
        });
        await queryClient.invalidateQueries({ queryKey: ["browser-spaces"] });
      }
      if (!space) throw new BrowserWorkspaceError("Choose a browser profile.");
      const fixture =
        !creating && account !== "current" && account !== "signed-out"
          ? validFixtures.find((item) => item.reference === account)
          : undefined;
      if (!creating && account !== "current" && account !== "signed-out" && !fixture)
        throw new BrowserWorkspaceError("This sign-in is no longer available.");
      await onAdd({
        id: crypto.randomUUID(),
        browserId: space.id,
        name: space.name,
        accountName: creating
          ? "Current session"
          : (fixture?.name ?? (account === "signed-out" ? "Signed out" : "Current session")),
        ...(fixture
          ? { identity: { authenticationFixtureId: fixture.reference } }
          : !creating && account === "signed-out"
            ? { identity: { signedOut: true as const } }
            : {}),
      });
    },
    onSuccess: onClose,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !add.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogTitle>Add browser</DialogTitle>
        <DialogDescription>
          Each browser keeps its own cookies and sign-in, so each one can be a different account.
        </DialogDescription>
        <div
          role="group"
          aria-label="Browser source"
          className="flex w-fit gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
        >
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={!creating}
            disabled={!available.length || add.isPending}
            onClick={() => {
              setCreating(false);
              add.reset();
            }}
          >
            Saved browser
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={creating}
            disabled={add.isPending}
            onClick={() => {
              setCreating(true);
              add.reset();
            }}
          >
            New browser
          </Button>
        </div>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!add.isPending) add.mutate();
          }}
        >
          {/* Both choices are two fields of the same shape, so switching never moves the dialog. */}
          <div className="grid gap-4 sm:grid-cols-2">
            {creating ? (
              <>
                <div className="grid min-w-0 gap-1.5">
                  <label
                    htmlFor="workspace-new-name"
                    className="text-xs font-medium text-foreground"
                  >
                    Name
                  </label>
                  <Input
                    id="workspace-new-name"
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="For example, Admin"
                    disabled={add.isPending}
                    required
                  />
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <label
                    htmlFor="workspace-new-url"
                    className="text-xs font-medium text-foreground"
                  >
                    Website
                  </label>
                  <Input
                    id="workspace-new-url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://your-app.com"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={add.isPending}
                    required
                  />
                </div>
              </>
            ) : (
              <div className="grid min-w-0 gap-1.5 sm:col-span-2">
                <SelectField
                  label="Browser"
                  value={browserId}
                  disabled={add.isPending}
                  options={available.map((space) => ({
                    value: space.id,
                    label: browserLabel(space, spaces),
                  }))}
                  onValueChange={setBrowserId}
                />
              </div>
            )}
          </div>
          {/* One line in both modes keeps the dialog still when switching. */}
          <p className="-mt-2 flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground">
            {creating ? (
              "A fresh browser with its own profile. Sign in once and it remembers."
            ) : (
              <>
                {account === "current"
                  ? "Opens with its current sign-in"
                  : account === "signed-out"
                    ? "Opens signed out"
                    : `Opens as ${validFixtures.find((item) => item.reference === account)?.name ?? "saved sign-in"}`}
              </>
            )}
          </p>
          {!creating && fixtures.error ? (
            <p className="text-sm text-destructive" role="alert">
              Couldn’t load saved sign-ins.{" "}
              <button type="button" className="underline" onClick={() => void fixtures.refetch()}>
                Try again
              </button>
            </p>
          ) : null}
          {add.error ? (
            <p role="alert" className="text-sm text-destructive">
              {add.error instanceof BrowserWorkspaceError
                ? add.error.message
                : errorMessage(add.error)}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={add.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={add.isPending || (creating ? !name.trim() || !url.trim() : !selected)}
            >
              {add.isPending ? "Opening…" : "Open browser"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
