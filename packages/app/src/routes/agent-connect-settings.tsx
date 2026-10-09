/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { SettingsGroup } from "./settings-frame";

const MCP_JSON = `{
  "mcpServers": {
    "relay": {
      "command": "relay-mcp",
      "args": ["--profile", "qa"]
    }
  }
}`;

const AGENTS: readonly { name: string; detail: string; command: string }[] = [
  {
    name: "Claude Code",
    detail: "Run once in your project.",
    command: "claude mcp add relay -- relay-mcp --profile qa",
  },
  {
    name: "Codex",
    detail: "Run once on this computer.",
    command: "codex mcp add relay -- relay-mcp --profile qa",
  },
  {
    name: "Cursor and other MCP clients",
    detail: "Add this to the client’s MCP settings.",
    command: MCP_JSON,
  },
  {
    name: "Check the connection",
    detail: "Prints READY when your agent can reach Relay.",
    command: "relay-mcp doctor --profile qa",
  },
];

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative min-w-0">
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 py-2.5 pr-12 pl-3 font-mono text-xs leading-5 text-foreground">
        {value}
      </pre>
      <Button
        size="icon-sm"
        variant="ghost"
        className="absolute top-1.5 right-1.5"
        aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
          });
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
    </div>
  );
}

/** Give a coding agent Relay's devices and evidence through MCP. */
export function AgentConnectSettings() {
  return (
    <SettingsGroup title="Coding agents">
      <p className="pb-3 text-sm leading-5 text-muted-foreground">
        Let your coding agent record, run, and check tests on your devices. It needs the{" "}
        <code className="font-mono text-xs">relay-mcp</code> command on this computer.
      </p>
      <div className="grid min-w-0 gap-4">
        {AGENTS.map((agent) => (
          <div key={agent.name} className="grid min-w-0 gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <h3 className="text-sm font-medium">{agent.name}</h3>
              <span className="text-xs text-muted-foreground">{agent.detail}</span>
            </div>
            <CopyBlock label={`${agent.name} setup`} value={agent.command} />
          </div>
        ))}
      </div>
    </SettingsGroup>
  );
}
