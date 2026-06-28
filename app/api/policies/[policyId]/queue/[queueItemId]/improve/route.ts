import { NextResponse } from "next/server";
import {
  applySelfImprovementResult,
  buildSelfImprovementInput,
  getServerPolicy,
  recordSelfImprovementAttempt
} from "@/lib/serverStore";
import { proposeSelfImprovement } from "@/lib/selfImprovementAgent";
import type { DecisionQueueItem, DecisionRun } from "@/lib/types";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    policyId: string;
    queueItemId: string;
  }>;
}

type ImproveRequestBody = {
  queueItem?: DecisionQueueItem;
  queueItemId?: string;
  run?: DecisionRun;
};

function isQueueItem(value: unknown, policyId: string, queueItemId: string): value is DecisionQueueItem {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<DecisionQueueItem>;

  return (
    record.id === queueItemId &&
    record.policyId === policyId &&
    typeof record.runId === "string" &&
    typeof record.action === "string" &&
    typeof record.rationale === "string" &&
    Array.isArray(record.missingContext) &&
    !!record.proposedChange &&
    typeof record.proposedChange === "object"
  );
}

function isRun(value: unknown, policyId: string): value is DecisionRun {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<DecisionRun>;

  return record.policyId === policyId && typeof record.id === "string" && typeof record.action === "string";
}

export async function POST(request: Request, context: RouteContext) {
  const { policyId, queueItemId } = await context.params;
  const body = (await request.json().catch(() => null)) as ImproveRequestBody | null;
  let input = buildSelfImprovementInput(policyId, queueItemId);

  if (!input && body && isQueueItem(body.queueItem, policyId, queueItemId)) {
    const policy = getServerPolicy(policyId);
    const relatedRuns = isRun(body.run, policyId) ? [body.run] : [];

    input = {
      policy,
      queueItem: body.queueItem,
      relatedRuns,
      reviewerHistory: policy.decisionQueue.map((item) => item.proposedChange).slice(0, 12)
    };
  }

  if (!input) {
    return NextResponse.json(
      {
        error:
          "Queue item was not found. Include the queueItem returned by the wait decision response when calling this endpoint from a stateless production deployment."
      },
      { status: 404 }
    );
  }

  const result = await proposeSelfImprovement(input);

  if (result.attempt.status === "failed") {
    recordSelfImprovementAttempt(result.attempt);

    return NextResponse.json(
      {
        error: "Self-improvement agent failed. Existing proposed change was preserved.",
        result
      },
      { status: 502 }
    );
  }

  const policy = applySelfImprovementResult(policyId, result, input.queueItem);

  return NextResponse.json({
    policy,
    result
  });
}
