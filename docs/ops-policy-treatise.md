# OpsGym: Policies as the Decision Layer for Operations

Ops work is full of recurring, consequential decisions. Refunds, escalations, account suspensions, fraud checks, SLA credits, support routing, warranty exceptions, and vendor approvals all repeat often enough to deserve structure, but each one still has enough edge cases to resist a simple script. These are not just tasks. They are operational goals expressed as policies.

In OpsGym, a policy is the goal for an operational process. It says what the process is trying to preserve, when it should act, when it should refuse, and when it should stop and ask for review. That makes the policy more important than the specific tool that happens to execute the process this quarter.

The execution layer will keep changing. A support team may move from a queue UI to a Slack workflow to an MCP tool call to a Codex or Claude cowork session. A finance process may start as a script, become a workflow automation, and later become an agentic toolchain with browser control and hosted sandboxes. Those surfaces are volatile. The decision layer should not be.

Ops teams need a place to author and control the decision layer directly. That is what OpsGym provides.

## Why Policies Are the Right Primitive

The usual way to automate operations is to encode a process as a sequence of steps:

1. Look up the customer.
2. Check the order.
3. Apply a rule.
4. Escalate if needed.
5. Record the outcome.

That is useful, but it mixes the mechanism with the judgment. The mechanism answers "what tool runs next?" The policy answers "what outcome is allowed?" For recurring and critical work, the second question is the part the business must control.

A policy can say:

- Pass refunds for damaged delivered orders inside 30 days.
- Fail refunds for final-sale items, fraud, abuse, or consumed digital goods.
- Wait on VIP exceptions outside the normal window unless manager approval is present.

That is an operational goal, not a task recipe. Many different tools can execute around it. The policy remains the source of truth for the decision.

This matters most when the work is important enough to audit. Critical operations rarely fail because the happy path is hard. They fail because the happy path spills over: a customer is VIP, an order is late but damaged, an account is suspicious but has a contractual exception, or a support ticket includes facts that do not fit the current rule. Those are policy problems before they are tooling problems.

## Why Ops, Not Just Coding Agents

Coding agents already have a comparatively rich improvement loop. Code can be compiled, tested, diffed, linted, reviewed, deployed, rolled back, and benchmarked. The artifact is precise enough that a model can often improve it by editing files and running tests.

Operations are different. The artifact is usually a judgment boundary written in natural language, scattered across docs, tribal knowledge, escalation habits, and ticket history. The feedback loop is weaker. The cost of being wrong is not just a failing test; it can be a bad customer outcome, a policy violation, an unrecoverable refund, an unfair suspension, or an unaudited exception.

That makes Ops a better target for policy-centered self-improvement than another coding-agent loop. Ops has recurring decisions, real ambiguity, meaningful risk, and a high need for human-governed exceptions. It also has huge leverage: improving the policy improves every future run of the process, regardless of which agent or tool performs the surrounding work.

OpsGym is not trying to make a more general coworker. It is trying to make operational judgment legible, callable, inspectable, and improvable.

## A Stable Decision Layer for Fast-Moving Tools

The tools around operations will change quickly. Teams will use browser agents, Slack bots, MCP servers, hosted managed agents, desktop automation, internal APIs, and whatever comes next. The same process may be executed by different tools depending on the channel, urgency, or person involved.

OpsGym is designed to sit below that tool churn as a policy endpoint.

It can be used as:

- An MCP tool call from an agentic workflow.
- A skill call inside a Claude cowork, Codex session, or similar agent environment.
- A plain API tool call from an orchestration system.
- A deterministic check inserted into a larger reasoning process before an agent takes action.

The point is not that every process becomes deterministic. The point is that a process can include a deterministic decision boundary at the moment where the business needs control. A reasoning agent can gather facts, summarize a case, navigate tools, and propose actions. OpsGym can answer whether the action passes policy, fails policy, or needs review.

That small bit of determinism is valuable. It turns an open-ended agent step into a governed operational step.

## Self-Improvement as Ambiguity Reduction

Natural language policies are never perfectly precise. They leave gaps, and real operations will find those gaps quickly. A useful system should not pretend otherwise. It should treat ambiguity as the fuel for improvement.

OpsGym's self-improvement loop is built around `wait` decisions. When a policy cannot safely decide, it records the run, classifies the gap, creates a queue item, and proposes a change. That creates an exceptions-management mode for operations:

```txt
happy path -> pass or fail
spillover case -> wait
wait -> queue item
queue item -> policy improvement
policy improvement -> future happy path
```

This is the right shape for operational learning. The system does not need to silently improvise in production. It can expose the exception, explain why it could not decide, and use the exception to make the next decision clearer.

When risk is low enough, this loop can become increasingly automatic. A low-risk policy amendment can be generated, validated against regression examples, and applied under a configured auto-approval threshold. When risk is higher, the same loop keeps a human in the middle: the agent drafts the change, but a reviewer approves, edits, or rejects it.

Both modes reduce ambiguity. The difference is who is allowed to close the loop.

## Why This Fits the Hackathon Theme

The hackathon themes are about systems that improve from use: continual learning, the self-improvement stack, and recursive intelligence. OpsGym fits most directly into the self-improvement stack.

It is not a wrapper chatbot. It is infrastructure for continuously evaluating, monitoring, and upgrading the decision layer of operational AI systems. Each policy run produces evidence. Each `wait` creates a learning opportunity. Each approved proposed change upgrades the future behavior of the process. The system becomes more useful because it encounters real operational edge cases.

It also speaks to continual learning, but with a product constraint that matters in operations: learning must be auditable. The goal is not to let the model mutate behavior invisibly. The goal is to turn production ambiguity into reviewed policy improvement.

That is a practical form of self-improvement. It is smaller than raw recursive model training, but more immediately deployable for teams that need governed AI workflows.

## Gemini Managed Agents Integration

The Gemini integration leverages hosted autonomous agent environments, especially Managed Agents in the Gemini API through the Interactions API and the Antigravity managed agent.

OpsGym's Gemini integration should use that managed-agent layer for policy improvement work:

- A policy run produces a queue item.
- OpsGym packages the policy, principles, failing or ambiguous action, related runs, and reviewer history.
- A Gemini Managed Agent receives that packet in an isolated hosted Linux environment.
- The agent reasons over the case, optionally writes regression examples, and drafts a proposed policy amendment.
- OpsGym validates the response and stores it as a pending proposed change.
- A human reviewer approves it unless the policy is explicitly configured for low-risk auto-apply.

The managed agent should be defined with `AGENTS.md` and `SKILL.md` instructions that make the review boundary explicit. Its job is not to run the operational process end to end. Its job is to reduce policy ambiguity while preserving auditability.

This is where hosted managed agents are especially useful. They can do deeper analysis than the deterministic evaluator, inspect examples, run small test harnesses, maintain state across follow-up calls, and produce structured proposals without OpsGym owning complex local agent orchestration. OpsGym remains the system of record for the policy, queue, proposed change, approval, and audit trail.

The clean division is:

```txt
Gemini Managed Agent: analyze ambiguity and draft improvement
OpsGym: validate, store, review, approve, and expose the decision endpoint
Calling agent: gather facts and execute the surrounding process
```

That division keeps the agent powerful without making it ungoverned.

## The Operating Model

In practice, OpsGym should be used like this:

1. Ops authors a policy for a recurring or critical process.
2. The process calls OpsGym from an MCP tool, skill call, or API endpoint whenever it reaches a consequential decision.
3. OpsGym returns `pass`, `fail`, or `wait`.
4. `pass` and `fail` outcomes are logged as auditable runs.
5. `wait` outcomes become exceptions for review.
6. Self-improvement agents draft policy improvements from those exceptions.
7. Humans approve high-risk changes; low-risk changes may be auto-applied if configured.
8. The improved policy governs the next run.

This gives operations teams a way to move fast with changing agent tools while keeping control over the part that matters: the decision boundary.

## The Bet

The bet behind OpsGym is that operational AI systems need a policy workbench more than they need another chat surface.

Agents will keep getting better at using tools. They will browse, code, click, call APIs, translate, summarize, and coordinate. But if they are going to participate in real operations, teams need a controlled layer that says what decisions are allowed, what decisions are forbidden, and what decisions must become exceptions.

That layer should improve from use. It should turn ambiguity into proposed policy changes. It should let low-risk work become more automatic while keeping high-risk work reviewable. It should preserve an audit trail. It should be callable by whatever agent environment the team uses next.

That is OpsGym: a self-improving policy layer for recurring operational decisions.
