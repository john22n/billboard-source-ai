import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/db";
import { openaiLogs } from "@/db/schema";
import { eq, and } from "drizzle-orm";

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

    // Calculate cost: $0.06 per minute for audio input
    const durationMinutes = durationSeconds / 60;
    const actualCost = durationMinutes * 0.06;

    // Update the log (ensure it belongs to this user for security)
    const result = await db
      .update(openaiLogs)
      .set({
        totalTokens: Math.round(durationSeconds), // Store seconds for reference
        cost: actualCost.toFixed(6),
        status: "completed"
      })
      .where(
        and(
          eq(openaiLogs.id, logId),
          eq(openaiLogs.userId, session.userId)
        )
      )
      .returning();

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Log not found or unauthorized" },
        { status: 404 }
      );
    }

    console.log(`✅ Updated log ${logId}: ${durationSeconds}s = $${actualCost.toFixed(6)}`);

    return NextResponse.json({
      success: true,
      cost: actualCost.toFixed(6),
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