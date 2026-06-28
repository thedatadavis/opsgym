import { NextResponse } from "next/server";
import { getServerPolicy, updateServerPolicy } from "@/lib/serverStore";
import type { Policy } from "@/lib/types";

interface RouteContext {
  params: Promise<{
    policyId: string;
  }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { policyId } = await context.params;

  return NextResponse.json(getServerPolicy(policyId));
}

export async function PUT(request: Request, context: RouteContext) {
  const { policyId } = await context.params;
  const body = (await request.json().catch(() => null)) as Partial<Policy> | null;

  if (!body || body.id !== policyId || typeof body.policy !== "string" || !Array.isArray(body.principles)) {
    return NextResponse.json({ error: "Request body must include a valid policy." }, { status: 400 });
  }

  return NextResponse.json(updateServerPolicy(body as Policy));
}
