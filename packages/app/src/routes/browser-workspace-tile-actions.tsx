/** @jsxImportSource react */
import type { MouseEventHandler } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@relay/ui-react/components/dropdown-menu";
import { Circle, Maximize2, Minimize2, MoreHorizontal, X } from "lucide-react";
import type { BrowserTile } from "../data/browser-workspace";

export function BrowserWorkspaceTileActions({
  tile,
  focused,
  ready,
  onFocus,
  onRemove,
}: {
  tile: BrowserTile;
  focused: boolean;
  ready: boolean;
  onFocus: MouseEventHandler<HTMLButtonElement>;
  onRemove(): void;
}) {
  const search = {
    target: tile.browserId,
    ...(tile.identity?.authenticationFixtureId
      ? { account: tile.identity.authenticationFixtureId }
      : tile.identity?.signedOut
        ? { account: "" }
        : {}),
  };
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="gap-1.5 px-2 text-xs @max-[360px]:hidden"
        nativeButton={false}
        aria-label={`Record ${tile.name}`}
        disabled={!ready}
        render={<Link to="/tests/new" search={search} />}
      >
        <Circle className="size-2 fill-destructive text-destructive" aria-hidden="true" />
        <span className="@max-[380px]:hidden">Record</span>
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label={focused ? `Restore ${tile.name}` : `Expand ${tile.name}`}
        onClick={onFocus}
      >
        {focused ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-8 @max-[360px]:hidden"
        aria-label={`Remove ${tile.name} from workspace`}
        onClick={onRemove}
      >
        <X aria-hidden="true" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon"
              variant="ghost"
              className="size-8 @min-[360px]:hidden"
              aria-label={`Options for ${tile.name}`}
            />
          }
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!ready} render={<Link to="/tests/new" search={search} />}>
            <Circle aria-hidden="true" /> Record test
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRemove}>
            <X aria-hidden="true" /> Remove from workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
