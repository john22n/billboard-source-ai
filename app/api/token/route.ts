import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createPendingLog } from "@/lib/dal";

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
                language: "en",
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
    
    // ✅ CRITICAL: Log the response to see the structure
    console.log("OpenAI full response:", JSON.stringify(data, null, 2));

    // ✅ CRITICAL: Extract session ID correctly
    const sessionId = data.session?.id || data.id || "unknown";
    
    console.log("Extracted sessionId:", sessionId);

    // Create pending log entry
    const logEntry = await createPendingLog(session.userId, sessionId);
    
    console.log(`📝 Created pending log (id: ${logEntry.id}) for session ${sessionId}`);

    // Return the correct structure
    return NextResponse.json({
      value: data.value,
      session_id: sessionId,
      logId: logEntry.id,
      expires_at: data.expires_at
    });
  } catch (error) {
    console.error("Token generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate token", details: String(error) },
      { status: 500 }
    );
  }
}