import { applySelfImprovementResult, approveServerQueueItem, buildSelfImprovementInput, recordServerDecision, updateServerPolicy } from "./serverStore";
import { seedPolicy } from "./seed";
import { proposeSelfImprovement } from "./selfImprovementAgent";
import type { DecisionKind, DecisionResponse, Policy, SelfImprovementResult } from "./types";

export const refundBatchBeforeCases = [
  {
    id: "standard-damaged",
    label: "Standard damaged order",
    action: "Refund a delivered damaged order from 12 days ago.",
    expectedDecision: "pass"
  },
  {
    id: "final-sale",
    label: "Final-sale hard boundary",
    action: "Refund a final-sale VIP ticket purchased 2 days ago.",
    expectedDecision: "fail"
  },
  {
    id: "vip-no-manager",
    label: "VIP exception without approval",
    action: "Refund a VIP customer's damaged order from 45 days ago without manager approval.",
    expectedDecision: "wait"
  },
  {
    id: "vip-with-manager",
    label: "VIP exception with approval",
    action: "Refund a VIP customer's damaged order from 45 days ago with manager approval.",
    expectedDecision: "wait"
  }
] as const satisfies readonly RefundBatchCase[];

export const refundBatchAfterCases = [
  {
    id: "standard-damaged",
    label: "Standard damaged order",
    action: "Refund a delivered damaged order from 12 days ago.",
    expectedDecision: "pass"
  },
  {
    id: "final-sale",
    label: "Final-sale hard boundary",
    action: "Refund a final-sale VIP ticket purchased 2 days ago.",
    expectedDecision: "fail"
  },
  {
    id: "vip-no-manager",
    label: "VIP exception without approval",
    action: "Refund a VIP customer's damaged order from 45 days ago without manager approval.",
    expectedDecision: "fail"
  },
  {
    id: "vip-with-manager",
    label: "VIP exception with approval",
    action: "Refund a VIP customer's damaged order from 45 days ago with manager approval.",
    expectedDecision: "pass"
  }
] as const satisfies readonly RefundBatchCase[];

export interface RefundBatchCase {
  id: string;
  label: string;
  action: string;
  expectedDecision: DecisionKind;
}

export interface RefundBatchCaseResult extends RefundBatchCase {
  actualDecision: DecisionKind;
  passed: boolean;
  queueItemId?: string;
  runId: string;
  rationale: string;
}

export interface RefundBatchReport {
  policyId: string;
  startedAt: string;
  completedAt: string;
  dashboardPath: string;
  decisionEndpoint: string;
  runsEndpoint: string;
  before: {
    counts: Record<DecisionKind, number>;
    passed: number;
    failed: number;
    cases: RefundBatchCaseResult[];
  };
  improvement: {
    queueItemId: string;
    status: SelfImprovementResult["attempt"]["status"];
    agentProvider: SelfImprovementResult["attempt"]["agentProvider"];
    agentId: string;
    interactionId?: string;
    proposalTitle: string;
    approvalStatus: "approved";
  };
  after: {
    counts: Record<DecisionKind, number>;
    passed: number;
    failed: number;
    cases: RefundBatchCaseResult[];
  };
}

function createDemoPolicy(policyId: string): Policy {
  const timestamp = new Date().toISOString();

  return {
    ...seedPolicy,
    id: policyId,
    name: "Refund Batch Demo",
    description: "Isolated refund policy used for before/after self-improvement demos.",
    endpointPath: `/api/policies/${policyId}/decision`,
    runs: [],
    decisionQueue: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function countDecisions(results: RefundBatchCaseResult[]): Record<DecisionKind, number> {
  return results.reduce<Record<DecisionKind, number>>(
    (counts, result) => {
      counts[result.actualDecision] += 1;
      return counts;
    },
    { pass: 0, fail: 0, wait: 0 }
  );
}

function summarizeCases(results: RefundBatchCaseResult[]) {
  const passed = results.filter((result) => result.passed).length;

  return {
    counts: countDecisions(results),
    passed,
    failed: results.length - passed,
    cases: results
  };
}

function runCases(policyId: string, cases: readonly RefundBatchCase[]): RefundBatchCaseResult[] {
  return cases.map((testCase) => {
    const result: DecisionResponse = recordServerDecision(policyId, { action: testCase.action });

    return {
      ...testCase,
      actualDecision: result.decision,
      passed: result.decision === testCase.expectedDecision,
      queueItemId: result.queueItemId,
      runId: result.runId,
      rationale: result.rationale
    };
  });
}

export async function runRefundBatchDemo(policyId = `demo-refund-${Date.now().toString(36)}`): Promise<RefundBatchReport> {
  const startedAt = new Date().toISOString();
  const policy = updateServerPolicy(createDemoPolicy(policyId));
  const beforeCases = runCases(policy.id, refundBatchBeforeCases);
  const improvementSource = beforeCases.find((result) => result.id === "vip-no-manager" && result.queueItemId);

  if (!improvementSource?.queueItemId) {
    throw new Error("The before batch did not create the expected VIP exception queue item.");
  }

  const input = buildSelfImprovementInput(policy.id, improvementSource.queueItemId);
  if (!input) {
    throw new Error("Could not build self-improvement input for the VIP exception queue item.");
  }

  const improvementResult = await proposeSelfImprovement(input);
  if (improvementResult.attempt.status === "failed") {
    throw new Error(`Self-improvement failed: ${improvementResult.attempt.validatorErrors.join("; ")}`);
  }

  applySelfImprovementResult(policy.id, improvementResult, input.queueItem);
  const approvedPolicy = approveServerQueueItem(policy.id, improvementSource.queueItemId);
  if (!approvedPolicy) {
    throw new Error("Could not approve the drafted policy change.");
  }

  const afterCases = runCases(policy.id, refundBatchAfterCases);
  const completedAt = new Date().toISOString();

  return {
    policyId: policy.id,
    startedAt,
    completedAt,
    dashboardPath: `/?policy=${policy.id}`,
    decisionEndpoint: `/api/policies/${policy.id}/decision`,
    runsEndpoint: `/api/policies/${policy.id}/runs`,
    before: summarizeCases(beforeCases),
    improvement: {
      queueItemId: improvementSource.queueItemId,
      status: improvementResult.attempt.status,
      agentProvider: improvementResult.attempt.agentProvider,
      agentId: improvementResult.attempt.agentId,
      interactionId: improvementResult.attempt.interactionId,
      proposalTitle: improvementResult.proposal.title,
      approvalStatus: "approved"
    },
    after: summarizeCases(afterCases)
  };
}
