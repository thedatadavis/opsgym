import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { GoogleGenAI } from "@google/genai";
import { createId } from "./policyEngine";
import type {
  DecisionKind,
  SelfImprovementAgentProvider,
  SelfImprovementAttempt,
  SelfImprovementExpectedBehavior,
  SelfImprovementInput,
  SelfImprovementProposal,
  SelfImprovementResult
} from "./types";

const defaultGeminiAgent = "antigravity-preview-05-2026";

const fallbackAgentInstructions = `# OpsGym Policy Improver

You improve OpsGym policies from decision queue items.

Rules:
- Return only valid JSON matching the requested schema.
- Propose reviewer-safe policy changes.
- Do not auto-approve policy changes.
- Do not invent facts that are missing from the queue item.
- Preserve hard-denial boundaries unless the input explicitly asks to change them.
- Prefer the smallest amendment that closes the observed ambiguity.
`;

const fallbackPolicyImprovementSkill = `# Policy Improvement Skill

Input contains a policy, one queue item, related runs, and reviewer history.

Output JSON:
{
  "queueItemId": "string",
  "title": "string",
  "summary": "string",
  "proposedPolicyText": "string",
  "rationale": "string",
  "expectedBehavior": [
    {
      "action": "string",
      "expectedDecision": "pass | fail | wait",
      "reason": "string"
    }
  ],
  "risks": ["string"],
  "confidence": 0.0
}
`;

function readAgentSource(relativePath: string, fallback: string) {
  try {
    return readFileSync(join(process.cwd(), relativePath), "utf8");
  } catch {
    return fallback;
  }
}

function now() {
  return new Date().toISOString();
}

export function hashSelfImprovementInput(input: SelfImprovementInput) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isDecisionKind(value: unknown): value is DecisionKind {
  return value === "pass" || value === "fail" || value === "wait";
}

function validateExpectedBehavior(value: unknown, errors: string[]): SelfImprovementExpectedBehavior[] {
  if (!Array.isArray(value)) {
    errors.push("expectedBehavior must be an array.");
    return [];
  }

  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) {
      errors.push(`expectedBehavior[${index}] must be an object.`);
      return [];
    }

    const action = nonEmptyString(record.action);
    const reason = nonEmptyString(record.reason);

    if (!action) errors.push(`expectedBehavior[${index}].action must be a non-empty string.`);
    if (!isDecisionKind(record.expectedDecision)) {
      errors.push(`expectedBehavior[${index}].expectedDecision must be pass, fail, or wait.`);
    }
    if (!reason) errors.push(`expectedBehavior[${index}].reason must be a non-empty string.`);

    if (!action || !isDecisionKind(record.expectedDecision) || !reason) return [];

    return [
      {
        action,
        expectedDecision: record.expectedDecision,
        reason
      }
    ];
  });
}

function validateStringArray(value: unknown, field: string, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array.`);
    return [];
  }

  return value.flatMap((item, index) => {
    const text = nonEmptyString(item);
    if (!text) {
      errors.push(`${field}[${index}] must be a non-empty string.`);
      return [];
    }
    return [text];
  });
}

export function validateSelfImprovementProposal(
  value: unknown,
  queueItemId: string
): { proposal?: SelfImprovementProposal; errors: string[] } {
  const errors: string[] = [];
  const record = asRecord(value);

  if (!record) {
    return { errors: ["Proposal must be a JSON object."] };
  }

  const proposalQueueItemId = nonEmptyString(record.queueItemId);
  const title = nonEmptyString(record.title);
  const summary = nonEmptyString(record.summary);
  const proposedPolicyText = nonEmptyString(record.proposedPolicyText);
  const rationale = nonEmptyString(record.rationale);
  const expectedBehavior = validateExpectedBehavior(record.expectedBehavior, errors);
  const risks = validateStringArray(record.risks, "risks", errors);
  const confidence = typeof record.confidence === "number" ? record.confidence : Number(record.confidence);

  if (proposalQueueItemId !== queueItemId) {
    errors.push("queueItemId must match the requested queue item.");
  }
  if (!title) errors.push("title must be a non-empty string.");
  if (!summary) errors.push("summary must be a non-empty string.");
  if (!proposedPolicyText) errors.push("proposedPolicyText must be a non-empty string.");
  if (!rationale) errors.push("rationale must be a non-empty string.");
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    errors.push("confidence must be a number between 0 and 1.");
  }

  if (errors.length > 0) return { errors };

  return {
    errors,
    proposal: {
      queueItemId,
      title: title ?? "Policy improvement",
      summary: summary ?? "Policy improvement proposal.",
      proposedPolicyText: proposedPolicyText ?? "",
      rationale: rationale ?? "",
      expectedBehavior,
      risks,
      confidence
    }
  };
}

function parseJsonProposal(output: string) {
  const trimmed = output.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? trimmed;
  return JSON.parse(candidate) as unknown;
}

function gapLabel(input: SelfImprovementInput) {
  return input.queueItem.gapType.replaceAll("_", " ");
}

function localProposal(input: SelfImprovementInput): SelfImprovementProposal {
  const existing = input.queueItem.proposedChange;
  const missing = input.queueItem.missingContext.length > 0
    ? input.queueItem.missingContext.join(", ")
    : "the facts required by policy";
  const convertsMissingApprovalToFail =
    missing.toLowerCase().includes("manager approval") ||
    existing.after.toLowerCase().includes("fail when manager approval is missing");
  const relatedWaits = input.relatedRuns.filter((run) => run.decision === "wait").length;
  const proposedPolicyText = existing.after.includes("Source gap:")
    ? existing.after
    : `${existing.after} Source gap: ${gapLabel(input)}.`;

  return {
    queueItemId: input.queueItem.id,
    title: existing.title || `Clarify ${gapLabel(input)}`,
    summary: `Drafted a bounded amendment for a ${gapLabel(input)} queue item. ${relatedWaits} related wait run(s) were considered.`,
    proposedPolicyText,
    rationale: [
      input.queueItem.rationale,
      `The proposal keeps the item in review unless ${missing} is explicit, then narrows the policy behavior for future similar cases.`
    ].join(" "),
    expectedBehavior: [
      {
        action: input.queueItem.action,
        expectedDecision: convertsMissingApprovalToFail ? "fail" : "wait",
        reason: convertsMissingApprovalToFail
          ? "The amendment makes missing manager approval an explicit denial boundary for the exception path."
          : `The original case remains reviewable until ${missing} is supplied or an approved exception is explicit.`
      },
      {
        action: `${input.queueItem.action} Include explicit approval for ${missing}.`,
        expectedDecision: "pass",
        reason: "The amended policy should pass only when the missing approval/context is present and no hard-denial boundary is triggered."
      },
      {
        action: `${input.queueItem.action} Include a final-sale, fraud, abuse, or other hard-denial boundary.`,
        expectedDecision: "fail",
        reason: "Hard-denial boundaries should continue to override exception paths."
      }
    ],
    risks: [
      "The amendment may be too broad if reviewers do not verify the missing context.",
      "Regression tests should confirm existing hard-denial outcomes still fail."
    ],
    confidence: input.queueItem.gapType === "missing_context" ? 0.72 : 0.66
  };
}

function configuredProvider(): SelfImprovementAgentProvider {
  return process.env.OPSGYM_AGENT_PROVIDER === "gemini" ? "gemini" : "local";
}

function buildAttempt(
  input: SelfImprovementInput,
  provider: SelfImprovementAgentProvider,
  agentId: string,
  startedAt: string,
  status: "completed" | "failed",
  validatorErrors: string[],
  proposalId?: string,
  interactionId?: string
): SelfImprovementAttempt {
  return {
    policyId: input.policy.id,
    queueItemId: input.queueItem.id,
    agentProvider: provider,
    agentId,
    interactionId,
    startedAt,
    completedAt: now(),
    status,
    inputHash: hashSelfImprovementInput(input),
    proposalId,
    validatorErrors
  };
}

function proposalPrompt(input: SelfImprovementInput) {
  return [
    "Create a reviewer-safe self-improvement proposal for this OpsGym decision queue item.",
    "Return only JSON matching the SKILL.md schema.",
    JSON.stringify(input, null, 2)
  ].join("\n\n");
}

async function geminiProposal(input: SelfImprovementInput) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required when OPSGYM_AGENT_PROVIDER=gemini.");
  }

  const client = new GoogleGenAI({ apiKey });
  const agentId = process.env.GEMINI_POLICY_IMPROVER_AGENT_ID ?? defaultGeminiAgent;
  const interaction = await client.interactions.create({
    agent: agentId,
    input: proposalPrompt(input),
    system_instruction: "You improve OpsGym policies. Return only valid JSON. Do not auto-approve changes.",
    environment: {
      type: "remote",
      sources: [
        {
          type: "inline",
          target: ".agents/AGENTS.md",
          content: readAgentSource(".agents/AGENTS.md", fallbackAgentInstructions)
        },
        {
          type: "inline",
          target: ".agents/skills/policy-improvement/SKILL.md",
          content: readAgentSource(".agents/skills/policy-improvement/SKILL.md", fallbackPolicyImprovementSkill)
        }
      ]
    }
  });

  const output = interaction.output_text;
  if (!output) {
    throw new Error("Gemini managed agent did not return output_text.");
  }

  return {
    agentId,
    interactionId: interaction.id,
    rawProposal: parseJsonProposal(output)
  };
}

export async function proposeSelfImprovement(input: SelfImprovementInput): Promise<SelfImprovementResult> {
  const startedAt = now();
  const provider = configuredProvider();

  if (provider === "gemini") {
    try {
      const { agentId, interactionId, rawProposal } = await geminiProposal(input);
      const validation = validateSelfImprovementProposal(rawProposal, input.queueItem.id);
      if (!validation.proposal) {
        return {
          proposal: localProposal(input),
          attempt: buildAttempt(input, provider, agentId, startedAt, "failed", validation.errors, undefined, interactionId)
        };
      }

      return {
        proposal: validation.proposal,
        attempt: buildAttempt(
          input,
          provider,
          agentId,
          startedAt,
          "completed",
          [],
          createId("proposal"),
          interactionId
        )
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gemini managed agent failed.";
      return {
        proposal: localProposal(input),
        attempt: buildAttempt(input, provider, process.env.GEMINI_POLICY_IMPROVER_AGENT_ID ?? defaultGeminiAgent, startedAt, "failed", [message])
      };
    }
  }

  const proposal = localProposal(input);
  return {
    proposal,
    attempt: buildAttempt(input, "local", "local-policy-improver", startedAt, "completed", [], createId("proposal"))
  };
}
