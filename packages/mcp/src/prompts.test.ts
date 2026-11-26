import { InMemoryTransport } from "@modelcontextprotocol/server";
import assert from "node:assert/strict";
import test from "node:test";
import { relayMcpPromptNames, relayMcpPrompts, relayMcpPromptsForTools } from "./prompts.js";
import { createMcpServer, type OperationInvoker } from "./server.js";
import { relayMcpProfiles, relayMcpToolsForProfile, type RelayMcpProfile } from "./tools.js";

type RpcResponse = {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
};

type PromptMessage = {
  role: string;
  content: { type: string; text: string };
};

const projectId = "project-a";

async function connectMcp(profile: RelayMcpProfile = "full", expectPrompts = true) {
  const invoker: OperationInvoker = {
    async invoke(operationId) {
      throw new Error(`prompt test unexpectedly invoked ${operationId}`);
    },
  };
  const server = createMcpServer({ invoker, scope: { projectId }, profile });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<
    number,
    { resolve: (response: RpcResponse) => void; reject: (error: Error) => void }
  >();
  let nextId = 0;

  clientTransport.onmessage = (message) => {
    if (!("id" in message) || typeof message.id !== "number") return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    waiter.resolve(message as RpcResponse);
  };
  clientTransport.onerror = (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  const request = async (method: string, params: Record<string, unknown>) => {
    const id = ++nextId;
    const response = new Promise<RpcResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    await clientTransport.send({ jsonrpc: "2.0", id, method, params } as never);
    return response;
  };

  await server.connect(serverTransport);
  await clientTransport.start();
  const initialized = await request("initialize", {
    protocolVersion: "2026-07-28",
    capabilities: {},
    clientInfo: { name: "relay-prompt-test", version: "0.1.0" },
  });
  assert.equal(initialized.error, undefined);
  assert.ok(initialized.result);
  const promptCapability = (initialized.result.capabilities as Record<string, unknown>).prompts;
  if (expectPrompts) assert.ok(promptCapability);
  else assert.equal(promptCapability, undefined);
  await clientTransport.send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  } as never);

  return {
    request,
    async close() {
      await Promise.allSettled([server.close(), clientTransport.close()]);
    },
  };
}

function promptText(response: RpcResponse): { description: string; text: string } {
  assert.equal(response.error, undefined);
  assert.ok(response.result);
  const messages = response.result.messages as PromptMessage[];
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, "user");
  assert.equal(messages[0]?.content.type, "text");
  return {
    description: String(response.result.description),
    text: messages[0]!.content.text,
  };
}

test("only full advertises the scoped Change Proof prompt", async () => {
  for (const profile of relayMcpProfiles) {
    const tools = relayMcpToolsForProfile(profile);
    const compatible = relayMcpPromptsForTools(tools);
    assert.equal(compatible.length, profile === "full" ? 1 : 0);
    const session = await connectMcp(profile, profile === "full");
    try {
      if (profile !== "full") continue;
      const response = await session.request("prompts/list", {});
      assert.equal(response.error, undefined);
      const prompts = response.result?.prompts as Array<{ name: string }>;
      assert.deepEqual(
        prompts.map(({ name }) => name),
        [relayMcpPromptNames.verifyChange],
      );
      const listed = await session.request("tools/list", {});
      assert.ok(Array.isArray(listed.result?.tools));
      const registered = new Set(
        (listed.result.tools as Array<{ name: string }>).map(({ name }) => name),
      );
      const rendered = promptText(
        await session.request("prompts/get", {
          name: relayMcpPromptNames.verifyChange,
          arguments: { projectId },
        }),
      );
      for (const name of rendered.text.match(/\brelay_[a-z_]+\b/gu) ?? []) {
        assert.ok(registered.has(name), name);
      }
    } finally {
      await session.close();
    }
  }
});

test("verify-change prompt renders the proof loop with commit and file scope", async () => {
  const session = await connectMcp("full");
  try {
    const { description, text } = promptText(
      await session.request("prompts/get", {
        name: relayMcpPromptNames.verifyChange,
        arguments: {
          projectId,
          commitSha: "9a1c2e4b7d8f0a3b5c6d7e8f9a0b1c2d3e4f5a6b",
          changedFiles: "packages/app/src/checkout.ts\npackages/core/src/cart.ts",
          appMapId: "map-1",
        },
      }),
    );
    assert.equal(description, relayMcpPrompts[0].description);
    assert.match(text, /at commit 9a1c2e4b7d8f0a3b5c6d7e8f9a0b1c2d3e4f5a6b/);
    assert.match(text, /restricted to App Map map-1/);
    assert.match(text, /provided changed-file list.*2 files/);
    assert.match(text, /relay_app_map_diff_impact/);
    assert.match(text, /relay_proof_start/);
    assert.match(text, /relay_proof_list/);
    assert.match(text, /relay_proof_inspect/);
    assert.match(text, /relay_proof_plan_approve/);
    assert.match(text, /relay_proof_run exactly once/);
    assert.match(text, /wait: true/);
    assert.match(text, /relay_proof_continue/);
    assert.match(text, /relay_proof_cancel/);
    assert.match(text, /relay_proof_rerun_affected/);
    assert.match(text, /relay_proof_publication_retry/);
    assert.match(text, /exact publication id.*immutable Proof version/i);
    assert.match(text, /relay_workspace_change_inspect/);
    assert.match(
      text,
      /sourceRevision \{vcs: "git", sha: "9a1c2e4b7d8f0a3b5c6d7e8f9a0b1c2d3e4f5a6b"\}/,
    );
    assert.match(text, /Establish impact/);
    assert.match(text, /restored tabs.*never choose the change/i);
    assert.match(text, /smallest set of saved graph Tests/);
    assert.match(text, /server-owned coordinator/);
    assert.match(text, /durable proof and execution summary/);
    assert.match(text, /record-runs/);
    assert.doesNotMatch(text, /relay_app_map_test_run/);
    assert.doesNotMatch(text, /relay_job_get/);
    assert.match(text, /relay_run_story_get/);
    assert.match(text, /repair-proposals/);
    assert.match(text, /relay_run_repair_list/);
    assert.match(text, /failure digest/);
    assert.match(text, /verdict passed \| product-failure \| harness-failure \| uncertain/);
    assert.match(text, /relay_run_share_create/);
    assert.match(text, /Rerun only the affected flows after a fix/);
    assert.match(text, /Never weaken a check to make it pass/);
    assert.doesNotMatch(text, /campaign/i);
  } finally {
    await session.close();
  }
});

test("verify-change prompt renders without optional scope arguments", async () => {
  const session = await connectMcp("full");
  try {
    const { text } = promptText(
      await session.request("prompts/get", {
        name: relayMcpPromptNames.verifyChange,
        arguments: { projectId },
      }),
    );
    assert.doesNotMatch(text, /at commit/);
    assert.match(text, /server-owned changed-file list/);
    assert.match(text, /relay_app_map_diff_impact/);
  } finally {
    await session.close();
  }
});

test("rejects missing, invalid, cross-project, and extra prompt arguments", async () => {
  const session = await connectMcp();
  const invalidArguments = [
    {},
    { projectId, appMapId: "../map" },
    { projectId: "project-b" },
    { projectId, permission: "admin" },
  ];
  try {
    for (const argumentsValue of invalidArguments) {
      const response = await session.request("prompts/get", {
        name: relayMcpPromptNames.verifyChange,
        arguments: argumentsValue,
      });
      assert.ok(response.error);
      assert.equal(response.result, undefined);
      assert.equal(response.error.code, -32602);
      assert.doesNotMatch(response.error.message, /token|credential|filesystem path/i);
    }
  } finally {
    await session.close();
  }
});
