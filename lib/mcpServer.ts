import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import {
  applySelfImprovementResult,
  approveServerQueueItem,
  buildSelfImprovementInput,
  getServerQueue,
  getServerRuns,
  recordSelfImprovementAttempt,
  recordServerDecision
} from "./serverStore";
import { proposeSelfImprovement } from "./selfImprovementAgent";

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: message
      }
    ]
  };
}

export function createOpsGymMcpServer() {
  const server = new McpServer({
    name: "opsgym-policy-tools",
    version: "0.1.0"
  });

  server.registerTool(
    "decide_policy",
    {
      title: "Decide Policy",
      description:
        "Evaluate a natural-language operation against an OpsGym policy. This records a policy run and may create a decision queue item when the result is wait.",
      inputSchema: {
        policyId: z.string().min(1).describe("OpsGym policy ID, for example refund-policy."),
        action: z.string().min(1).describe("Natural-language operation to evaluate."),
        context: z.record(z.string(), z.unknown()).optional().describe("Optional structured context for the decision.")
      }
    },
    async ({ policyId, action, context }) => jsonResult(recordServerDecision(policyId, { action, context }))
  );

  server.registerTool(
    "get_policy_runs",
    {
      title: "Get Policy Runs",
      description: "Read recent runs and queue items for an OpsGym policy. This tool does not mutate policy state.",
      inputSchema: {
        policyId: z.string().min(1).describe("OpsGym policy ID."),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum runs and queue items to return.")
      }
    },
    async ({ policyId, limit = 20 }) => jsonResult({
      runs: getServerRuns(policyId).slice(0, limit),
      decisionQueue: getServerQueue(policyId).slice(0, limit)
    })
  );

  server.registerTool(
    "draft_policy_improvement",
    {
      title: "Draft Policy Improvement",
      description:
        "Ask the configured self-improvement agent to draft a reviewer-safe policy amendment for an open queue item. This stores a pending proposal but does not approve it.",
      inputSchema: {
        policyId: z.string().min(1).describe("OpsGym policy ID."),
        queueItemId: z.string().min(1).describe("Open decision queue item ID.")
      }
    },
    async ({ policyId, queueItemId }) => {
      const input = buildSelfImprovementInput(policyId, queueItemId);
      if (!input) return errorResult("Queue item was not found.");

      const result = await proposeSelfImprovement(input);
      if (result.attempt.status === "failed") {
        recordSelfImprovementAttempt(result.attempt);
        return errorResult(`Self-improvement agent failed: ${result.attempt.validatorErrors.join("; ")}`);
      }

      const policy = applySelfImprovementResult(policyId, result, input.queueItem);
      return jsonResult({ policy, result });
    }
  );

  server.registerTool(
    "approve_policy_change",
    {
      title: "Approve Policy Change",
      description:
        "Approve a pending OpsGym queue item proposal. This mutates live policy text and resolves the queue item, so use it only after explicit user approval.",
      inputSchema: {
        policyId: z.string().min(1).describe("OpsGym policy ID."),
        queueItemId: z.string().min(1).describe("Decision queue item ID to approve.")
      }
    },
    async ({ policyId, queueItemId }) => {
      const policy = approveServerQueueItem(policyId, queueItemId);
      if (!policy) return errorResult("Queue item was not found.");

      return jsonResult(policy);
    }
  );

  return server;
}
