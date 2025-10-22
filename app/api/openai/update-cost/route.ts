import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateLogCost } from "@/lib/dal";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { logId, durationSeconds } = await req.json();

    if (!logId || typeof durationSeconds !== 'number') {
      return NextResponse.json(
        { error: "Missing logId or durationSeconds" },
        { status: 400 }
      );
    }

    // Call DAL function
    const result = await updateLogCost(logId, session.userId, durationSeconds);

    if (!result) {
      return NextResponse.json(
        { error: "Log not found or unauthorized" },
        { status: 404 }
      );
    }

    console.log(`✅ Updated log ${logId}: ${durationSeconds}s = $${result.cost}`);

    return NextResponse.json({
      success: true,
      cost: result.cost,
      durationSeconds
    });
  } catch (error) {
    console.error("Cost update error:", error);
    return NextResponse.json(
      { error: "Failed to update cost", details: String(error) },
      { status: 500 }
    );
  }
}