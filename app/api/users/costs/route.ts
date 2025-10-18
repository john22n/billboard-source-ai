import { db } from "@/db";
import { user, openaiLogs } from "@/db/schema";
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

export async function GET() {
  try {
    const costs = await db
      .select({
        id: user.id,
        email: user.email,
        cost: sql<number>`COALESCE(SUM(CAST(${openaiLogs.cost} AS NUMERIC)), 0)`.as('cost')
      })
      .from(user)
      .leftJoin(openaiLogs, eq(user.id, openaiLogs.userId))
      .groupBy(user.id, user.email)
      .orderBy(user.email);

    return NextResponse.json(costs);
  } catch (err) {
    console.error("Failed to fetch user costs:", err);
    return NextResponse.json(
      { error: "Failed to fetch costs", details: (err as Error).message },
      { status: 500 }
    );
  }
}