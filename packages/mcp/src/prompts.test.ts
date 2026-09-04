import { InMemoryTransport } from "@modelcontextprotocol/server";
import type { OperationId } from "@relay/protocol";
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

test("lists the curated Relay prompts with required scoped arguments", async () => {
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
          name: relayMcpPrompts[0].name,
          title: relayMcpPrompts[0].title,
          description: relayMcpPrompts[0].description,
          arguments: [
            { name: "projectId", required: true },
            { name: "targetId", required: true },
            { name: "appMapId", required: true },
            { name: "actionBudget", required: false },
          ],
        },
        {
          name: relayMcpPrompts[1].name,
          title: relayMcpPrompts[1].title,
          description: relayMcpPrompts[1].description,
          arguments: [
            { name: "projectId", required: true },
            { name: "targetId", required: true },
            { name: "appMapId", required: true },
            { name: "sessionId", required: true },
            { name: "connectionId", required: true },
          ],
        },
        {
          name: relayMcpPrompts[2].name,
          title: relayMcpPrompts[2].title,
          description: relayMcpPrompts[2].description,
          arguments: [
            { name: "projectId", required: true },
            { name: "targetId", required: true },
            { name: "appMapId", required: true },
            { name: "sessionId", required: true },
            { name: "takeId", required: true },
          ],
        },
        {
          name: relayMcpPrompts[3].name,
          title: relayMcpPrompts[3].title,
          description: relayMcpPrompts[3].description,
          arguments: [
            { name: "projectId", required: true },
            { name: "targetId", required: true },
            { name: "appMapId", required: true },
            { name: "goal", required: true },
          ],
        },
        {
          name: relayMcpPrompts[4].name,
          title: relayMcpPrompts[4].title,
          description: relayMcpPrompts[4].description,
          arguments: [
            { name: "projectId", required: true },
            { name: "targetId", required: true },
            { name: "appMapId", required: true },
            { name: "testId", required: true },
            { name: "goal", required: true },
          ],
        },
        {
          name: relayMcpPrompts[5].name,
          title: relayMcpPrompts[5].title,
          description: relayMcpPrompts[5].description,
          arguments: [
            { name: "projectId", required: true },
            { name: "commitSha", required: false },
            { name: "changedFiles", required: false },
            { name: "appMapId", required: false },
          ],
        },
      ],
    );
  } finally {
    await session.close();
  }
});

test("every profile advertises only prompts whose required tools it exposes", async () => {
  assert.deepEqual(relayMcpPrompts[3].requiredOperationIds, [
    "target.screenshot.capture",
    "app-map.test.run",
    "app-map.combine.save",
    "app-map.combine.preflight",
    "lease.list",
    "lease.create",
    "job.combine.start",
    "job.combine.campaign.get",
    "job.combine.campaign.resume",
    "job.combine.campaign.cancel",
    "job.list",
    "job.get",
    "job.retry",
    "job.combine.export",
  ]);
  assert.equal(
    relayMcpPromptsForTools(relayMcpToolsForProfile("author")).some(
      ({ name }) => name === relayMcpPromptNames.planCombine,
    ),
    false,
  );
  assert.equal(
    relayMcpPromptsForTools(relayMcpToolsForProfile("test")).some(
      ({ name }) => name === relayMcpPromptNames.authorGraphTest,
    ),
    true,
  );

  for (const profile of relayMcpProfiles) {
    const tools = relayMcpToolsForProfile(profile);
    const toolIds = new Set<OperationId>(tools.map(({ operationId }) => operationId));
    const compatible = relayMcpPromptsForTools(tools);
    for (const descriptor of compatible) {
      assert.ok(
        descriptor.requiredOperationIds.every((operationId) => toolIds.has(operationId)),
        `${profile} advertised ${descriptor.name} without every required tool`,
      );
    }

    const session = await connectMcp(profile, compatible.length > 0);
    try {
      if (compatible.length === 0) continue;
      const response = await session.request("prompts/list", {});
      const prompts = response.result?.prompts as Array<{ name: string }>;
      assert.deepEqual(
        prompts.map(({ name }) => name),
        compatible.map(({ name }) => name),
      );
    } finally {
      await session.close();
    }
  }
});

test("gets stable prompt snapshots with explicit Relay identities", async () => {
  const session = await connectMcp();
  const requests = [
    {
      name: relayMcpPromptNames.mapAppSafely,
      arguments: { projectId, targetId: "target-1", appMapId: "map-1" },
      expected: {
        description: relayMcpPrompts[0].description,
        firstLine: "Map the app safely for project project-a, Target target-1, and App Map map-1.",
        headings: [
          "Safety contract:",
          "Observation phase (no mutation):",
          "Bounded exploration and proposal:",
        ],
      },
    },
    {
      name: relayMcpPromptNames.repairFailedConnection,
      arguments: {
        projectId,
        targetId: "target-1",
        appMapId: "map-1",
        sessionId: "session-1",
        connectionId: "connection-1",
      },
      expected: {
        description: relayMcpPrompts[1].description,
        firstLine:
          "Repair connection connection-1 in App Map map-1, project project-a, using Target target-1 and Authoring Session session-1.",
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
        appMapId: "map-1",
        sessionId: "session-1",
        takeId: "take-1",
      },
      expected: {
        description: relayMcpPrompts[2].description,
        firstLine:
          "Review Take take-1 in Authoring Session session-1 for App Map map-1, Target target-1, project project-a.",
        headings: [
          "Safety contract:",
          "Observation and review (no mutation):",
          "Refinement and decision (only after explicit confirmation):",
        ],
      },
    },
    {
      name: relayMcpPromptNames.planCombine,
      arguments: {
        projectId,
        targetId: "target-1",
        appMapId: "map-1",
        goal: "capture settings in every language",
      },
      expected: {
        description: relayMcpPrompts[3].description,
        firstLine:
          "Plan a Combine for “capture settings in every language” in App Map map-1, project project-a, using Target target-1.",
        headings: [
          "Safety contract:",
          "Observation and plan (no mutation):",
          "Save, preflight, and run (only after explicit confirmation):",
        ],
      },
    },
    {
      name: relayMcpPromptNames.authorGraphTest,
      arguments: {
        projectId,
        targetId: "target-1",
        appMapId: "map-1",
        testId: "checkout-smoke",
        goal: "submit an order and verify success",
      },
      expected: {
        description: relayMcpPrompts[4].description,
        firstLine:
          "Author graph Test checkout-smoke for “submit an order and verify success” in App Map map-1, project project-a, using Target target-1 only for an approved run.",
        headings: [
          "Safety contract:",
          "Read and design (no mutation):",
          "Create or propose (only after explicit confirmation):",
          "Run and evidence (only after separate run confirmation):",
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
      arguments: { projectId, targetId: "target-1", appMapId: "map-1" },
    },
    {
      name: relayMcpPromptNames.repairFailedConnection,
      arguments: {
        projectId,
        targetId: "target-1",
        appMapId: "map-1",
        sessionId: "session-1",
        connectionId: "connection-1",
      },
    },
    {
      name: relayMcpPromptNames.reviewTake,
      arguments: {
        projectId,
        targetId: "target-1",
        appMapId: "map-1",
        sessionId: "session-1",
        takeId: "take-1",
      },
    },
    {
      name: relayMcpPromptNames.planCombine,
      arguments: {
        projectId,
        targetId: "target-1",
        appMapId: "map-1",
        goal: "capture settings in every language",
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

test("mapping prompt turns one delegation into a bounded autonomous proposal", async () => {
  const session = await connectMcp();
  try {
    const { text } = promptText(
      await session.request("prompts/get", {
        name: relayMcpPromptNames.mapAppSafely,
        arguments: { projectId, targetId: "target-1", appMapId: "map-1", actionBudget: "7" },
      }),
    );
    assert.match(text, /at most 7 reversible Target interactions/);
    assert.match(text, /relay_discovery_start/);
    assert.match(text, /pending proposal/);
    assert.match(text, /Do not approve proposals/);
    assert.doesNotMatch(text, /YAML recipe/);
  } finally {
    await session.close();
  }
});

test("matrix prompt keeps App Map Combine execution behind the per-cell profile boundary", async () => {
  const session = await connectMcp();
  try {
    const { text } = promptText(
      await session.request("prompts/get", {
        name: relayMcpPromptNames.planCombine,
        arguments: {
          projectId,
          targetId: "target-1",
          appMapId: "map-1",
          goal: "run ten Settings screens across all locales",
        },
      }),
    );
    assert.match(text, /Variables and graph-native scenario Tests/);
    assert.match(text, /relay_app_map_combine_preflight/);
    assert.match(text, /--in language=ja,pt/);
    assert.match(text, /--lens visual/);
    assert.match(text, /relay_app_map_test_run/);
    assert.match(text, /relay_job_combine_start/);
    assert.match(text, /App Language destinations that open OS Settings/);
    assert.match(text, /portable screenshot report/);
  } finally {
    await session.close();
  }
});

test("graph Test prompt keeps authoring, compilation, execution, and evidence in one profile", async () => {
  const session = await connectMcp("test");
  try {
    const { text } = promptText(
      await session.request("prompts/get", {
        name: relayMcpPromptNames.authorGraphTest,
        arguments: {
          projectId,
          targetId: "target-1",
          appMapId: "map-1",
          testId: "checkout-smoke",
          goal: "submit an order and verify success",
        },
      }),
    );
    assert.match(text, /tests\/checkout-smoke\/outline/);
    assert.match(
      text,
      /instruction, validation, extraction, manual, module, decision, loop, or script/,
    );
    assert.match(text, /relay_app_map_test_propose/);
    assert.match(text, /relay_app_map_test_compile/);
    assert.match(text, /relay_app_map_test_run/);
    assert.match(text, /expectedRevision/);
    assert.match(text, /relay_run_evidence_get/);
    assert.match(text, /repair the source Test/);
    assert.match(text, /do not replace the whole Test or approve your own proposal/i);
  } finally {
    await session.close();
  }
});

test("verify-change prompt renders the proof loop with commit and file scope", async () => {
  const session = await connectMcp("proof");
  try {
    const { description, text } = promptText(
      await session.request("prompts/get", {
        name: relayMcpPromptNames.verifyChange,
        arguments: {
          projectId,
          commitSha: "9a1c2e4b7d8f0a3b5c6d7e8f9a0b1c2d3e4f5a6b",
          changedFiles: "packages/app-v2/src/checkout.ts\npackages/core/src/cart.ts",
          appMapId: "map-1",
        },
      }),
    );
    assert.equal(description, relayMcpPrompts[5].description);
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
  const session = await connectMcp("proof");
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
    { projectId, targetId: "target-1" },
    { projectId, targetId: "../target", appMapId: "map-1" },
    { projectId: "project-b", targetId: "target-1", appMapId: "map-1" },
    { projectId, targetId: "target-1", appMapId: "map-1", permission: "admin" },
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
