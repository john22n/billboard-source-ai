import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/db";
import { openaiLogs } from "@/db/schema";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.userId) {
      return NextResponse.json(
        { error: "Unauthorized - Please log in" },
        { status: 401 }
      );
    }

    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "transcription",
          audio: {
            input: {
              transcription: {
                language: "es",
                model: "gpt-4o-transcribe",
                prompt: "Expect words related to programming, development, and technology."
              },
              noise_reduction: {
                type: "near_field"
              }
            }
          }
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI error:", errorText);
      return NextResponse.json(
        { error: "Failed to generate token", details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Create pending log entry
    const [logEntry] = await db.insert(openaiLogs).values({
      userId: session.userId,
      model: 'gpt-4o-transcribe',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: "0.000000",
      sessionId: data.session_id,
      status: "pending"
    }).returning();

    console.log(`📝 Created pending log (id: ${logEntry.id}) for session ${data.session_id}`);

    // Return both the OpenAI data and our log ID
    return NextResponse.json({
      ...data,
      logId: logEntry.id // Client will need this to update the log
    });
    
  } catch (error) {
    console.error("Token generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate token", details: String(error) },
      { status: 500 }
    );
  }
}