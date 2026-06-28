import { buildQueueItem, buildRun, evaluateDecision } from "./policyEngine";
import { cloneSeedPolicies } from "./seed";
import type {
  DecisionQueueItem,
  DecisionRequest,
  DecisionResponse,
  Policy,
  SelfImprovementAttempt,
  SelfImprovementInput,
  SelfImprovementResult
} from "./types";

const globalStore = globalThis as typeof globalThis & {
  __opsgymPolicies?: Map<string, Policy>;
  __opsgymSelfImprovementAttempts?: SelfImprovementAttempt[];
};

const policies = globalStore.__opsgymPolicies ?? new Map<string, Policy>();
globalStore.__opsgymPolicies = policies;

const selfImprovementAttempts = globalStore.__opsgymSelfImprovementAttempts ?? [];
globalStore.__opsgymSelfImprovementAttempts = selfImprovementAttempts;

function normalizeEndpointPath(id: string) {
  return `/api/policies/${id}/decision`;
}

function fallbackPolicy(id: string): Policy {
  const createdAt = new Date().toISOString();

  return {
    id,
    name: id
      .split("-")
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
      .join(" ") || "Policy",
    description: "Policy-backed decision endpoint.",
    policy:
      "Wait when the policy does not contain enough information to make a safe Pass or Fail decision.",
    principles: [
      {
        id: "principle-default",
        title: "Prefer safe decisions",
        body: "When policy coverage is unclear, wait for review instead of guessing."
      }
    ],
    endpointPath: normalizeEndpointPath(id),
    runs: [],
    decisionQueue: [],
    createdAt,
    updatedAt: createdAt
  };
}

function ensureSeeded() {
  if (policies.size === 0) {
    const seeded = cloneSeedPolicies();
    for (const p of seeded) {
      policies.set(p.id, p);
    }
  }
}

export function getServerPolicy(id: string): Policy {
  ensureSeeded();

  const existing = policies.get(id);
  if (existing) return existing;

  const created = fallbackPolicy(id);
  policies.set(id, created);
  return created;
}

export function updateServerPolicy(policyRecord: Policy): Policy {
  const existing = getServerPolicy(policyRecord.id);
  const updated = {
    ...policyRecord,
    endpointPath: normalizeEndpointPath(policyRecord.id),
    runs: (policyRecord.runs && policyRecord.runs.length > 0) ? policyRecord.runs : existing.runs,
    decisionQueue: (policyRecord.decisionQueue && policyRecord.decisionQueue.length > 0) ? policyRecord.decisionQueue : existing.decisionQueue,
    updatedAt: new Date().toISOString()
  };

  policies.set(policyRecord.id, updated);
  return updated;
}

export function recordServerDecision(policyId: string, request: DecisionRequest): DecisionResponse {
  const policyRecord = getServerPolicy(policyId);
  const result = evaluateDecision(policyRecord, request);
  const run = buildRun(policyId, request, result, "api");
  const queueItem = run.decision === "wait" ? buildQueueItem(policyId, run) : null;
  const runWithQueue = queueItem ? { ...run, queueItemId: queueItem.id } : run;

  policies.set(policyId, {
    ...policyRecord,
    runs: [runWithQueue, ...policyRecord.runs].slice(0, 100),
    decisionQueue: queueItem ? [queueItem, ...policyRecord.decisionQueue] : policyRecord.decisionQueue,
    updatedAt: new Date().toISOString()
  });

  return {
    runId: runWithQueue.id,
    policyId,
    action: runWithQueue.action,
    queueItemId: runWithQueue.queueItemId,
    queueItem: queueItem ?? undefined,
    createdAt: runWithQueue.createdAt,
    decision: runWithQueue.decision,
    matchedPolicy: runWithQueue.matchedPolicy,
    rationale: runWithQueue.rationale,
    confidence: runWithQueue.confidence,
    missingContext: runWithQueue.missingContext,
    gapType: runWithQueue.gapType
  };
}

export function getServerRuns(policyId: string) {
  return getServerPolicy(policyId).runs;
}

export function getServerQueue(policyId: string) {
  return getServerPolicy(policyId).decisionQueue;
}

export function buildSelfImprovementInput(policyId: string, queueItemId: string): SelfImprovementInput | null {
  const policy = getServerPolicy(policyId);
  const queueItem = policy.decisionQueue.find((item) => item.id === queueItemId);
  if (!queueItem) return null;

  const relatedRuns = policy.runs
    .filter((run) => run.id === queueItem.runId || run.gapType === queueItem.gapType || run.queueItemId === queueItem.id)
    .slice(0, 12);
  const reviewerHistory = policy.decisionQueue
    .map((item) => item.proposedChange)
    .filter((change) => change.queueItemId !== queueItemId)
    .slice(0, 12);

  return {
    policy,
    queueItem,
    relatedRuns,
    reviewerHistory
  };
}

export function recordSelfImprovementAttempt(attempt: SelfImprovementAttempt) {
  selfImprovementAttempts.unshift(attempt);
  selfImprovementAttempts.splice(100);
}

export function applySelfImprovementResult(
  policyId: string,
  result: SelfImprovementResult,
  fallbackQueueItem?: DecisionQueueItem
): Policy {
  const policy = getServerPolicy(policyId);
  const proposalId = result.attempt.proposalId ?? `proposal-${Date.now().toString(36)}`;
  const applyProposal = (item: DecisionQueueItem): DecisionQueueItem => ({
    ...item,
    proposedChange: {
      ...item.proposedChange,
      id: proposalId,
      title: result.proposal.title,
      before: item.proposedChange.before,
      after: result.proposal.proposedPolicyText,
      status: "pending",
      createdAt: result.attempt.completedAt,
      summary: result.proposal.summary,
      rationale: result.proposal.rationale,
      expectedBehavior: result.proposal.expectedBehavior,
      risks: result.proposal.risks,
      confidence: result.proposal.confidence,
      agentProvider: result.attempt.agentProvider,
      agentId: result.attempt.agentId,
      interactionId: result.attempt.interactionId,
      validatorErrors: result.attempt.validatorErrors
    }
  });
  const hasQueueItem = policy.decisionQueue.some((item) => item.id === result.proposal.queueItemId);
  const updated: Policy = {
    ...policy,
    decisionQueue: hasQueueItem ? policy.decisionQueue.map((item) =>
      item.id === result.proposal.queueItemId
        ? applyProposal(item)
        : item
    ) : fallbackQueueItem ? [applyProposal(fallbackQueueItem), ...policy.decisionQueue] : policy.decisionQueue,
    updatedAt: new Date().toISOString()
  };

  policies.set(policyId, updated);
  recordSelfImprovementAttempt({
    ...result.attempt,
    proposalId
  });

  return updated;
}

export function getSelfImprovementAttempts() {
  return selfImprovementAttempts;
}
