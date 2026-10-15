"use client";

import { useState, type CSSProperties } from "react";
import { CopyExampleCommand } from "./site-controls";

const cli = [
  { cmd: 'pnpm relay run "Member layout" --device browser', note: "rerun the saved Test" },
  { cmd: "echo $?", note: "1 = a Test failed its expectation" },
  { cmd: "pnpm relay inspect <run-id>", note: "expected vs saw, step by step" },
  { cmd: 'pnpm relay run "Member layout" --device browser', note: "repair, then repeat" },
];

const mcp = `{
  "mcpServers": {
    "relay": {
      "command": "node",
      "args": [
        "/path/to/relay/packages/mcp/dist/relay-mcp.js",
        "--server", "http://127.0.0.1:8787",
        "--credential-source", "none",
        "--profile", "qa"
      ]
    }
  }
}`;

export function AgentConsole() {
  const [tab, setTab] = useState<"cli" | "mcp">("cli");
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-xl">
      <div className="flex items-center justify-between border-b border-white/10 py-1.5 ps-2 pe-1">
        <div role="group" aria-label="Interface" className="flex gap-1">
          {(
            [
              ["cli", "CLI"],
              ["mcp", "MCP"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
              className={`h-9 rounded-md px-3 font-mono text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ribbon-orange ${tab === id ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="[&_button]:text-white/60 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
          <CopyExampleCommand text={tab === "cli" ? cli.map((line) => line.cmd).join("\n") : mcp} />
        </span>
      </div>
      {tab === "cli" ? (
        <ol className="space-y-4 overflow-x-auto p-5 font-mono text-xs leading-relaxed">
          {cli.map((line, i) => (
            <li
              key={i}
              className="animate-(--line-animation)"
              style={{ "--line-animation": `var(--animate-reveal) ${i * 70}ms` } as CSSProperties}
            >
              <p className="text-white/40"># {line.note}</p>
              <p className="whitespace-nowrap text-white">
                <span className="mr-2 select-none text-ribbon-orange">$</span>
                {line.cmd}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <pre className="animate-reveal overflow-x-auto p-5 font-mono text-xs leading-relaxed text-white/85">
          <code>{mcp}</code>
        </pre>
      )}
    </div>
  );
}
