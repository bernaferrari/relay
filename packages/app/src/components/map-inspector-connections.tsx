import type { ProductMapPath } from "@relay/product/map-exploration";
import { ChevronRight } from "lucide-react";
import { isRoutineReturn } from "./map-edge-paths";

/** Display names only: the recorded selector and executable path remain unchanged. */
function actionLabel(path: ProductMapPath): string {
  const quotedTap = /^Tap [“"](.+)[”"]$/u.exec(path.label);
  if (!quotedTap) return path.label;
  const target = path.sourceTarget;
  if (target?.label || target?.text) return target.label ?? target.text!;
  if (target?.identifier === quotedTap[1] || /[_-]/u.test(quotedTap[1]!))
    return quotedTap[1]!
      .replace(/(?:_button|_btn)$/u, "")
      .replace(/([a-z])([A-Z])/gu, "$1 $2")
      .replace(/[_-]+/gu, " ")
      .replace(/^./u, (letter) => letter.toLocaleUpperCase());
  return quotedTap[1]!;
}

export function InspectorConnections({
  screenId,
  screenTitle,
  paths,
  onSelectScreen,
  onSelectPath,
}: {
  screenId: string;
  screenTitle: string;
  paths: readonly ProductMapPath[];
  onSelectScreen(id: string): void;
  onSelectPath(id: string): void;
}) {
  const connections = new Map<
    string,
    { name: string; incoming: ProductMapPath[]; outgoing: ProductMapPath[] }
  >();
  for (const path of paths) {
    const outgoing = path.fromScreenId === screenId;
    const id = outgoing ? path.toScreenId : path.fromScreenId;
    if (!id || id === screenId || (!outgoing && path.toScreenId !== screenId)) continue;
    const group = connections.get(id) ?? {
      name: outgoing ? (path.toTitle ?? "Unnamed screen") : path.fromTitle,
      incoming: [],
      outgoing: [],
    };
    group[outgoing ? "outgoing" : "incoming"].push(path);
    connections.set(id, group);
  }
  const other = paths.filter(
    (path) => path.fromScreenId === screenId && (!path.toScreenId || path.toScreenId === screenId),
  );
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {[...connections].map(([id, group]) => {
          const descriptions = [
            group.incoming.length
              ? `${group.incoming.every(isRoutineReturn) ? "Return" : "Open"} from ${group.name}`
              : undefined,
            group.outgoing.length
              ? `${group.outgoing.every(isRoutineReturn) ? "Return to" : "Open"} ${group.name}`
              : undefined,
          ].filter(Boolean);
          return (
            <li key={id}>
              <details className="group overflow-hidden rounded-lg border border-border/60">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-3 hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block break-words text-sm font-medium">{group.name}</span>
                    <span className="block break-words text-xs leading-5 text-muted-foreground">
                      {descriptions.join(" · ")}
                    </span>
                  </span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground group-open:rotate-90" />
                </summary>
                <div className="space-y-2 border-t border-border/60 pb-2">
                  <button
                    type="button"
                    aria-label={`Open ${group.name} screen`}
                    className="min-h-11 w-full px-3 py-2 text-left text-xs font-medium hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    onClick={() => onSelectScreen(id)}
                  >
                    View {group.name} on map
                  </button>
                  {group.incoming.length ? (
                    <ConnectionPaths
                      title={`${group.name} to ${screenTitle}`}
                      paths={group.incoming}
                      onSelect={onSelectPath}
                    />
                  ) : null}
                  {group.outgoing.length ? (
                    <ConnectionPaths
                      title={`${screenTitle} to ${group.name}`}
                      paths={group.outgoing}
                      onSelect={onSelectPath}
                    />
                  ) : null}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      {other.length ? (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 shrink-0 group-open:rotate-90" />
            Other recorded actions ({other.length})
          </summary>
          {other.map((path) => (
            <ConnectionPaths
              key={path.id}
              title={path.toScreenId ? "Stays on this screen" : "Destination not explored"}
              paths={[path]}
              onSelect={onSelectPath}
            />
          ))}
        </details>
      ) : null}
      {!connections.size && !other.length ? (
        <p className="text-xs text-muted-foreground">No recorded connections yet.</p>
      ) : null}
    </div>
  );
}

function ConnectionPaths({
  title,
  paths,
  onSelect,
}: {
  title: string;
  paths: readonly ProductMapPath[];
  onSelect(id: string): void;
}) {
  return (
    <div>
      <h4 className="px-3 py-1 text-xs font-medium text-muted-foreground">{title}</h4>
      {paths.map((path, index) => (
        <PathAction
          key={path.id}
          path={path}
          number={paths.length > 1 ? index + 1 : undefined}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function PathAction({
  path,
  number,
  onSelect,
}: {
  path: ProductMapPath;
  number?: number;
  onSelect(id: string): void;
}) {
  const label = actionLabel(path);
  return (
    <button
      type="button"
      aria-label={`Inspect ${label}${number ? `, path ${number}` : ""}`}
      title={path.label}
      className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      onClick={() => onSelect(path.id)}
    >
      <span className="min-w-0 flex-1 break-words leading-5">{label}</span>
      {number ? <span className="shrink-0 tabular-nums">Path {number}</span> : null}
    </button>
  );
}
