"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DecisionKind } from "@/lib/types";

type DemoCaseResult = {
  id: string;
  label: string;
  action: string;
  expectedDecision: DecisionKind;
  actualDecision: DecisionKind;
  passed: boolean;
  queueItemId?: string;
  runId: string;
  rationale: string;
};

type DemoReport = {
  policyId: string;
  startedAt: string;
  completedAt: string;
  dashboardPath: string;
  decisionEndpoint: string;
  runsEndpoint: string;
  before: {
    counts: Record<DecisionKind, number>;
    passed: number;
    failed: number;
    cases: DemoCaseResult[];
  };
  improvement: {
    queueItemId: string;
    status: "completed" | "failed";
    agentProvider: "local" | "gemini";
    agentId: string;
    interactionId?: string;
    proposalTitle: string;
    approvalStatus: "approved";
  };
  after: {
    counts: Record<DecisionKind, number>;
    passed: number;
    failed: number;
    cases: DemoCaseResult[];
  };
};

function decisionClass(decision: DecisionKind) {
  return `badge ${decision}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function isApiError(value: unknown): value is { error?: string } {
  return !!value && typeof value === "object" && "error" in value;
}

function CaseTable({ title, cases }: { title: string; cases: DemoCaseResult[] }) {
  return (
    <section className="demoPanel">
      <div className="demoPanelTop">
        <h2>{title}</h2>
        <span>{cases.filter((item) => item.passed).length}/{cases.length}</span>
      </div>
      <table className="demoTable">
        <thead>
          <tr>
            <th>Case</th>
            <th>Expected</th>
            <th>Actual</th>
            <th>Run</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.label}</strong>
                <p>{item.action}</p>
              </td>
              <td><span className={decisionClass(item.expectedDecision)}>{item.expectedDecision}</span></td>
              <td><span className={decisionClass(item.actualDecision)}>{item.actualDecision}</span></td>
              <td>
                <code>{item.runId}</code>
                {item.queueItemId ? <small>Queue {item.queueItemId}</small> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function DemoPage() {
  const [report, setReport] = useState<DemoReport | null>(null);
  const [status, setStatus] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const origin = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  async function runDemo() {
    setIsRunning(true);
    setStatus("Running demo batch");

    try {
      const response = await fetch("/api/demo/refund-batch", { method: "POST" });
      const data = (await response.json().catch(() => null)) as DemoReport | { error?: string } | null;

      if (!response.ok || !data || isApiError(data)) {
        setStatus(isApiError(data) ? data.error ?? "Demo batch failed" : "Demo batch failed");
        return;
      }

      setReport(data);
      setStatus("Demo batch complete");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className="demoPage">
      <header className="demoHeader">
        <div>
          <h1>Refund Batch Demo</h1>
          {report ? <p>{report.policyId} completed at {formatTime(report.completedAt)}</p> : <p>Before/after policy measurement</p>}
        </div>
        <div className="demoActions">
          <Link href="/">Policies</Link>
          <button className="primary" disabled={isRunning} onClick={runDemo}>
            {isRunning ? "Running..." : "Run Demo Batch"}
          </button>
        </div>
      </header>

      {status ? <div className="demoStatus">{status}</div> : null}

      {report ? (
        <>
          <section className="demoSummary">
            <div>
              <span>Before</span>
              <strong>{report.before.counts.pass}/{report.before.counts.fail}/{report.before.counts.wait}</strong>
              <small>pass / fail / wait</small>
            </div>
            <div>
              <span>Improvement</span>
              <strong>{report.improvement.agentProvider}</strong>
              <small>{report.improvement.proposalTitle}</small>
            </div>
            <div>
              <span>After</span>
              <strong>{report.after.counts.pass}/{report.after.counts.fail}/{report.after.counts.wait}</strong>
              <small>pass / fail / wait</small>
            </div>
          </section>

          <section className="demoLinks">
            <Link href={report.dashboardPath}>Dashboard Policy</Link>
            <a href={`${origin}/api/policies/${report.policyId}`}>Policy API</a>
            <a href={`${origin}${report.decisionEndpoint}`}>Decision Endpoint</a>
            <a href={`${origin}${report.runsEndpoint}`}>Runs Endpoint</a>
          </section>

          <CaseTable title="Before Improvement" cases={report.before.cases} />
          <section className="demoPanel">
            <div className="demoPanelTop">
              <h2>Applied Change</h2>
              <span>{report.improvement.approvalStatus}</span>
            </div>
            <dl className="demoDetails">
              <div>
                <dt>Queue Item</dt>
                <dd><code>{report.improvement.queueItemId}</code></dd>
              </div>
              <div>
                <dt>Agent</dt>
                <dd>{report.improvement.agentProvider} / {report.improvement.agentId}</dd>
              </div>
              {report.improvement.interactionId ? (
                <div>
                  <dt>Interaction</dt>
                  <dd><code>{report.improvement.interactionId}</code></dd>
                </div>
              ) : null}
            </dl>
          </section>
          <CaseTable title="After Improvement" cases={report.after.cases} />
        </>
      ) : (
        <section className="demoEmpty">
          <p>No demo batch has been run in this tab.</p>
        </section>
      )}
    </main>
  );
}
