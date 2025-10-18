import { db } from "@/db";
import { user } from "@/db/schema";
import { sql, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { ids } = await request.json();
    
    // Validate input
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No IDs provided",
      });
    }
    
    console.log("Deleting IDs:", ids);
    
    // Delete users from DB using inArray
    await db.delete(user).where(inArray(user.id, ids));
    
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete error:", err);
    return NextResponse.json({
      success: false,
      message: (err as Error).message,
    });
  }
}