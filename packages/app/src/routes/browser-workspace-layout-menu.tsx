/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@relay/ui-react/components/dropdown-menu";
import { Columns2, Rows2, Grid2X2, PanelsTopLeft } from "lucide-react";
import { arrangeBrowsers, type BrowserLayout } from "../data/browser-workspace-layout";

export function BrowserWorkspaceLayoutMenu({
  ids,
  disabled,
  onSelect,
}: {
  ids: string[];
  disabled: boolean;
  onSelect(layout: BrowserLayout, animate: boolean): void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            disabled={disabled || ids.length < 2}
            aria-label="Arrange browsers"
          />
        }
      >
        <PanelsTopLeft aria-hidden="true" /> Layout
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(
          [
            { id: "grid", label: "Grid", icon: Grid2X2 },
            { id: "columns", label: "Side by side", icon: Columns2 },
            { id: "rows", label: "Stacked", icon: Rows2 },
          ] as const
        ).map((item) => (
          <DropdownMenuItem
            key={item.id}
            onClick={(event) => {
              const layout = arrangeBrowsers(ids, item.id);
              if (layout) onSelect(layout, event.detail > 0);
            }}
          >
            <item.icon aria-hidden="true" />
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
