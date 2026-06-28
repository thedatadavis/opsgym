# Claude Ops Worker Demo

This demo shows Claude.com acting as an ops worker while OpsGym remains the policy decision layer.

## Connector Setup

Production MCP endpoint:

```txt
https://opsgym.pdt.dev/api/mcp
```

Create a Claude.com custom connector that points to that remote MCP URL. The endpoint is stateless Streamable HTTP and exposes only narrow OpsGym tools.

Reference docs:

- https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities

## Tools

- `decide_policy`: evaluates an action and records a run.
- `get_policy_runs`: reads recent runs and queue items.
- `draft_policy_improvement`: drafts a pending policy proposal.
- `approve_policy_change`: approves a pending proposal and mutates policy text.

## Primary Prompt

```txt
You are an ops worker handling refund decisions through OpsGym.

Use policy refund-policy.
First evaluate:
1. Refund a delivered damaged order from 12 days ago.
2. Refund a final-sale VIP ticket purchased 2 days ago.
3. Refund a VIP customer's damaged order from 45 days ago without manager approval.

When a wait decision creates a queue item, summarize why it waited. Then draft a policy improvement for that queue item, show me the proposed behavior changes, and wait for my explicit approval before applying it.

After I approve, re-test:
1. Refund a VIP customer's damaged order from 45 days ago without manager approval.
2. Refund a VIP customer's damaged order from 45 days ago with manager approval.
```

Expected flow:

1. Claude calls `decide_policy` for the pass case.
2. Claude calls `decide_policy` for the fail case.
3. Claude calls `decide_policy` for the ambiguous VIP case and receives `wait`.
4. Claude calls `draft_policy_improvement` for the queue item.
5. Claude shows the proposal and asks before approval.
6. After explicit approval, Claude calls `approve_policy_change`.
7. Claude re-tests the two VIP cases and gets `fail` without manager approval and `pass` with manager approval.

## Fallback

If connector setup is unavailable, use Claude.com for the ops-worker narration and run the same calls from a terminal with:

```bash
npm run demo:batch -- --base https://opsgym.pdt.dev
```
