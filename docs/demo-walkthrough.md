# OpsGym Demo Walkthrough

Production app:

```txt
https://opsgym.pdt.dev
```

Production API base:

```txt
https://opsgym.pdt.dev/api
```

This walkthrough is designed to show OpsGym as a policy decision layer for recurring operations, then trigger the self-improvement loop from a real API call.

## Production Preflight

Before the live demo, verify the domain and TLS certificate are ready:

```bash
curl -I https://opsgym.pdt.dev
```

Expected:

```txt
HTTP/2 200
```

or another healthy `2xx`/`3xx` response from the app. If this returns a TLS handshake error or Cloudflare `1001`/`409`, finish the DigitalOcean custom-domain/certificate setup before using the production commands below.

## Demo Goal

Show one operational policy moving through the full loop:

```txt
known good case -> pass
known bad case -> fail
ambiguous exception -> wait + queue item
queue item -> self-improvement proposal
human approval -> improved future decisions
```

Use the seeded `Refund Policy` because the deterministic engine has clear before/after behavior for VIP exception handling.

## Warmup Batch Demo

Use the batch harness before the primary walkthrough when you want a clean before/after measurement without depending on the current seeded policy state. The harness creates an isolated demo policy, runs four before cases, drafts a self-improvement proposal, approves it through the API, then runs four after cases.

Local:

```bash
npm run demo:batch -- --base http://localhost:3000
```

Production:

```bash
npm run demo:batch -- --base https://opsgym.pdt.dev
```

Machine-readable output:

```bash
npm run demo:batch -- --base https://opsgym.pdt.dev --json
```

Expected summary:

```txt
Before: pass=1 fail=1 wait=2
After: pass=2 fail=2 wait=0
```

For a browser version, open:

```txt
https://opsgym.pdt.dev/demo
```

Click `Run Demo Batch`. The report page shows before/after case tables, the queue item used for improvement, the agent provider, and API links for the isolated policy.

## The Story

An agent or ops workflow wants to decide whether to refund customer orders. The surrounding process can run in Claude, Codex, MCP, a support tool, or a custom workflow. OpsGym owns the decision layer.

The refund policy starts with these boundaries:

- Normal damaged-order refunds inside 30 days pass.
- Final-sale, fraud, abuse, consumed digital goods, or orders older than 90 days fail.
- VIP or hardship refunds between 30 and 90 days wait unless the exception is explicit.

The interesting spillover case is:

```txt
Refund a VIP customer's damaged order from 45 days ago without manager approval.
```

Before improvement, this waits because the exception path is ambiguous. After improvement and approval, the policy makes the missing-approval case explicitly fail, while the same case with manager approval can pass.

## 1. Open The Dashboard

Open:

```txt
https://opsgym.pdt.dev
```

Point out:

- The dashboard is a compact list of policies, not a chatbot.
- Policies are grouped by operational state: `Needs Review`, `Active`, and `Quiet`.
- `Refund Policy` has an endpoint at `/api/policies/refund-policy/decision`.
- Queue items are exceptions: they are where natural-language policy ambiguity becomes auditable work.

## 2. Establish The Happy Path

Call the production decision endpoint with a clearly eligible damaged-order refund:

```bash
curl -s -X POST https://opsgym.pdt.dev/api/policies/refund-policy/decision \
  -H "Content-Type: application/json" \
  -d '{"action":"Refund a delivered damaged order from 12 days ago."}'
```

Expected result:

```json
{
  "decision": "pass",
  "policyId": "refund-policy"
}
```

Narration:

```txt
The workflow can keep moving. OpsGym adds determinism at the decision point, but it does not need to own the whole process.
```

## 3. Establish A Hard Boundary

Call the endpoint with a final-sale refund:

```bash
curl -s -X POST https://opsgym.pdt.dev/api/policies/refund-policy/decision \
  -H "Content-Type: application/json" \
  -d '{"action":"Refund a final-sale VIP ticket purchased 2 days ago."}'
```

Expected result:

```json
{
  "decision": "fail",
  "policyId": "refund-policy"
}
```

Narration:

```txt
The model or ops workflow does not get to improvise around a hard-denial boundary. The policy says no.
```

## 4. Trigger Ambiguity And Create A Queue Item

Call the endpoint with the spillover case:

```bash
curl -s -X POST https://opsgym.pdt.dev/api/policies/refund-policy/decision \
  -H "Content-Type: application/json" \
  -d '{"action":"Refund a VIP customer'\''s damaged order from 45 days ago without manager approval."}'
```

Expected result:

```json
{
  "decision": "wait",
  "policyId": "refund-policy",
  "queueItemId": "queue-...",
  "queueItem": {
    "id": "queue-...",
    "status": "open"
  }
}
```

Copy the returned `queueItemId`.

Narration:

```txt
This is the important moment. The system does not hallucinate policy. It records an exception and creates a reviewable queue item.
```

To capture the queue item automatically:

```bash
curl -s -X POST https://opsgym.pdt.dev/api/policies/refund-policy/decision \
  -H "Content-Type: application/json" \
  -d '{"action":"Refund a VIP customer'\''s damaged order from 45 days ago without manager approval."}' \
  > /tmp/opsgym-wait-response.json

QUEUE_ITEM_ID=$(node -e 'console.log(require("/tmp/opsgym-wait-response.json").queueItemId)')

echo "$QUEUE_ITEM_ID"
```

## 5. Trigger The Self-Improvement Agent

Use the queue item to ask OpsGym to draft a policy improvement. Send the full wait response as the request body. This keeps the demo robust even if production routing changes or consecutive API calls land on different app instances:

```bash
curl -s -X POST "https://opsgym.pdt.dev/api/policies/refund-policy/queue/$QUEUE_ITEM_ID/improve" \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/opsgym-wait-response.json
```

For a single-process local run, the body is optional because the server already has the queue item in memory.

Expected result:

```json
{
  "result": {
    "attempt": {
      "status": "completed",
      "agentProvider": "gemini"
    },
    "proposal": {
      "title": "Harden VIP refund exception",
      "expectedBehavior": [
        { "expectedDecision": "fail" },
        { "expectedDecision": "pass" }
      ]
    }
  }
}
```

If production is not configured with Gemini, `agentProvider` will be `local`. In the hackathon demo environment, prefer Gemini so the proposal is produced by the Managed Agents path.

Narration:

```txt
The self-improvement agent is not approving anything. It drafts a bounded amendment, expected behavior examples, risks, confidence, and metadata. OpsGym stores that as a pending proposed change.
```

The demo also exposes explicit approval/rejection APIs:

```bash
curl -s -X POST "https://opsgym.pdt.dev/api/policies/refund-policy/queue/$QUEUE_ITEM_ID/approve"
curl -s -X POST "https://opsgym.pdt.dev/api/policies/refund-policy/queue/$QUEUE_ITEM_ID/reject"
```

Use the UI approval path for the human-review story. Use the approval API for scripted before/after measurements and tool-driven demos.

## 6. Review The Proposal In The UI

Open:

```txt
https://opsgym.pdt.dev
```

Then:

1. Open `Refund Policy`.
2. Go to `Queue`.
3. Click `Refresh` so the browser pulls the queue item created by the terminal API call.
4. Select the newest queue item, or the queue item matching `$QUEUE_ITEM_ID`.
5. Show the proposal text, agent metadata, confidence, expected behavior, and risks.
6. Click `Approve`.

Narration:

```txt
This is the human-in-the-loop boundary. The agent can reduce ambiguity, but OpsGym keeps the policy change auditable and reviewable.
```

## 7. Show The Improved Behavior

After approval, call the original missing-approval case again:

```bash
curl -s -X POST https://opsgym.pdt.dev/api/policies/refund-policy/decision \
  -H "Content-Type: application/json" \
  -d '{"action":"Refund a VIP customer'\''s damaged order from 45 days ago without manager approval."}'
```

Expected result after approval:

```json
{
  "decision": "fail",
  "policyId": "refund-policy"
}
```

Now call the covered exception with manager approval:

```bash
curl -s -X POST https://opsgym.pdt.dev/api/policies/refund-policy/decision \
  -H "Content-Type: application/json" \
  -d '{"action":"Refund a VIP customer'\''s damaged order from 45 days ago with manager approval."}'
```

Expected result after approval:

```json
{
  "decision": "pass",
  "policyId": "refund-policy"
}
```

Narration:

```txt
The system learned from the exception. Future runs are more deterministic: no manager approval fails, manager-approved damaged VIP refunds inside 90 days pass.
```

## 8. Close With The Product Thesis

Use these points to close:

- Ops teams need to control policy, not just prompts.
- Agents and tools around the process can change quickly.
- OpsGym gives those tools a stable decision endpoint.
- `wait` decisions turn ambiguity into reviewable exceptions.
- The self-improvement layer turns exceptions into policy amendments.
- Low-risk changes can eventually be automated; higher-risk changes stay human-reviewed.
- This is the self-improvement stack for operations: evaluate, queue, improve, approve, and govern.

## Claude.com Ops Worker Demo

OpsGym exposes a remote MCP endpoint for Claude.com custom connectors:

```txt
https://opsgym.pdt.dev/api/mcp
```

Tools:

- `decide_policy`: records a policy decision and may create a queue item.
- `get_policy_runs`: reads recent runs and queue items.
- `draft_policy_improvement`: drafts a pending proposal without approving it.
- `approve_policy_change`: applies a pending proposal after explicit approval.

Primary prompt:

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

See `docs/claude-ops-worker-demo.md` for connector setup and fallback steps.

## Reset Notes

The current app uses an in-memory server store for API state. A deployment restart resets server-side API runs and queue items to the seeded policies. Browser state is also stored in `localStorage`; use a clean browser profile or clear site data if the UI shows stale local policy state.

For a clean terminal-only walkthrough, always capture the `queueItemId` returned by the `wait` decision and use that ID in the `/improve` call.
