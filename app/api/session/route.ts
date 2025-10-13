import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    // The browser sends an SDP (Session Description Protocol) string in the body
    const body = await req.text();

    const sessionConfig = JSON.stringify({
      type: "transcription",
      audio: {
        input: {
          transcription: {
            language: "english",
            model: "gpt-4o-transcribe",
            prompt: "transcribe a sales call between a billboard sales person and a potiental client"
          },
          noise_reduction: {
            type: "near_field"
          }
        }
      }
    });

    const fd = new FormData();
    fd.set("sdp", body);
    fd.set("session", sessionConfig);

    // Call OpenAI’s Realtime API to exchange the SDP
    console.log(process.env.OPENAI_API_KEY)

    const r = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
      },
      body: fd,
    });

    if (!r.ok) {
      const errorText = await r.text();
      console.error("❌ OpenAI API error:", r.status, errorText);
      return NextResponse.json(
        { error: "Failed to create Realtime session", details: errorText },
        { status: r.status }
      );
    }

    // The OpenAI response returns an SDP as plain text
    const sdp = await r.text();

    // Return it as text so the client can complete the WebRTC handshake
    return new NextResponse(sdp, {
      status: 200,
      headers: { "Content-Type": "application/sdp" },
    });
  } catch (error: any) {
    console.error("❌ Session route error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message || String(error) },
      { status: 500 }
    );
  }
}

// Optional: block unsupported methods like GET
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

