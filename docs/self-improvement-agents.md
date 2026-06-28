# Self-Improvement Agents

This document describes how OpsGym self-improvement agents are supposed to work, how they interact with policies and decision queues, and how Gemini Managed Agents should be integrated when the hosted agent path is enabled.

## Current Product Model

OpsGym treats a `Policy` as the top-level object. A policy contains:

- `policy`: the natural-language decision boundary.
- `principles`: operating constraints used to interpret or amend the policy.
- `endpointPath`: the decision endpoint exposed to callers.
- `runs`: recorded decision attempts.
- `decisionQueue`: open policy gaps, ambiguity cases, or missing-context cases that need review.

The current local decision loop is deterministic. `POST /api/policies/[policyId]/decision` evaluates an action against a policy. A `pass` or `fail` run is recorded directly. A `wait` run creates a queue item with a proposed policy change. A human reviewer can approve or reject that proposed change from the queue.

That deterministic loop is the baseline behavior. Self-improvement agents should extend it; they should not replace the human-review boundary.

## Self-Improvement Loop

The intended loop is:

1. A decision endpoint receives an action and optional context.
2. The policy evaluator returns `pass`, `fail`, or `wait`.
3. `wait` decisions create queue items with a structured gap type, rationale, missing context, and proposed change.
4. A self-improvement agent periodically or manually reviews queue items.
5. The agent analyzes the run, policy text, principles, recent similar runs, and reviewer history.
6. The agent proposes one or more policy edits, tests those edits against representative cases, and writes an explanation.
7. A human reviewer approves, edits, or rejects the proposed policy change.
8. Approved changes update the policy text and close the queue item.
9. Future decisions use the improved policy.

The core invariant is that agents recommend policy changes, but humans approve changes before they affect live policy behavior.

## Agent Responsibilities

Self-improvement agents should do four jobs:

- Triage: group related queue items, identify repeated gaps, and prioritize high-impact ambiguities.
- Propose: draft minimal policy amendments that close the gap without broadening the policy beyond the evidence.
- Test: generate regression cases for the proposed amendment and explain expected `pass`, `fail`, or `wait` outcomes.
- Explain: produce reviewer-facing rationale, including which policy boundary or principle is being changed.

Agents must not:

- Auto-approve policy changes without an explicit product mode that permits it.
- Remove hard-denial boundaries unless a reviewer explicitly requests that.
- Hide missing context by inventing facts.
- Use private external systems unless the tool credential scope is explicitly configured for that policy.

## Queue Item Contract

Each queue item should provide enough context for an agent to work without scraping UI state:

```ts
type SelfImprovementInput = {
  policy: Policy;
  queueItem: DecisionQueueItem;
  relatedRuns: DecisionRun[];
  reviewerHistory?: ProposedChange[];
};
```

The agent should return structured output:

```ts
type SelfImprovementProposal = {
  queueItemId: string;
  title: string;
  summary: string;
  proposedPolicyText: string;
  rationale: string;
  expectedBehavior: Array<{
    action: string;
    expectedDecision: "pass" | "fail" | "wait";
    reason: string;
  }>;
  risks: string[];
  confidence: number;
};
```

The app should store the proposal as a proposed change, not directly mutate `policy.policy`.

## Gemini Managed Agents Integration

Gemini Managed Agents should be used for the hosted self-improvement path. Google's Gemini API Managed Agents provide a configurable agent harness where a single Interactions API call can provision a remote Linux sandbox for reasoning, code execution, file management, and web access. The default managed agent is Antigravity, and custom managed agents can layer system instructions, tools, files, and skills on top of it.

Use the Gemini Interactions API as the integration surface for new work. Google documents it as the recommended interface for models and agents as of June 2026, with support for server-side state via `previous_interaction_id`, observable execution steps, and background execution for long-running work.

### Implemented Layer

OpsGym currently exposes a first self-improvement endpoint:

```txt
POST /api/policies/[policyId]/queue/[queueItemId]/improve
```

The endpoint:

- Builds the documented `SelfImprovementInput` from the policy, queue item, related runs, and reviewer history.
- Runs the configured self-improvement provider.
- Validates the returned `SelfImprovementProposal`.
- Stores a completed proposal as the queue item's pending `proposedChange`.
- Leaves the queue item open and keeps human approval mandatory.

Approval and rejection are explicit API actions:

```txt
POST /api/policies/[policyId]/queue/[queueItemId]/approve
POST /api/policies/[policyId]/queue/[queueItemId]/reject
```

Approval appends the pending proposed change to the policy text and resolves the queue item. Rejection marks the queue item and proposal rejected without changing policy text.

Provider selection:

- Default: local deterministic provider, no credentials required.
- Gemini: set `OPSGYM_AGENT_PROVIDER=gemini` and `GEMINI_API_KEY`.
- Optional Gemini agent override: set `GEMINI_POLICY_IMPROVER_AGENT_ID`; otherwise OpsGym uses `antigravity-preview-05-2026`.

The Gemini provider mounts `.agents/AGENTS.md` and `.agents/skills/policy-improvement/SKILL.md` into the managed agent environment as inline sources. If those files are unavailable in a deployment artifact, the server falls back to embedded copies of the same instructions.

### Managed Agent Shape

OpsGym should define a managed agent named conceptually `opsgym-policy-improver`.

The managed agent should include:

- `AGENTS.md`: global instructions for how to inspect policy gaps and produce reviewer-safe amendments.
- `SKILL.md`: a policy-improvement skill that defines the input contract, output schema, review boundary, and testing expectations.
- Optional fixtures: representative decision runs, approved/rejected examples, and policy style examples.
- Optional tools: remote MCP or function tools for retrieving policy snapshots, queue items, and writing proposed changes back to OpsGym.

The agent can be invoked either inline at interaction time or by saved managed-agent ID. Inline invocation is simpler for early development. Saved agents are better once the instructions, skills, and tool set stabilize.

### Invocation Flow

Recommended flow:

1. OpsGym selects a queue item for improvement.
2. OpsGym builds a compact payload containing the policy, queue item, related runs, and output schema.
3. OpsGym calls `interactions.create` with the managed agent.
4. The managed agent analyzes the payload inside the remote sandbox.
5. The agent returns structured proposal JSON plus human-readable reasoning.
6. OpsGym validates the JSON locally.
7. OpsGym saves the proposal as a pending change on the queue item.
8. A reviewer approves, edits, or rejects it in the UI.

For long-running analysis across many queue items, use background execution and poll or subscribe to the resulting interaction state before writing the proposal back.

### Suggested JavaScript Skeleton

This is illustrative; keep exact package names and API fields aligned with the installed Gemini SDK version when implementing.

```ts
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function proposePolicyImprovement(input: SelfImprovementInput) {
  const interaction = await client.interactions.create({
    agent: process.env.GEMINI_POLICY_IMPROVER_AGENT_ID ?? "antigravity-preview-05-2026",
    input: JSON.stringify(input),
    system_instruction:
      "You improve OpsGym policies. Return only reviewer-safe proposed changes. Do not auto-approve changes.",
    environment: {
      type: "remote",
      sources: [
        {
          type: "inline",
          target: ".agents/AGENTS.md",
          content: opsgymPolicyImproverInstructions
        },
        {
          type: "inline",
          target: ".agents/skills/policy-improvement/SKILL.md",
          content: policyImprovementSkill
        }
      ]
    }
  });

  return parseAndValidateProposal(interaction.output_text);
}
```

### Tooling Options

There are three reasonable integration levels:

- No external tools: pass all required policy data in the interaction input and receive proposal JSON. This is easiest to secure and test.
- Function tools: expose narrow functions such as `getPolicy`, `listRelatedRuns`, and `createProposedChange`. This reduces payload size but requires strict auth and validation.
- Remote MCP: expose richer repo or application tools through a managed server. Use this only when the agent needs broader read/write capabilities, and scope each tool to the minimum required operations.

Start with no external tools. Move to function tools only after the proposal format and reviewer flow are stable.

## Claude.com Connector Layer

OpsGym exposes a remote MCP endpoint for Claude.com custom connectors:

```txt
/api/mcp
```

The connector is intentionally narrow:

- `decide_policy`: evaluate one action against one policy and record the run.
- `get_policy_runs`: read recent runs and queue items for one policy.
- `draft_policy_improvement`: call the configured self-improvement provider and store a pending proposal.
- `approve_policy_change`: approve a pending proposal after explicit user approval.

This MCP layer is for an external ops-worker agent such as Claude.com. It is separate from Gemini Managed Agents, which draft policy amendments inside OpsGym's self-improvement flow.

### Network And Credentials

Managed agents run in isolated remote sandboxes. Google notes that outbound network access is unrestricted by default unless restricted with a network allowlist. OpsGym should use an allowlist for production agents.

Credentials must be treated as full authority for whatever they can access. Use least-privilege API keys or service accounts, prefer short-lived tokens, and never mount broad production credentials into the agent environment. If credentials are provided through proxy/header transformation, keep them out of files mounted into the sandbox.

### Human Review Boundary

Gemini Managed Agents may draft proposed changes, test cases, summaries, and reviewer notes. They must not directly update live policy text in production.

The write path should be:

```txt
Gemini proposal -> OpsGym validation -> pending proposed change -> human approval -> policy update
```

Any future auto-apply mode should be separate, explicit, logged, and restricted to low-risk policies with strong regression coverage.

## Evaluation

Every agent-generated proposal should be evaluated before review:

- Schema validation: ensure the returned JSON matches `SelfImprovementProposal`.
- Policy regression: run representative existing cases and ensure hard boundaries still fail.
- Gap closure: run the original queue item and ensure the proposed policy creates the intended outcome or a better `wait` rationale.
- Principle consistency: check whether the proposal conflicts with policy principles.
- Diff size: prefer the smallest amendment that closes the observed gap.

Gemini Enterprise Agent Platform can later provide heavier governance, evaluation, observability, simulation, registry, identity, and gateway controls. That is the right path if OpsGym moves from local/product-managed agent calls to enterprise-managed agent operations.

## Observability

Store these fields for every self-improvement attempt:

- `policyId`
- `queueItemId`
- `agentProvider`
- `agentId`
- `interactionId`
- `startedAt`
- `completedAt`
- `status`
- `inputHash`
- `proposalId`
- `validatorErrors`
- `reviewDecision`

Do not store raw credentials, full secret-bearing tool calls, or sensitive customer context in agent logs.

## Failure Handling

If the agent call fails:

- Leave the queue item open.
- Show a non-blocking failure state in the reviewer UI.
- Preserve the original deterministic proposed change if one exists.
- Allow retry with the same input payload.

If the agent returns invalid JSON:

- Store the raw output only if it does not contain sensitive data.
- Mark validation errors.
- Do not create a pending proposed change.

If the agent proposes an unsafe change:

- Reject the proposal.
- Keep the queue item open.
- Add reviewer feedback so future proposals can learn from the rejection pattern.

## Implementation Phases

Phase 1: Local proposal hardening

- Keep deterministic proposals.
- Add proposal schema validation.
- Add regression examples to queue item detail.

Phase 2: Gemini inline managed-agent prototype

- Add a server-only Gemini integration module.
- Pass policy and queue item data inline.
- Save returned proposals as pending changes.
- Keep human approval mandatory.

Phase 3: Saved managed agent

- Move instructions into `.agents/AGENTS.md`.
- Move the improvement workflow into `.agents/skills/policy-improvement/SKILL.md`.
- Invoke the saved managed agent by ID.
- Add interaction IDs and agent metadata to proposal logs.

Phase 4: Tool-backed agent

- Add narrow function tools or MCP tools for policy retrieval and proposal creation.
- Add network allowlists and least-privilege credentials.
- Add retry, background execution, and observability.

Phase 5: Enterprise governance

- Register agents in Gemini Enterprise Agent Platform.
- Use agent identity and gateway controls for tool access.
- Add formal simulation/evaluation suites for high-risk policies.
- Add dashboards for proposal quality, review acceptance rate, and regression failures.

## Open Product Questions

- Should self-improvement run only when a reviewer opens a queue item, or also as a background batch job?
- Should proposals be one-per-queue-item or grouped across similar queue items?
- What confidence threshold should block reviewer presentation?
- Which policies, if any, can enter an auto-apply mode?
- What customer context is allowed to leave OpsGym for hosted agent analysis?

## References

- Gemini API Agents Overview: https://ai.google.dev/gemini-api/docs/agents
- Gemini API Building Managed Agents: https://ai.google.dev/gemini-api/docs/custom-agents
- Gemini API Interactions API: https://ai.google.dev/gemini-api/docs/interactions-overview
- Gemini Enterprise Agent Platform Overview: https://docs.cloud.google.com/gemini-enterprise-agent-platform/overview
