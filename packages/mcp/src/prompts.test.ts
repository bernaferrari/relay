import { InMemoryTransport } from "@modelcontextprotocol/server";
import assert from "node:assert/strict";
import test from "node:test";
import { relayMcpPromptNames, relayMcpPrompts } from "./prompts.js";
import { createMcpServer, type OperationInvoker } from "./server.js";

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

async function connectMcp() {
  const invoker: OperationInvoker = {
    async invoke(operationId) {
      throw new Error(`prompt test unexpectedly invoked ${operationId}`);
    },
  };
  const server = createMcpServer({ invoker, scope: { projectId } });
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
  assert.ok((initialized.result.capabilities as Record<string, unknown>).prompts);
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

test("lists the three curated Relay prompts with required scoped arguments", async () => {
  const session = await connectMcp();
  try {
    const response = await session.request("prompts/list", {});
    assert.equal(response.error, undefined);
    const prompts = response.result?.prompts as Array<Record<string, unknown>>;
    assert.deepEqual(
      prompts.map(({ name, title, description, arguments: args }) => ({
        name,
        title,
        description,
        arguments: (args as Array<Record<string, unknown>>).map(({ name, required }) => ({
          name,
          required,
        })),
      })),
      [
        {
          ...relayMcpPrompts[0],
          arguments: [
            { name: "projectId", required: true },
            { name: "targetId", required: true },
            { name: "journeyId", required: true },
          ],
        },
        {
          ...relayMcpPrompts[1],
          arguments: [
            { name: "projectId", required: true },
            { name: "targetId", required: true },
            { name: "journeyId", required: true },
            { name: "sessionId", required: true },
            { name: "connectionId", required: true },
          ],
        },
        {
          ...relayMcpPrompts[2],
          arguments: [
            { name: "projectId", required: true },
            { name: "targetId", required: true },
            { name: "journeyId", required: true },
            { name: "sessionId", required: true },
            { name: "takeId", required: true },
          ],
        },
      ],
    );
  } finally {
    await session.close();
  }
});

test("gets stable prompt snapshots with explicit Relay identities", async () => {
  const session = await connectMcp();
  const requests = [
    {
      name: relayMcpPromptNames.mapAppSafely,
      arguments: { projectId, targetId: "target-1", journeyId: "journey-1" },
      expected: {
        description: relayMcpPrompts[0].description,
        firstLine:
          "Map the app safely for project project-a, Target target-1, and Journey journey-1.",
        headings: [
          "Safety contract:",
          "Observation phase (no mutation):",
          "Mutation phase (only after explicit confirmation):",
        ],
      },
    },
    {
      name: relayMcpPromptNames.repairFailedConnection,
      arguments: {
        projectId,
        targetId: "target-1",
        journeyId: "journey-1",
        sessionId: "session-1",
        connectionId: "connection-1",
      },
      expected: {
        description: relayMcpPrompts[1].description,
        firstLine:
          "Repair connection connection-1 in Journey journey-1, project project-a, using Target target-1 and Authoring Session session-1.",
        headings: [
          "Safety contract:",
          "Observation and diagnosis (no mutation):",
          "Repair and proof (only after explicit confirmation):",
        ],
      },
    },
    {
      name: relayMcpPromptNames.reviewTake,
      arguments: {
        projectId,
        targetId: "target-1",
        journeyId: "journey-1",
        sessionId: "session-1",
        takeId: "take-1",
      },
      expected: {
        description: relayMcpPrompts[2].description,
        firstLine:
          "Review Take take-1 in Authoring Session session-1 for Journey journey-1, Target target-1, project project-a.",
        headings: [
          "Safety contract:",
          "Observation and review (no mutation):",
          "Refinement and decision (only after explicit confirmation):",
        ],
      },
    },
  ] as const;

  try {
    for (const request of requests) {
      const response = promptText(
        await session.request("prompts/get", {
          name: request.name,
          arguments: request.arguments,
        }),
      );
      assert.deepEqual(
        {
          description: response.description,
          firstLine: response.text.split("\n")[0],
          headings: response.text.split("\n").filter((line) => line.endsWith(":")),
        },
        request.expected,
      );
      for (const id of Object.values(request.arguments))
        assert.match(response.text, new RegExp(id));
    }
  } finally {
    await session.close();
  }
});

test("prompt snapshots preserve the observation, authority, and evidence safety boundary", async () => {
  const session = await connectMcp();
  const requests = [
    {
      name: relayMcpPromptNames.mapAppSafely,
      arguments: { projectId, targetId: "target-1", journeyId: "journey-1" },
    },
    {
      name: relayMcpPromptNames.repairFailedConnection,
      arguments: {
        projectId,
        targetId: "target-1",
        journeyId: "journey-1",
        sessionId: "session-1",
        connectionId: "connection-1",
      },
    },
    {
      name: relayMcpPromptNames.reviewTake,
      arguments: {
        projectId,
        targetId: "target-1",
        journeyId: "journey-1",
        sessionId: "session-1",
        takeId: "take-1",
      },
    },
  ] as const;

  try {
    for (const request of requests) {
      const { text } = promptText(
        await session.request("prompts/get", {
          name: request.name,
          arguments: request.arguments,
        }),
      );
      assert.match(text, /Observation.+\(no mutation\):/);
      assert.match(text, /explicit (?:user )?confirmation/i);
      assert.match(text, /confirm: true/);
      assert.match(text, /lease/i);
      assert.match(text, /revision/i);
      assert.match(text, /idempotency/i);
      assert.match(text, /Never escalate permissions/);
      assert.match(text, /Never read arbitrary filesystem paths/);
      assert.match(text, /relay:\/\//);
      assert.match(text, /relay_target_screenshot_capture/);
      assert.match(text, /native image\/png/);
      assert.doesNotMatch(text, /(?:permission|consent) is implied/i);
      assert.match(text, /never infer or manufacture consent/i);
      assert.match(text, /bypass a lease/i);
      assert.doesNotMatch(text, /file:\/\//);
    }
  } finally {
    await session.close();
  }
});

test("rejects missing, invalid, cross-project, and extra prompt arguments", async () => {
  const session = await connectMcp();
  const invalidArguments = [
    { projectId, targetId: "target-1" },
    { projectId, targetId: "../target", journeyId: "journey-1" },
    { projectId: "project-b", targetId: "target-1", journeyId: "journey-1" },
    { projectId, targetId: "target-1", journeyId: "journey-1", permission: "admin" },
  ];
  try {
    for (const argumentsValue of invalidArguments) {
      const response = await session.request("prompts/get", {
        name: relayMcpPromptNames.mapAppSafely,
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
