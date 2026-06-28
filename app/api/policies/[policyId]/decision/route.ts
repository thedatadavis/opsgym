import { NextResponse } from "next/server";
import { recordServerDecision } from "@/lib/serverStore";
import type { DecisionRequest } from "@/lib/types";

interface RouteContext {
  params: Promise<{
    policyId: string;
  }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { policyId } = await context.params;
  const body = (await request.json().catch(() => null)) as Partial<DecisionRequest> | null;

  if (!body || typeof body.action !== "string" || body.action.trim().length === 0) {
    return NextResponse.json({ error: "Request body must include a non-empty action." }, { status: 400 });
  }

  const decision = recordServerDecision(policyId, {
    action: body.action.trim(),
    context: body.context && typeof body.context === "object" ? body.context : undefined
  });

  return NextResponse.json(decision);
}
