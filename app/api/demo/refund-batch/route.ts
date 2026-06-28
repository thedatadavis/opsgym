import { NextResponse } from "next/server";
import { runRefundBatchDemo } from "@/lib/demoRefundBatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const report = await runRefundBatchDemo();
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Refund batch demo failed."
      },
      { status: 500 }
    );
  }
}
