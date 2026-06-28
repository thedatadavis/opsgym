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

const directiveStart = /^(pass|fail|wait|for|when)\b/i;

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
  policyRecord: Pick<Policy, "policy" | "principles" | "generatedRulesJs">,
  request: DecisionRequest
): DecisionResult {
  if (policyRecord.generatedRulesJs) {
    const executed = executeGeneratedRules(policyRecord.generatedRulesJs, request);
    if (executed) return executed;
  }
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

function stripSourceGap(value: string) {
  return value.replace(/\s*Source gap:\s*[^.]+\.?/gi, "").trim();
}

function splitPolicySections(policyText: string) {
  return policyText
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);
}

function keywordSet(value: string) {
  const stopWords = new Set([
    "a", "an", "and", "are", "as", "be", "but", "by", "case", "cases", "for", "from", "if",
    "in", "inside", "is", "it", "of", "on", "or", "outside", "policy", "refund", "refunds",
    "request", "requests", "should", "than", "the", "to", "when", "with", "without"
  ]);

  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9-]+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 2 && !stopWords.has(word))
  );
}

function overlapScore(left: string, right: string) {
  const leftWords = keywordSet(left);
  const rightWords = keywordSet(right);
  let score = 0;

  for (const word of leftWords) {
    if (rightWords.has(word)) score += 1;
  }

  return score;
}

function looksLikeFullPolicy(currentPolicyText: string, candidateText: string) {
  const currentSections = splitPolicySections(currentPolicyText);
  const candidateSections = splitPolicySections(candidateText);

  if (candidateSections.length > 1) return true;
  if (candidateText.length >= currentPolicyText.trim().length * 0.7) return true;

  return currentSections.some((section) => candidateText.includes(section));
}

export function rewritePolicyText(policyText: string, proposedChange: ProposedChange): string {
  const currentPolicyText = policyText.trim();
  const candidateText = stripSourceGap(proposedChange.after);

  if (!candidateText) return currentPolicyText;
  if (looksLikeFullPolicy(currentPolicyText, candidateText)) return candidateText;
  if (currentPolicyText.includes(candidateText)) return currentPolicyText;

  const sections = splitPolicySections(currentPolicyText);
  if (sections.length === 0) return candidateText;

  const scoredSections = sections.map((section, index) => ({
    index,
    score: Math.max(overlapScore(section, proposedChange.before), overlapScore(section, candidateText))
  }));
  const best = scoredSections.sort((a, b) => b.score - a.score)[0];

  if (!best || best.score < 2) {
    return [...sections, candidateText].join("\n\n");
  }

  return sections
    .map((section, index) => {
      if (index !== best.index) return section;

      const prefix = directiveStart.test(candidateText) ? "" : "Wait when ";
      return `${prefix}${candidateText}`.trim();
    })
    .join("\n\n");
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
  const updatedPolicyText = rewritePolicyText(policyRecord.policy, queueItem.proposedChange);
  const policyWithUpdatedRules = {
    ...policyRecord,
    policy: updatedPolicyText,
    generatedRulesJs: compilePolicyToJs(updatedPolicyText)
  };
  const openQueueItems = policyRecord.decisionQueue.filter((item) => item.status === "open");
  const reruns = openQueueItems.map((item) => ({
    ...buildRun(policyRecord.id, { action: item.action }, evaluateDecision(policyWithUpdatedRules, { action: item.action }), "policy_rerun"),
    queueItemId: item.id
  }));
  const rerunByQueueItemId = new Map(reruns.map((run) => [run.queueItemId, run]));

  return {
    ...policyRecord,
    policy: updatedPolicyText,
    generatedRulesJs: policyWithUpdatedRules.generatedRulesJs,
    runs: [...reruns, ...policyRecord.runs].slice(0, 100),
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
        : item.status === "open"
          ? {
              ...item,
              status: rerunByQueueItemId.get(item.id)?.decision === "wait" ? "open" : "resolved",
              rationale: rerunByQueueItemId.get(item.id)?.rationale ?? item.rationale,
              missingContext: rerunByQueueItemId.get(item.id)?.missingContext ?? item.missingContext,
              gapType: rerunByQueueItemId.get(item.id)?.gapType ?? item.gapType
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

export function compilePolicyToJs(policyText: string): string {
  const lines = policyText.split(/[.\n]+/).map(l => l.trim()).filter(Boolean);
  const rules: string[] = [];
  
  const stemWord = (w: string) => {
    if (w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (w.endsWith("s") && !w.endsWith("ss") && w.length > 4) return w.slice(0, -1);
    return w;
  };
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    let decision: "pass" | "fail" | "wait" | null = null;
    
    if (lowerLine.startsWith("pass")) {
      decision = "pass";
    } else if (lowerLine.startsWith("fail")) {
      decision = "fail";
    } else if (lowerLine.startsWith("wait")) {
      decision = "wait";
    }
    
    if (decision) {
      const ageChecks: string[] = [];
      let match;
      
      if (match = lowerLine.match(/inside\s+(\d+)\s*days?/)) {
        const val = parseInt(match[1], 10);
        ageChecks.push(`(age !== null && age <= ${val})`);
      }
      
      if (match = lowerLine.match(/(?:older|outside|greater)\s+(?:than\s+)?(\d+)\s*days?/)) {
        const val = parseInt(match[1], 10);
        ageChecks.push(`(age !== null && age > ${val})`);
      }
      
      if (match = lowerLine.match(/between\s+(\d+)\s+(?:and|to)\s+(\d+)\s*days?/)) {
        const val1 = parseInt(match[1], 10);
        const val2 = parseInt(match[2], 10);
        ageChecks.push(`(age !== null && age >= ${val1} && age <= ${val2})`);
      }

      const cleanLine = lowerLine
        .replace(/^(pass|fail|wait)\s+(refunds\s+for|refund\s+for|rules\s+for|requests\s+for|cases\s+of)?/i, "")
        .replace(/(inside|outside|older|greater|between|than|and|to)?\s+\d+\s*days?/g, "");
        
      const stopWords = new Set([
        "when", "then", "with", "from", "their", "under", "this", "that", "these", "those",
        "should", "does", "doesnt", "would", "could", "is", "are", "was", "were", "be",
        "been", "have", "has", "had", "a", "an", "the", "of", "in", "on", "at", "by", "for",
        "but", "unless", "except", "if", "or"
      ]);
      
      const words = cleanLine.split(/[^a-z0-9-]+/)
        .map(w => w.trim())
        .filter(w => w.length > 3 && !stopWords.has(w))
        .map(w => stemWord(w));
        
      const uniqueKeywords = Array.from(new Set(words));
      
      const keywordConditions = uniqueKeywords.map(kw => `action.includes("${kw}")`).join(" && ");
      const ageConditions = ageChecks.join(" && ");
      
      let condition = "";
      if (keywordConditions && ageConditions) {
        condition = `${keywordConditions} && ${ageConditions}`;
      } else {
        condition = keywordConditions || ageConditions || "false";
      }
      
      rules.push(`
  // Rule: "${line.replace(/"/g, '\\"')}"
  if (${condition}) {
    return {
      decision: "${decision}",
      matchedPolicy: ["policy"],
      rationale: "${line.replace(/"/g, '\\"')}",
      confidence: 0.85,
      missingContext: []
    };
  }
      `);
    }
  }

  return `
  const action = (request.action || "").toLowerCase();
  
  let age = null;
  const ageMatch = request.action.match(/(\\d+)\\s*days?\\s+ago/i) || request.action.match(/purchased\\s+(\\d+)\\s*days?/i);
  if (ageMatch) {
    age = parseInt(ageMatch[1], 10);
  }

  const has = (words) => words.some(w => action.includes(w));

  ${rules.join("\n")}
  
  return null;
  `;
}

export function executeGeneratedRules(rulesJs: string, request: DecisionRequest): DecisionResult | null {
  try {
    const runner = new Function("request", rulesJs);
    const result = runner(request) as DecisionResult | null;
    if (result && typeof result.decision === "string" && Array.isArray(result.matchedPolicy)) {
      return result;
    }
  } catch (err) {
    console.error("Error executing generated rules JS:", err);
  }
  return null;
}
