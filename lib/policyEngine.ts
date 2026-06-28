import type {
  DecisionQueueItem,
  DecisionRequest,
  DecisionResult,
  DecisionRun,
  GapType,
  Policy,
  ProposedChange,
  RunSource
} from "./types";

const now = () => new Date().toISOString();

export const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const lower = (value: string) => value.toLowerCase();

const includesAny = (value: string, terms: string[]) =>
  terms.some((term) => value.includes(term));

const daysAgo = (input: string): number | null => {
  const match = input.match(/(\d+)\s*(?:day|days)\s*ago/i);
  return match ? Number(match[1]) : null;
};

const hasApprovedVipException = (policyRecord: Pick<Policy, "policy">) => {
  const policy = lower(policyRecord.policy);
  return (
    policy.includes("vip") &&
    policy.includes("inside 90 days") &&
    policy.includes("manager approval") &&
    policy.includes("fail when manager approval is missing")
  );
};

export function evaluateDecision(
  policyRecord: Pick<Policy, "policy" | "principles">,
  request: DecisionRequest
): DecisionResult {
  const text = lower(request.action);
  const age = daysAgo(request.action);
  const refund = includesAny(text, ["refund", "credit", "return"]);
  const vip = includesAny(text, ["vip", "hardship"]);
  const approvalDenied = includesAny(text, [
    "without manager approval",
    "no manager approval",
    "manager approval is missing",
    "manager approval missing"
  ]);
  const managerApproval =
    !approvalDenied && includesAny(text, ["manager approval", "approved by manager", "manager-approved"]);
  const qualityIssue = includesAny(text, ["damaged", "wrong item", "not as described", "defective", "broken"]);
  const duplicateCharge = includesAny(text, ["duplicate charge", "charged twice", "double charged"]);
  const hardDeny = includesAny(text, ["final-sale", "final sale", "fraud", "abuse", "consumed digital"]);
  const approvedVipException = hasApprovedVipException(policyRecord);

  if (!refund) {
    return {
      decision: "wait",
      matchedPolicy: ["policy"],
      rationale: "The action does not clearly request a refund, so this policy cannot safely decide.",
      confidence: 0.42,
      missingContext: ["action type"],
      gapType: "missing_context"
    };
  }

  if (hardDeny || (age !== null && age > 90)) {
    return {
      decision: "fail",
      matchedPolicy: ["policy", "Preserve refund boundaries"],
      rationale: hardDeny
        ? "The action hits a hard denial boundary such as final sale, abuse, fraud, or consumed digital goods."
        : "The requested refund is outside the 90-day maximum boundary.",
      confidence: 0.93,
      missingContext: []
    };
  }

  if (vip && age !== null && age > 30 && age <= 90) {
    if (approvedVipException && managerApproval && qualityIssue) {
      return {
        decision: "pass",
        matchedPolicy: ["policy", "Protect customer trust"],
        rationale: "The approved VIP exception covers damaged orders inside 90 days when manager approval is present.",
        confidence: 0.87,
        missingContext: []
      };
    }

    if (approvedVipException && !managerApproval) {
      return {
        decision: "fail",
        matchedPolicy: ["policy", "Preserve refund boundaries"],
        rationale: "The approved VIP exception requires manager approval, so this exception request is blocked.",
        confidence: 0.82,
        missingContext: ["manager approval"]
      };
    }

    return {
      decision: "wait",
      matchedPolicy: ["policy"],
      rationale: "VIP or hardship refund outside 30 days is an exception path that requires stronger policy coverage.",
      confidence: 0.55,
      missingContext: managerApproval ? ["explicit approved exception"] : ["manager approval"],
      gapType: managerApproval ? "logic_gap" : "ambiguous_exception"
    };
  }

  if ((qualityIssue || duplicateCharge) && (age === null || age <= 30)) {
    return {
      decision: "pass",
      matchedPolicy: ["policy", "Protect customer trust"],
      rationale: qualityIssue
        ? "The refund is inside the standard window and matches a covered item-quality reason."
        : "The refund is inside the standard window and matches duplicate-charge coverage.",
      confidence: age === null ? 0.74 : 0.91,
      missingContext: age === null ? ["exact order age"] : []
    };
  }

  if (age === null) {
    return {
      decision: "wait",
      matchedPolicy: ["policy"],
      rationale: "The policy needs order age before applying refund windows.",
      confidence: 0.5,
      missingContext: ["order age"],
      gapType: "missing_context"
    };
  }

  return {
    decision: "wait",
    matchedPolicy: ["policy"],
    rationale: "The action falls between known pass and fail boundaries without a covered exception.",
    confidence: 0.47,
    missingContext: ["eligible reason or exception authority"],
    gapType: "policy_gap"
  };
}

export function buildRun(
  policyId: string,
  request: DecisionRequest,
  result: DecisionResult,
  source: RunSource
): DecisionRun {
  return {
    id: createId("run"),
    policyId,
    action: request.action,
    context: request.context,
    source,
    createdAt: now(),
    ...result
  };
}

export function buildProposedChange(queueItemId: string, gapType: GapType): ProposedChange {
  const gapLabel = gapType.replace("_", " ");

  return {
    id: createId("change"),
    queueItemId,
    title: "Harden VIP refund exception",
    before: "VIP or hardship refunds outside 30 days but inside 90 days remain Wait unless an exception is explicit.",
    after: `Pass VIP or hardship refunds for damaged, wrong, defective, or not-as-described orders outside 30 days but inside 90 days when manager approval is present. Fail when manager approval is missing. Source gap: ${gapLabel}.`,
    status: "pending",
    createdAt: now()
  };
}

export function buildQueueItem(policyId: string, run: DecisionRun): DecisionQueueItem {
  const queueItemId = createId("queue");
  const gapType = run.gapType ?? "policy_gap";

  return {
    id: queueItemId,
    policyId,
    runId: run.id,
    action: run.action,
    gapType,
    missingContext: run.missingContext,
    rationale: run.rationale,
    status: "open",
    proposedChange: buildProposedChange(queueItemId, gapType),
    createdAt: now()
  };
}

export function applyProposedChange(policyRecord: Policy, queueItemId: string): Policy {
  const queueItem = policyRecord.decisionQueue.find((item) => item.id === queueItemId);
  if (!queueItem) return policyRecord;

  const approvedAt = now();
  const policyAlreadyIncludesChange = policyRecord.policy.includes(queueItem.proposedChange.after);

  return {
    ...policyRecord,
    policy: policyAlreadyIncludesChange
      ? policyRecord.policy
      : `${policyRecord.policy.trim()}\n\n${queueItem.proposedChange.after}`,
    decisionQueue: policyRecord.decisionQueue.map((item) =>
      item.id === queueItemId
        ? {
            ...item,
            status: "resolved",
            proposedChange: {
              ...item.proposedChange,
              status: "approved"
            }
          }
        : item
    ),
    updatedAt: approvedAt
  };
}

export function rejectProposedChange(policyRecord: Policy, queueItemId: string): Policy {
  const rejectedAt = now();

  return {
    ...policyRecord,
    decisionQueue: policyRecord.decisionQueue.map((item) =>
      item.id === queueItemId
        ? {
            ...item,
            status: "rejected",
            proposedChange: {
              ...item.proposedChange,
              status: "rejected"
            }
          }
        : item
    ),
    updatedAt: rejectedAt
  };
}
