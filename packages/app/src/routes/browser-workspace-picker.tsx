/** @jsxImportSource react */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
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
  const [account, setAccount] = useState("current");
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
  const selectClass =
    "h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !add.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>Add browser</DialogTitle>
        <DialogDescription>Each profile keeps its own cookies and sign-in.</DialogDescription>
        <div className="flex gap-2" role="group" aria-label="Profile source">
          <Button
            variant={creating ? "ghost" : "secondary"}
            aria-pressed={!creating}
            disabled={!available.length || add.isPending}
            onClick={() => {
              setCreating(false);
              add.reset();
            }}
          >
            Existing profile
          </Button>
          <Button
            variant={creating ? "secondary" : "ghost"}
            aria-pressed={creating}
            disabled={add.isPending}
            onClick={() => {
              setCreating(true);
              add.reset();
            }}
          >
            New profile
          </Button>
        </div>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!add.isPending) add.mutate();
          }}
        >
          {creating ? (
            <>
              <label className="grid gap-1.5 text-sm font-medium">
                Profile name
                <Input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Admin"
                  disabled={add.isPending}
                  required
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Website
                <Input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://your-app.com"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={add.isPending}
                  required
                />
              </label>
            </>
          ) : (
            <>
              <label className="grid gap-1.5 text-sm font-medium">
                Profile
                <select
                  className={selectClass}
                  value={browserId}
                  disabled={add.isPending}
                  onChange={(event) => {
                    setBrowserId(event.target.value);
                    setAccount("current");
                  }}
                >
                  {available.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Account
                <select
                  className={selectClass}
                  value={account}
                  disabled={add.isPending}
                  onChange={(event) => setAccount(event.target.value)}
                >
                  <option value="current">Keep current session</option>
                  <option value="signed-out">Signed out</option>
                  {validFixtures.map((fixture) => (
                    <option key={fixture.reference} value={fixture.reference}>
                      {fixture.name}
                    </option>
                  ))}
                </select>
              </label>
              {fixtures.error ? (
                <p className="text-sm text-destructive" role="alert">
                  Couldn’t load saved sign-ins.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void fixtures.refetch()}
                  >
                    Try again
                  </button>
                </p>
              ) : null}
            </>
          )}
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
