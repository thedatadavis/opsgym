import { NextResponse } from "next/server";
import {
  applySelfImprovementResult,
  buildSelfImprovementInput,
  recordSelfImprovementAttempt
} from "@/lib/serverStore";
import { proposeSelfImprovement } from "@/lib/selfImprovementAgent";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    policyId: string;
    queueItemId: string;
  }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { policyId, queueItemId } = await context.params;
  const input = buildSelfImprovementInput(policyId, queueItemId);

  if (!input) {
    return NextResponse.json({ error: "Queue item was not found." }, { status: 404 });
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

  const policy = applySelfImprovementResult(policyId, result);

  return NextResponse.json({
    policy,
    result
  });
}
