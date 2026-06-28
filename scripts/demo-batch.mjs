#!/usr/bin/env node

const beforeCases = [
  {
    id: "standard-damaged",
    label: "Standard damaged order",
    action: "Refund a delivered damaged order from 12 days ago.",
    expectedDecision: "pass"
  },
  {
    id: "final-sale",
    label: "Final-sale hard boundary",
    action: "Refund a final-sale VIP ticket purchased 2 days ago.",
    expectedDecision: "fail"
  },
  {
    id: "vip-no-manager",
    label: "VIP exception without approval",
    action: "Refund a VIP customer's damaged order from 45 days ago without manager approval.",
    expectedDecision: "wait"
  },
  {
    id: "vip-with-manager",
    label: "VIP exception with approval",
    action: "Refund a VIP customer's damaged order from 45 days ago with manager approval.",
    expectedDecision: "wait"
  }
];

const afterCases = [
  {
    id: "standard-damaged",
    label: "Standard damaged order",
    action: "Refund a delivered damaged order from 12 days ago.",
    expectedDecision: "pass"
  },
  {
    id: "final-sale",
    label: "Final-sale hard boundary",
    action: "Refund a final-sale VIP ticket purchased 2 days ago.",
    expectedDecision: "fail"
  },
  {
    id: "vip-no-manager",
    label: "VIP exception without approval",
    action: "Refund a VIP customer's damaged order from 45 days ago without manager approval.",
    expectedDecision: "fail"
  },
  {
    id: "vip-with-manager",
    label: "VIP exception with approval",
    action: "Refund a VIP customer's damaged order from 45 days ago with manager approval.",
    expectedDecision: "pass"
  }
];

const seedPolicyText = [
  "Pass refunds for delivered orders inside 30 days when the item arrived damaged, was not as described, was the wrong item, or the customer was charged twice.",
  "Fail refunds for final-sale items, suspected fraud or abuse, consumed digital goods, or orders older than 90 days.",
  "Wait on VIP or hardship refunds outside 30 days but inside 90 days unless an approved exception explicitly covers the case."
].join("\n\n");

const seedPrinciples = [
  {
    id: "principle-trust",
    title: "Protect customer trust",
    body: "Favor clear, reversible customer outcomes when the facts support eligibility. Do not invent missing facts."
  },
  {
    id: "principle-boundary",
    title: "Preserve refund boundaries",
    body: "Refunds must respect final sale, abuse, fraud, and account-risk boundaries even when a customer is upset."
  }
];

function parseArgs(argv) {
  const options = {
    base: process.env.OPSGYM_BASE_URL ?? "https://opsgym.pdt.dev",
    json: false,
    policyId: `demo-refund-${Date.now().toString(36)}`
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--base" && argv[i + 1]) {
      options.base = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--base=")) {
      options.base = arg.slice("--base=".length);
    } else if (arg === "--policy-id" && argv[i + 1]) {
      options.policyId = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--policy-id=")) {
      options.policyId = arg.slice("--policy-id=".length);
    }
  }

  options.base = options.base.replace(/\/$/, "");
  return options;
}

async function requestJson(base, path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.error ?? text ?? `${response.status} ${response.statusText}`;
    throw new Error(`${path} failed: ${message}`);
  }

  return data;
}

function buildPolicy(policyId) {
  const timestamp = new Date().toISOString();

  return {
    id: policyId,
    name: "Refund Batch Demo",
    description: "Isolated refund policy used for before/after self-improvement demos.",
    policy: seedPolicyText,
    principles: seedPrinciples,
    endpointPath: `/api/policies/${policyId}/decision`,
    runs: [],
    decisionQueue: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function runCases(base, policyId, cases) {
  const results = [];

  for (const testCase of cases) {
    const response = await requestJson(base, `/api/policies/${policyId}/decision`, {
      method: "POST",
      body: JSON.stringify({ action: testCase.action })
    });

    results.push({
      ...testCase,
      actualDecision: response.decision,
      passed: response.decision === testCase.expectedDecision,
      runId: response.runId,
      queueItemId: response.queueItemId,
      queueItem: response.queueItem,
      response
    });
  }

  return results;
}

function summarize(results) {
  const counts = { pass: 0, fail: 0, wait: 0 };
  for (const result of results) {
    counts[result.actualDecision] += 1;
  }

  return {
    counts,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length
  };
}

function renderCaseRows(results) {
  return results
    .map((result) => {
      const mark = result.passed ? "ok" : "!!";
      const queue = result.queueItemId ? ` queue=${result.queueItemId}` : "";
      return `  ${mark} ${result.label}: expected ${result.expectedDecision}, got ${result.actualDecision}${queue}`;
    })
    .join("\n");
}

function renderReport(report) {
  const before = summarize(report.before);
  const after = summarize(report.after);

  return [
    "OpsGym refund batch demo",
    `Base: ${report.base}`,
    `Policy: ${report.policyId}`,
    "",
    `Before: pass=${before.counts.pass} fail=${before.counts.fail} wait=${before.counts.wait} checks=${before.passed}/${report.before.length}`,
    renderCaseRows(report.before),
    "",
    `Improvement: ${report.improvement.status} via ${report.improvement.agentProvider} (${report.improvement.proposalTitle})`,
    `Approved queue item: ${report.improvement.queueItemId}`,
    "",
    `After: pass=${after.counts.pass} fail=${after.counts.fail} wait=${after.counts.wait} checks=${after.passed}/${report.after.length}`,
    renderCaseRows(report.after),
    "",
    `Policy API: ${report.base}/api/policies/${report.policyId}`,
    `Decision endpoint: ${report.base}/api/policies/${report.policyId}/decision`,
    `Runs endpoint: ${report.base}/api/policies/${report.policyId}/runs`
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const policy = buildPolicy(options.policyId);

  await requestJson(options.base, `/api/policies/${options.policyId}`, {
    method: "PUT",
    body: JSON.stringify(policy)
  });

  const before = await runCases(options.base, options.policyId, beforeCases);
  const improvementSource = before.find((result) => result.id === "vip-no-manager");

  if (!improvementSource?.queueItemId) {
    throw new Error("The before batch did not create the expected VIP exception queue item.");
  }

  const improvement = await requestJson(
    options.base,
    `/api/policies/${options.policyId}/queue/${improvementSource.queueItemId}/improve`,
    {
      method: "POST",
      body: JSON.stringify({
        queueItem: improvementSource.queueItem,
        run: improvementSource.response
      })
    }
  );

  await requestJson(options.base, `/api/policies/${options.policyId}/queue/${improvementSource.queueItemId}/approve`, {
    method: "POST"
  });

  const after = await runCases(options.base, options.policyId, afterCases);
  const report = {
    base: options.base,
    policyId: options.policyId,
    before,
    improvement: {
      queueItemId: improvementSource.queueItemId,
      status: improvement.result.attempt.status,
      agentProvider: improvement.result.attempt.agentProvider,
      agentId: improvement.result.attempt.agentId,
      interactionId: improvement.result.attempt.interactionId,
      proposalTitle: improvement.result.proposal.title
    },
    after
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderReport(report));
  }

  const beforeSummary = summarize(before);
  const afterSummary = summarize(after);
  if (beforeSummary.failed > 0 || afterSummary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
