import { buildQueueItem, buildRun, evaluateDecision } from "./policyEngine";
import { cloneSeedPolicies } from "./seed";
import type { DecisionRequest, DecisionResponse, Policy } from "./types";

const globalStore = globalThis as typeof globalThis & {
  __opsgymPolicies?: Map<string, Policy>;
};

const policies = globalStore.__opsgymPolicies ?? new Map<string, Policy>();
globalStore.__opsgymPolicies = policies;

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
