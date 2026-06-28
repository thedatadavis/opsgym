import { NextResponse } from "next/server";
import { getServerQueue, getServerRuns } from "@/lib/serverStore";

interface RouteContext {
  params: Promise<{
    policyId: string;
  }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { policyId } = await context.params;

  return NextResponse.json({
    runs: getServerRuns(policyId),
    decisionQueue: getServerQueue(policyId)
  });
}
