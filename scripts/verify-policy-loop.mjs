const baseUrl = process.env.OPSGYM_BASE_URL ?? "http://127.0.0.1:3100";
const policyId = process.env.OPSGYM_VERIFY_POLICY_ID ?? `verify-refund-${Date.now().toString(36)}`;

const seedPolicyText = [
  "Pass refunds for delivered orders inside 30 days when the item arrived damaged, was not as described, was the wrong item, or the customer was charged twice.",
  "Fail refunds for final-sale items, suspected fraud or abuse, consumed digital goods, or orders older than 90 days.",
  "Wait on VIP or hardship refunds outside 30 days but inside 90 days unless an approved exception explicitly covers the case."
].join("\n\n");

const withoutManagerApproval = "Refund a VIP customer's damaged order from 45 days ago without manager approval.";
const withManagerApproval = "Refund a VIP customer's damaged order from 45 days ago with manager approval.";

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed: ${response.status} ${JSON.stringify(body)}`);
  }

  return body;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function decide(action) {
  return requestJson(`/api/policies/${policyId}/decision`, {
    method: "POST",
    body: JSON.stringify({ action })
  });
}

await requestJson(`/api/policies/${policyId}`, {
  method: "PUT",
  body: JSON.stringify({
    id: policyId,
    name: "Verify Refund Policy Loop",
    description: "Isolated policy for self-learning loop verification.",
    policy: seedPolicyText,
    principles: [
      {
        id: "principle-trust",
        title: "Protect customer trust",
        body: "Resolve covered customer issues quickly while preserving explicit denial boundaries."
      }
    ],
    endpointPath: `/api/policies/${policyId}/decision`,
    runs: [],
    decisionQueue: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })
});

const missingApprovalWait = await decide(withoutManagerApproval);
const approvedContextWait = await decide(withManagerApproval);

assert(missingApprovalWait.decision === "wait", "missing-approval case should initially wait");
assert(approvedContextWait.decision === "wait", "manager-approved case should initially wait");
assert(missingApprovalWait.queueItemId, "missing-approval wait should create a queue item");
assert(approvedContextWait.queueItemId, "manager-approved wait should create a queue item");

await requestJson(`/api/policies/${policyId}/queue/${missingApprovalWait.queueItemId}/improve`, {
  method: "POST"
});

const approvedPolicy = await requestJson(`/api/policies/${policyId}/queue/${missingApprovalWait.queueItemId}/approve`, {
  method: "POST"
});

const approvedQueueItem = approvedPolicy.decisionQueue.find((item) => item.id === missingApprovalWait.queueItemId);
const rerunQueueItem = approvedPolicy.decisionQueue.find((item) => item.id === approvedContextWait.queueItemId);
const reruns = approvedPolicy.runs.filter((run) => run.source === "policy_rerun");

assert(approvedQueueItem?.status === "resolved", "approved queue item should be resolved");
assert(approvedQueueItem?.proposedChange?.status === "approved", "approved proposal should be marked approved");
assert(rerunQueueItem?.status === "resolved", "other queued manager-approved case should resolve after rerun");
assert(reruns.length >= 2, "approval should create policy_rerun history for open queue items");
assert(reruns.some((run) => run.queueItemId === approvedContextWait.queueItemId && run.decision === "pass"), "manager-approved queued task should rerun to pass");
assert(!approvedPolicy.policy.includes("Source gap:"), "rewritten policy should not persist proposal source-gap metadata");
assert(!approvedPolicy.policy.includes("Wait on VIP or hardship refunds outside 30 days but inside 90 days unless"), "rewritten policy should replace the superseded ambiguous VIP clause");
assert(approvedPolicy.policy.includes("Fail when manager approval is missing"), "rewritten policy should retain the explicit missing-approval denial");

const afterMissingApproval = await decide(withoutManagerApproval);
const afterManagerApproval = await decide(withManagerApproval);

assert(afterMissingApproval.decision === "fail", "missing manager approval should fail after approval");
assert(afterManagerApproval.decision === "pass", "manager-approved damaged VIP refund should pass after approval");

console.log(JSON.stringify({
  policyId,
  approvedQueueItemId: missingApprovalWait.queueItemId,
  rerunQueueItemId: approvedContextWait.queueItemId,
  rerunCount: reruns.length,
  after: {
    missingApproval: afterMissingApproval.decision,
    managerApproval: afterManagerApproval.decision
  }
}, null, 2));
