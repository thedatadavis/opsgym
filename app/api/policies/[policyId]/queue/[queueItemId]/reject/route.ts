import { NextResponse } from "next/server";
import { rejectServerQueueItem } from "@/lib/serverStore";

interface RouteContext {
  params: Promise<{
    policyId: string;
    queueItemId: string;
  }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { policyId, queueItemId } = await context.params;
  const policy = rejectServerQueueItem(policyId, queueItemId);

  if (!policy) {
    return NextResponse.json({ error: "Queue item was not found." }, { status: 404 });
  }

  return NextResponse.json(policy);
}
